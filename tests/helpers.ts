import type { BusinessEventT } from "@normal/contracts";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { deleteRun } from "@/simulator/persistence";

export const TEST_BUSINESS = "nike_test";

export async function resetTestRun(runId: string): Promise<void> {
  const db = await getDb();
  await deleteRun(db, TEST_BUSINESS, runId);
}

export async function eventsForRun(runId: string, type?: BusinessEventT["type"]): Promise<BusinessEventT[]> {
  const db = await getDb();
  return db.collection<BusinessEventT>(COLLECTIONS.businessEvents)
    .find({ businessId: TEST_BUSINESS, simulationRunId: runId, ...(type ? { type } : {}) }, { projection: { _id: 0 } })
    .sort({ occurredAt: 1, eventId: 1 }).toArray();
}

/** Strips wall-clock and run-identifying noise so two runs with equal seeds can be compared. */
export type NormalisedEvent = Record<string, unknown> & { eventId: string; occurredAt: string };

export function normaliseEvents(events: BusinessEventT[], runId: string): NormalisedEvent[] {
  return events
    .map((e) => JSON.parse(JSON.stringify({ ...e, receivedAt: undefined }).split(runId).join("RUN")))
    .sort((a: NormalisedEvent, b: NormalisedEvent) => (a.eventId < b.eventId ? -1 : 1));
}
