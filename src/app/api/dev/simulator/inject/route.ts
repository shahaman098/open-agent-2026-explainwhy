import { readJson } from "@/lib/api";
import { businessIdFrom, guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { injectScenario } from "@/simulator/runtime";

/** POST /api/dev/simulator/inject — canonical InjectScenarioRequest → run summary. */
export async function POST(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    return Response.json(await injectScenario(await readJson(request), businessIdFrom(request)));
  } catch (error) {
    return handleRouteError(error, "simulator/inject");
  }
}
