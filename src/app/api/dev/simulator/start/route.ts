import { readJson } from "@/lib/api";
import { businessIdFrom, guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { seedReferenceData } from "@/reference/service";
import { startRun } from "@/simulator/runtime";

/** POST /api/dev/simulator/start — create or reset a run (dev/demo only). Body: StartSimulatorRequest. */
export async function POST(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
    const businessId = typeof body.businessId === "string" ? body.businessId : businessIdFrom(request);
    await seedReferenceData(undefined, businessId);
    const summary = await startRun({ ...body, businessId });
    return Response.json(summary, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "simulator/start");
  }
}
