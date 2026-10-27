import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { listAnomalies } from "@/intelligence/queries";

/**
 * GET /api/anomalies?businessId&simulationRunId&status&severity&metric&category&from&to&limit&offset
 * Canonical Anomaly records (validated) with their detection-finding summary. Tenant data: dev/demo access only.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    return Response.json(await listAnomalies(Object.fromEntries(new URL(request.url).searchParams)));
  } catch (error) {
    return handleRouteError(error, "anomalies");
  }
}
