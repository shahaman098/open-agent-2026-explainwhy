import { z } from "zod";
import { Scope } from "@/intelligence/investigator/schemas";
import { getDb } from "@/lib/mongodb";
import { guardDevRoute, handleRouteError, businessIdFrom } from "@/lib/route-helpers";
import { readJson } from "@/lib/api";
import { readPlanning, selectStrategy, startPlanning, submitPlan, repairPlanning, refreshPlanning } from "@/planner/service";

type Context = { params: Promise<{ id: string }> };
async function scopeFor(request: Request, ctx: Context) {
  const url = new URL(request.url);
  return Scope.parse({ businessId: businessIdFrom(request), simulationRunId: url.searchParams.get("simulationRunId"), investigationId: (await ctx.params).id });
}
export async function GET(request: Request, ctx: Context) {
  const denied = guardDevRoute(request); if (denied) return denied;
  try { return Response.json(await readPlanning(await getDb(), await scopeFor(request, ctx)), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return handleRouteError(e, "planning/read"); }
}
export async function POST(request: Request, ctx: Context) {
  const denied = guardDevRoute(request); if (denied) return denied;
  try {
    const scope = await scopeFor(request, ctx), db = await getDb();
    const input = z.discriminatedUnion("action", [z.object({ action: z.literal("generate") }).strict(), z.object({ action: z.literal("refresh") }).strict(), z.object({ action: z.literal("repair") }).strict(), z.object({ action: z.literal("select"), strategyKey: z.string().min(1).max(40) }).strict(), z.object({ action: z.literal("submit") }).strict()]).parse(await readJson(request));
    if (input.action === "generate") { const job = await startPlanning(db, scope); return Response.json({ job }, { status: job.status === "queued" ? 202 : 200 }); }
    if (input.action === "repair") return Response.json(await repairPlanning(db, scope));
    if (input.action === "refresh") return Response.json(await refreshPlanning(db, scope));
    return Response.json(input.action === "select" ? await selectStrategy(db, scope, input.strategyKey) : await submitPlan(db, scope));
  } catch (e) { return handleRouteError(e, "planning/action"); }
}
