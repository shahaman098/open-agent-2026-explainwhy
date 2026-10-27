import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { listIncidents } from "@/intelligence/queries";

/**
 * GET /api/incidents?businessId&simulationRunId&status&severity&category&limit&offset — grouped detection incidents,
 * including monitoring-only incidents that cannot open a canonical Investigation (see investigationPolicy.reason).
 */
export async function GET(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    return Response.json(await listIncidents(Object.fromEntries(new URL(request.url).searchParams)));
  } catch (error) {
    return handleRouteError(error, "incidents");
  }
}
