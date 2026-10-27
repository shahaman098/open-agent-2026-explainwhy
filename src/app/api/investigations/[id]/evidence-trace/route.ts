import { apiError } from "@/lib/api";
import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { getEvidenceTrace } from "@/intelligence/evidence/queries";

/** GET /api/investigations/:id/evidence-trace?businessId&simulationRunId&limit — collection runs and every tool execution. */
export async function GET(request: Request, ctx: RouteContext<"/api/investigations/[id]/evidence-trace">): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    if (!/^[A-Za-z0-9_.-]{1,160}$/.test(id)) return apiError("validation_error", "Invalid investigation id", 400);
    const result = await getEvidenceTrace(id, Object.fromEntries(new URL(request.url).searchParams));
    if (!result) return apiError("investigation_not_found", `Investigation ${id} not found`, 404);
    return Response.json(result);
  } catch (error) {
    return handleRouteError(error, "investigations/evidence-trace");
  }
}
