import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { listInvestigations } from "@/intelligence/queries";

/** GET /api/investigations?businessId&simulationRunId&status&limit&offset — canonical Investigations with incident links. */
export async function GET(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    return Response.json(await listInvestigations(Object.fromEntries(new URL(request.url).searchParams)));
  } catch (error) {
    return handleRouteError(error, "investigations");
  }
}
