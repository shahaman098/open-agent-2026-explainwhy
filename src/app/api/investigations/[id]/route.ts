import { apiError } from "@/lib/api";
import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { getInvestigationBundle } from "@/intelligence/queries";

/**
 * GET /api/investigations/:id — the investigation starting point for the next (Mubit) stage: canonical Investigation,
 * canonical Anomalies, MetricSnapshots they cite, findings with baselines, and resolvable event references.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/investigations/[id]">): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    if (!/^[A-Za-z0-9_.-]{1,160}$/.test(id)) return apiError("validation_error", "Invalid investigation id", 400);
    const bundle = await getInvestigationBundle(id, undefined, Object.fromEntries(new URL(request.url).searchParams));
    if (!bundle) return apiError("investigation_not_found", `Investigation ${id} not found`, 404);
    return Response.json(bundle);
  } catch (error) {
    return handleRouteError(error, "investigations/get");
  }
}
