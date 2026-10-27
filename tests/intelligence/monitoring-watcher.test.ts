import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { startRun, tickRun } from "@/simulator/runtime";
import { deleteRun } from "@/simulator/persistence";
import { checkChangeStreams, runWatcher, scheduleAndCheckpoint } from "@/intelligence/monitoring/watcher";
import { jobKey, scheduleWindow } from "@/intelligence/monitoring/schedule";
import { parseReadyWindow, windowKey } from "@/intelligence/monitoring/windows";
import { processNext } from "@/intelligence/monitoring/process";

const scope = { businessId: "nike_test", simulationRunId: `t_watch_${randomUUID().replaceAll("-", "")}` };
const workerId = scope.simulationRunId;
let db: Db;
let current: { stop: AbortController; done: Promise<void> } | null = null;
async function start(maxJobsPerCycle = 0) {
  const stop = new AbortController();
  let connected!: () => void;
  const opened = new Promise<void>((resolve) => { connected = resolve; });
  const done = runWatcher(db, { signal: stop.signal, scope, workerId, reconcileMs: 500, maxJobsPerCycle, onConnected: connected });
  current = { stop, done };
  await Promise.race([opened, done.then(() => { throw new Error("Watcher exited before connecting"); })]);
}
async function stop() { current?.stop.abort(); await current?.done; current = null; }
async function latest() {
  return parseReadyWindow((await db.collection(COLLECTIONS.monitoringWindows).findOne(scope, { sort: { windowEnd: -1 }, projection: { _id: 0 } }))!);
}
describe("actual Atlas Change Stream scheduling and restart recovery", () => {
  beforeAll(async () => { db = await getDb(); await ensureIndexes(db); await startRun({ ...scope, seed: 42, makeActive: false }); });
  afterAll(async () => {
    await stop();
    if (db) { await deleteRun(db, scope.businessId, scope.simulationRunId); await db.collection(COLLECTIONS.monitoringWorkers).deleteOne({ workerId }); }
  });

  it("verifies actual cursor access, then deduplicates direct and Change Stream triggers", async () => {
    expect((await checkChangeStreams(db)).supported).toBe(true);
    await start();
    await tickRun({ simulationRunId: scope.simulationRunId, ticks: 1 }, { businessId: scope.businessId });
    const ready = await latest();
    const key = await scheduleWindow(db, ready);
    await expect.poll(async () => (await db.collection(COLLECTIONS.monitoringWorkers).findOne({ workerId }))?.lastScheduledJobKey, { timeout: 15_000 }).toBe(key);
    expect(await db.collection(COLLECTIONS.monitoringJobs).countDocuments(scope)).toBe(1);
    expect((await processNext(db, scope))!.attempts).toBe(1);
    expect((await db.collection(COLLECTIONS.monitoringWorkers).findOne({ workerId }))!.resumeToken).toBeTruthy();
  });

  it("never advances the checkpoint when durable scheduling fails", async () => {
    const before = (await db.collection(COLLECTIONS.monitoringWorkers).findOne({ workerId }))!;
    const original = await latest();
    const invalid = { ...original, simulationRunId: "unpublished_run" };
    invalid.windowKey = windowKey(invalid);
    await expect(scheduleAndCheckpoint(db, invalid, { _data: "must-not-save" }, workerId, before.lock.token)).rejects.toThrow("durably published");
    expect((await db.collection(COLLECTIONS.monitoringWorkers).findOne({ workerId }))!.resumeToken).toEqual(before.resumeToken);
  });

  it("direct processing continues while the watcher is disconnected; resume repeats no work", async () => {
    await stop();
    expect((await db.collection(COLLECTIONS.monitoringWorkers).findOne({ workerId }))!.connected).toBe(false);
    await tickRun({ simulationRunId: scope.simulationRunId, ticks: 1 }, { businessId: scope.businessId });
    const key = await scheduleWindow(db, await latest());
    expect((await processNext(db, scope))!.status).toBe("completed");
    await start();
    await expect.poll(async () => (await db.collection(COLLECTIONS.monitoringWorkers).findOne({ workerId }))?.lastScheduledJobKey, { timeout: 15_000 }).toBe(key);
    expect((await db.collection(COLLECTIONS.monitoringJobs).findOne({ jobKey: key }))!.attempts).toBe(1);
  });

  it("reconciles a notification missed by both processes without relying on a resume token", async () => {
    await stop();
    await db.collection(COLLECTIONS.monitoringWorkers).updateOne({ workerId }, { $unset: { resumeToken: "" } });
    await tickRun({ simulationRunId: scope.simulationRunId, ticks: 1 }, { businessId: scope.businessId });
    expect(await db.collection(COLLECTIONS.monitoringJobs).countDocuments(scope)).toBe(2);
    await start(4);
    await expect.poll(async () => db.collection(COLLECTIONS.monitoringJobs).countDocuments({ ...scope, status: "completed" }), { timeout: 15_000 }).toBe(3);
    expect(await db.collection(COLLECTIONS.monitoringJobs).countDocuments(scope)).toBe(3);
    await stop();
  });

  it("skips a replayed insert whose window was deleted while it was down, instead of poisoning the stream", async () => {
    // Establish a checkpoint strictly before the poison event.
    await start(4);
    await tickRun({ simulationRunId: scope.simulationRunId, ticks: 1 }, { businessId: scope.businessId });
    const anchor = await latest();
    await expect.poll(async () => (await db.collection(COLLECTIONS.monitoringWorkers).findOne({ workerId }))?.lastScheduledJobKey, { timeout: 15_000 }).toBe(jobKey(anchor));
    await stop();
    // While offline: a window is published and then removed (as a run reset or test cleanup does), then a valid one follows.
    await tickRun({ simulationRunId: scope.simulationRunId, ticks: 1 }, { businessId: scope.businessId });
    const deleted = await latest();
    await db.collection(COLLECTIONS.monitoringWindows).deleteOne({ windowKey: deleted.windowKey });
    await tickRun({ simulationRunId: scope.simulationRunId, ticks: 1 }, { businessId: scope.businessId });
    const valid = await latest();
    expect(valid.windowKey).not.toBe(deleted.windowKey);
    const jobsBefore = await db.collection(COLLECTIONS.monitoringJobs).countDocuments(scope);
    await start(4);
    await expect.poll(async () => (await db.collection(COLLECTIONS.monitoringWorkers).findOne({ workerId }))?.lastScheduledJobKey, { timeout: 20_000 }).toBe(jobKey(valid));
    const worker = (await db.collection(COLLECTIONS.monitoringWorkers).findOne({ workerId }))!;
    expect(worker.lastSkippedWindowKey).toBe(deleted.windowKey);
    expect(worker.lastError).toContain("Skipped change event");
    expect(worker.connected).toBe(true);
    expect(await db.collection(COLLECTIONS.monitoringJobs).countDocuments(scope)).toBe(jobsBefore + 1);
    expect(await db.collection(COLLECTIONS.monitoringJobs).countDocuments({ windowKey: deleted.windowKey })).toBe(0);
    await stop();
  });
});
