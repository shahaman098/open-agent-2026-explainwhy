import { z } from "zod";
import { apiError, readJson } from "@/lib/api";
import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { getDb } from "@/lib/mongodb";
import { Scope } from "@/intelligence/investigator/schemas";
import { listInvestigationEvidence } from "@/intelligence/evidence/queries";
import { chartOptions, financialAnimation } from "@/integrations/animation-studio/scene";
import { AnimationError, readStudioJob, studioBase } from "@/integrations/animation-studio/client";
import { ANIMATIONS, queueAnimation, type AnimationDoc } from "@/integrations/animation-studio/store";

type Context = { params: Promise<{ id: string }> };
async function scopeFor(request: Request, ctx: Context) {
  const url = new URL(request.url);
  return Scope.parse({ businessId: url.searchParams.get("businessId"), simulationRunId: url.searchParams.get("simulationRunId"), investigationId: (await ctx.params).id });
}
const summary = (doc: AnimationDoc) => ({ animationId: doc._id, status: doc.status, studioJobId: doc.studioJobId, error: doc.error, provenance: doc.packet.provenance });
export async function GET(request: Request, ctx: Context) {
  const denied = guardDevRoute(request); if (denied) return denied;
  try {
    const scope = await scopeFor(request, ctx), db = await getDb(), animationId = new URL(request.url).searchParams.get("animationId");
    if (animationId) {
      z.string().regex(/^[a-f0-9]{32}$/).parse(animationId);
      const doc = await db.collection<AnimationDoc>(ANIMATIONS).findOne({ ...scope, _id: animationId });
      if (!doc) return apiError("not_found", "Animation not found in this investigation", 404);
      const job = doc.studioJobId ? await readStudioJob(doc.studioJobId) : null;
      return Response.json({ animation: summary(doc), job });
    }
    const evidence = await listInvestigationEvidence(scope.investigationId, { businessId: scope.businessId, simulationRunId: scope.simulationRunId, limit: 100 }, db);
    if (!evidence) return apiError("not_found", "Investigation not found in this run", 404);
    let enabled = false; try { studioBase(); enabled = true; } catch { /* Explicitly disabled/unconfigured. */ }
    return Response.json({ enabled, options: chartOptions(evidence.items) });
  } catch (error) {
    if (error instanceof AnimationError) return apiError(error.code, "Animation Studio is unavailable. Your investigation is preserved.", 503);
    return handleRouteError(error, "animation/read");
  }
}
export async function POST(request: Request, ctx: Context) {
  const denied = guardDevRoute(request); if (denied) return denied;
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  // Next may normalize the internal request URL to localhost. The browser's Host
  // header retains the actual destination, including its port; browsers cannot set it arbitrarily.
  const hostOrigin = request.headers.get("host") ? `${requestUrl.protocol}//${request.headers.get("host")}` : null;
  if (origin && origin !== requestUrl.origin && origin !== hostOrigin) return apiError("invalid_origin", "Use the ExplainWhy application to create an animation", 403);
  try {
    studioBase();
    const scope = await scopeFor(request, ctx), db = await getDb();
    const input = z.object({ evidenceId: z.string().min(1).max(160), metric: z.string().min(1).max(160) }).strict().parse(await readJson(request));
    const evidence = await listInvestigationEvidence(scope.investigationId, { businessId: scope.businessId, simulationRunId: scope.simulationRunId, limit: 100 }, db);
    if (!evidence) return apiError("not_found", "Investigation not found in this run", 404);
    const item = evidence.items.find((row) => row.evidence.evidenceId === input.evidenceId);
    if (!item || !chartOptions([item]).some((option) => option.metric === input.metric)) return apiError("invalid_chart", "Choose a verified measurement with a baseline", 400);
    const doc = await queueAnimation(db, scope, financialAnimation(scope, item, input.metric));
    return Response.json({ animation: summary(doc) }, { status: doc.status === "failed" ? 503 : doc.status === "unknown" ? 409 : 202 });
  } catch (error) {
    if (error instanceof AnimationError) return apiError(error.code, "Enable Animation Studio on the same Mac before rendering.", 503);
    if (error instanceof Error && error.message.startsWith("animation_")) return apiError(error.message, "The selected data cannot be animated", 400);
    return handleRouteError(error, "animation/create");
  }
}
