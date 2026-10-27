import { z } from "zod";
import { apiError, readJson } from "@/lib/api";
import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { getDb } from "@/lib/mongodb";
import { COLLECTIONS } from "@/lib/collections";
import { Scope } from "@/intelligence/investigator/schemas";
import { cancelInvestigation, readInvestigation, startInvestigation, stateView } from "@/intelligence/investigator/store";
import { ProviderError } from "@/intelligence/investigator/provider";

type Context = { params: Promise<{ id: string }> };
async function scopeFor(request: Request, ctx: Context) {
  return Scope.parse({ ...Object.fromEntries(new URL(request.url).searchParams), investigationId: (await ctx.params).id });
}
export async function GET(request: Request, ctx: Context) {
  const denied = guardDevRoute(request); if (denied) return denied;
  try {
    const scope = await scopeFor(request, ctx), db = await getDb();
    if (!await db.collection(COLLECTIONS.investigations).findOne(scope, { projection: { _id: 1 } })) return apiError("not_found", "Investigation not found in selected run", 404);
    return Response.json(await readInvestigation(db, scope), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return handleRouteError(e, "investigator/read"); }
}
export async function POST(request: Request, ctx: Context) {
  const denied = guardDevRoute(request); if (denied) return denied;
  try {
    const scope = await scopeFor(request, ctx);
    const input = z.object({ action: z.enum(["start", "cancel"]) }).strict().parse(await readJson(request));
    const db = await getDb();
    if (input.action === "cancel") {
      const job = await cancelInvestigation(db, scope);
      return job ? Response.json({ state: stateView(job) }) : apiError("not_running", "No running investigation to cancel", 409);
    }
    const job = await startInvestigation(db, scope);
    return Response.json({ state: stateView(job) }, { status: job.status === "queued" ? 202 : 200 });
  } catch (e) {
    if (e instanceof ProviderError) return apiError(e.code, e.message, 503);
    if (e instanceof Error && e.message === "investigation_not_found") return apiError("not_found", "Investigation not found in selected run", 404);
    if (e instanceof Error && e.message === "investigation_closed") return apiError("closed", "This investigation is already closed or planned", 409);
    return handleRouteError(e, "investigator/start");
  }
}
