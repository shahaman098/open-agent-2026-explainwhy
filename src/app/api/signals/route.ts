import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { listSignalGroups } from "@/intelligence/queries";

/** GET /api/signals — run-scoped incident and metric groups built from persisted observations. */
export async function GET(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    return Response.json(await listSignalGroups(Object.fromEntries(new URL(request.url).searchParams)));
  } catch (error) {
    return handleRouteError(error, "signals");
  }
}
