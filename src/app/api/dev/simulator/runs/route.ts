import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { businessIdFrom, guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { getActiveRunId, toSimulatorRun } from "@/simulator/runtime";
import type { SimulatorStateDoc } from "@/simulator/state";

/** GET /api/dev/simulator/runs — list runs for a business (canonical SimulatorRun projections). */
export async function GET(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    const businessId = businessIdFrom(request);
    const db = await getDb();
    const [states, active] = await Promise.all([
      db.collection<SimulatorStateDoc>(COLLECTIONS.simulatorState).find({ businessId }, { projection: { _id: 0, scenarioParams: 0, recentTickReceipts: 0 } }).sort({ createdAt: -1 }).limit(50).toArray(),
      getActiveRunId(businessId, db),
    ]);
    return Response.json({ activeSimulationRunId: active, runs: states.map((s) => ({ ...toSimulatorRun(s), tickIndex: s.tickIndex, totals: s.totals })) });
  } catch (error) {
    return handleRouteError(error, "simulator/runs");
  }
}
