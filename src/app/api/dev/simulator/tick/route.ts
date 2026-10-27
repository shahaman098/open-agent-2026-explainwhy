import { snapshotTickWindows } from "@/analytics/metrics";
import { scheduleAutoMonitor } from "@/intelligence/auto";
import { readJson } from "@/lib/api";
import { businessIdFrom, guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { tickRun } from "@/simulator/runtime";

/** POST /api/dev/simulator/tick — canonical SimulatorTickRequest → SimulatorTickResponse. Optional Idempotency-Key header. */
export async function POST(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    const businessId = businessIdFrom(request);
    const response = await tickRun(await readJson(request), {
      businessId,
      idempotencyKey: request.headers.get("idempotency-key") ?? undefined,
      afterPersist: (state, windows, db) => snapshotTickWindows(state.businessId, state.simulationRunId, windows, state.virtualTime, db),
    });
    // Monitoring runs after the response is sent, on already-persisted data, so ticks are never blocked by detection.
    const scheduled = scheduleAutoMonitor(businessId, response.simulationRunId);
    return Response.json(response, { headers: { "x-normal-auto-monitor": scheduled ? "scheduled" : "disabled" } });
  } catch (error) {
    return handleRouteError(error, "simulator/tick");
  }
}
