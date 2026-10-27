import { apiError, readJson } from "@/lib/api";
import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { collectInvestigationEvidence } from "@/intelligence/evidence/orchestrator";

/**
 * POST /api/dev/investigations/:id/collect-evidence — `{businessId?, simulationRunId?, collectionMode?: "initial"|"refresh"}`.
 * Deterministic, bounded evidence collection (dev/demo only). Idempotent per investigation and data cutoff.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/dev/investigations/[id]/collect-evidence">): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    if (!/^[A-Za-z0-9_.-]{1,160}$/.test(id)) return apiError("validation_error", "Invalid investigation id", 400);
    const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
    return Response.json(await collectInvestigationEvidence({ ...body, investigationId: id }));
  } catch (error) {
    return handleRouteError(error, "investigations/collect-evidence");
  }
}
