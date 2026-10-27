import type { Filter } from "mongodb";
import { BusinessEvent, type BusinessEventT } from "@normal/contracts";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { businessIdFrom, guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { getActiveRunId } from "@/simulator/runtime";

const TYPES = new Set(BusinessEvent.options.map((o) => o.shape.type.value as string));

/** GET /api/dev/simulator/events?simulationRunId&type&eventId&limit — most recent canonical events (ledger view); `eventId` looks up one cited record. */
export async function GET(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    const businessId = businessIdFrom(request);
    const url = new URL(request.url);
    const db = await getDb();
    const runId = url.searchParams.get("simulationRunId") ?? (await getActiveRunId(businessId, db));
    const type = url.searchParams.get("type");
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
    const eventId = url.searchParams.get("eventId");
    if ((type && !TYPES.has(type)) || (eventId !== null && !/^[A-Za-z0-9_.:-]{1,160}$/.test(eventId))) return Response.json({ simulationRunId: runId, events: [] });
    const filter: Filter<BusinessEventT> = { businessId, ...(runId ? { simulationRunId: runId } : {}), ...(type ? { type: type as BusinessEventT["type"] } : {}), ...(eventId ? { eventId } : {}) };
    const events = await db.collection<BusinessEventT>(COLLECTIONS.businessEvents)
      .find(filter, { projection: { _id: 0 } })
      .sort({ occurredAt: -1, eventId: -1 }).limit(limit).toArray();
    return Response.json({ simulationRunId: runId, events });
  } catch (error) {
    return handleRouteError(error, "simulator/events");
  }
}
