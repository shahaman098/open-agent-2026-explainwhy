import { z } from "zod";
import { readJson } from "@/lib/api";
import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { monitorStatus } from "@/intelligence/monitor";
import { runScheduledMonitor } from "@/intelligence/monitoring/manual";

/**
 * POST /api/dev/monitor/run — runs anomaly detection for an existing run (dev/demo only).
 * Body: { businessId?, simulationRunId, asOf?, dryRun? }. Never advances the simulator or changes business state.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    return Response.json(await runScheduledMonitor((await readJson(request)) ?? {}));
  } catch (error) {
    return handleRouteError(error, "monitor/run");
  }
}

const StatusQuery = z.object({
  businessId: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/).default("nike_demo"),
  simulationRunId: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
}).strict();

/** GET /api/dev/monitor/run?simulationRunId — when monitoring last ran and the latest observable hour. */
export async function GET(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    const q = StatusQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await monitorStatus(q.businessId, q.simulationRunId));
  } catch (error) {
    return handleRouteError(error, "monitor/status");
  }
}
