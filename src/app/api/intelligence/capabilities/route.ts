import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { getCapabilities } from "@/intelligence/capabilities";

/** GET /api/intelligence/capabilities?businessId&simulationRunId — measured readiness of every pipeline stage. */
export async function GET(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    return Response.json(await getCapabilities(Object.fromEntries(new URL(request.url).searchParams)));
  } catch (error) {
    return handleRouteError(error, "intelligence/capabilities");
  }
}
