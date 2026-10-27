import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { snapshotTickWindows } from "@/analytics/metrics";
import { COLLECTIONS } from "@/lib/collections";
import { publishWindow } from "@/intelligence/monitoring/windows";
import { ceilHour, floorHour, HOUR_MS } from "@/intelligence/signals/rows";

/** Producer-side outbox recovery. Only durable clock boundaries cross into monitoring. */
export async function publishCommittedWindows(db: Db, businessId: string, simulationRunId: string): Promise<void> {
  const scope = { businessId, simulationRunId }, token = randomUUID(), now = new Date();
  const states = db.collection(COLLECTIONS.simulatorState);
  const state = await states.findOneAndUpdate({ ...scope, $or: [
    { publicationLock: null }, { publicationLock: { $exists: false } }, { "publicationLock.until": { $lte: now } },
  ] }, { $set: { publicationLock: { token, until: new Date(now.getTime() + 120_000) }, monitoringCheckedAt: now } }, {
    returnDocument: "after", projection: { _id: 0, virtualTime: 1, virtualStartAt: 1, monitoringPublishedThrough: 1, monitoringBatch: 1 },
  });
  if (!state) return;
  const owned = { ...scope, "publicationLock.token": token };
  try {
    const start = (state.monitoringPublishedThrough as string | undefined) ?? ceilHour(state.virtualStartAt as string);
    const end = floorHour(state.virtualTime as string);
    if (end <= start && !state.monitoringBatch) return;
    // Freeze the range before computing snapshots: a crash followed by further ticks reuses the same range/key.
    const batch = (state.monitoringBatch as { startAt: string; endAt: string } | undefined) ?? {
      startAt: start, endAt: new Date(Math.min(Date.parse(end), Date.parse(start) + 72 * HOUR_MS)).toISOString(),
    };
    await states.updateOne(owned, { $set: { monitoringBatch: batch } });
    const snapshotIds = await snapshotTickWindows(businessId, simulationRunId, [batch], batch.endAt, db);
    await publishWindow(db, { ...scope, windowStart: batch.startAt, windowEnd: batch.endAt, snapshotIds });
    await states.updateOne(owned, { $max: { monitoringPublishedThrough: batch.endAt }, $unset: { monitoringBatch: "" } });
  } finally {
    await states.updateOne(owned, { $set: { publicationLock: null } });
  }
}

/** Recovers crashes after the durable clock commit, including before metrics/ready-record publication. */
export async function recoverCommittedWindows(db: Db): Promise<void> {
  const states = await db.collection(COLLECTIONS.simulatorState).find({ $expr: { $gte: [
    { $subtract: [{ $toDate: "$virtualTime" }, { $toDate: { $ifNull: ["$monitoringPublishedThrough", "$virtualStartAt"] } }] }, HOUR_MS,
  ] } }, { projection: { _id: 0, businessId: 1, simulationRunId: 1 } }).sort({ monitoringCheckedAt: 1 }).limit(25).toArray();
  for (const s of states) await publishCommittedWindows(db, s.businessId as string, s.simulationRunId as string);
}
