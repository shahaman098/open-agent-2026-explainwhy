import { apiError } from "@/lib/api";
import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { getAnomalyBundle } from "@/intelligence/queries";

/** GET /api/anomalies/:id — canonical signal, detector finding, and the exact source snapshots. */
export async function GET(request: Request, ctx: RouteContext<"/api/anomalies/[id]">): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    if (!/^[A-Za-z0-9_.-]{1,160}$/.test(id)) return apiError("validation_error", "Invalid anomaly id", 400);
    const bundle = await getAnomalyBundle(id, undefined, Object.fromEntries(new URL(request.url).searchParams));
    if (!bundle) return apiError("anomaly_not_found", `Anomaly ${id} not found`, 404);
    return Response.json(bundle);
  } catch (error) {
    return handleRouteError(error, "anomalies/get");
  }
}
