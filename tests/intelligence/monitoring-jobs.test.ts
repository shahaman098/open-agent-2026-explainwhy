import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { tickRun, startRun } from "@/simulator/runtime";
import { deleteRun } from "@/simulator/persistence";
import { publishCommittedWindows } from "@/simulator/monitoring";
import { parseReadyWindow, publishWindow, WindowInput, type ReadyWindow } from "@/intelligence/monitoring/windows";
import { jobKey, scheduleWindow } from "@/intelligence/monitoring/schedule";
import { claimJob, MAX_ATTEMPTS } from "@/intelligence/monitoring/jobs";
import { processNext } from "@/intelligence/monitoring/process";
import { reconcileWindows } from "@/intelligence/monitoring/recovery";

const scope = { businessId: "nike_test", simulationRunId: `t_monitor_${randomUUID().replaceAll("-", "")}` };
const partialScope = { ...scope, simulationRunId: `${scope.simulationRunId}_partial` };
let db: Db;
let ready: ReadyWindow;
describe("durable direct monitoring and shared jobs", () => {
  beforeAll(async () => { db = await getDb(); await ensureIndexes(db); await startRun({ ...scope, seed: 42, makeActive: false }); });
  afterAll(async () => { if (db) for (const s of [scope, partialScope]) await deleteRun(db, s.businessId, s.simulationRunId); });

  it("validates hour boundaries, reversed and partial windows", () => {
    const base = { ...scope, windowStart: "2026-10-01T00:00:00.000Z", windowEnd: "2026-10-01T01:00:00.000Z", snapshotIds: ["s"] };
    expect(WindowInput.safeParse(base).success).toBe(true);
    expect(WindowInput.safeParse({ ...base, windowEnd: base.windowStart }).success).toBe(false);
    expect(WindowInput.safeParse({ ...base, windowEnd: "2026-10-01T00:30:00.000Z" }).success).toBe(false);
  });

  it("publishes completed durable ticks, releases the simulator lock, and retries without another ready record", async () => {
    const a = await tickRun({ simulationRunId: scope.simulationRunId, ticks: 2 }, { businessId: scope.businessId, idempotencyKey: "monitor_tick_1" });
    const rows = await db.collection(COLLECTIONS.monitoringWindows).find(scope, { projection: { _id: 0 } }).toArray();
    expect(rows).toHaveLength(1); ready = parseReadyWindow(rows[0]);
    expect(ready.snapshotIds).toHaveLength(2);
    expect((await db.collection(COLLECTIONS.simulatorState).findOne(scope))!.lock).toBeNull();
    expect(await tickRun({ simulationRunId: scope.simulationRunId, ticks: 2 }, { businessId: scope.businessId, idempotencyKey: "monitor_tick_1" })).toEqual(a);
    expect(await db.collection(COLLECTIONS.monitoringWindows).countDocuments(scope)).toBe(1);
  });

  it("rejects missing durable snapshot coverage", async () => {
    await expect(publishWindow(db, { ...scope, windowStart: ready.windowEnd, windowEnd: "2026-10-01T03:00:00.000Z", snapshotIds: ["missing"] })).rejects.toThrow("coverage");
  });

  it("half-hour ticks wait for a complete hour, and separate runs cannot share snapshots or jobs", async () => {
    await startRun({ ...partialScope, seed: 42, minutesPerTick: 30, makeActive: false });
    await tickRun({ simulationRunId: partialScope.simulationRunId, ticks: 1 }, { businessId: partialScope.businessId });
    expect(await db.collection(COLLECTIONS.monitoringWindows).countDocuments(partialScope)).toBe(0);
    expect(await processNext(db, partialScope)).toBeNull();
    await tickRun({ simulationRunId: partialScope.simulationRunId, ticks: 1 }, { businessId: partialScope.businessId });
    const w = parseReadyWindow((await db.collection(COLLECTIONS.monitoringWindows).findOne(partialScope, { projection: { _id: 0 } }))!);
    expect(w.snapshotIds).toHaveLength(1);
    const key = await scheduleWindow(db, w);
    expect(key).not.toBe(jobKey(ready));
    expect((await processNext(db, partialScope))!.simulationRunId).toBe(partialScope.simulationRunId);
    await expect(publishWindow(db, { ...partialScope, windowStart: ready.windowStart, windowEnd: ready.windowEnd, snapshotIds: ready.snapshotIds })).rejects.toThrow("coverage");
  });

  it("simultaneous direct and stream notifications converge, and only one worker executes", async () => {
    const keys = await Promise.all(Array.from({ length: 10 }, () => scheduleWindow(db, ready)));
    expect(new Set(keys).size).toBe(1);
    expect(await db.collection(COLLECTIONS.monitoringJobs).countDocuments(scope)).toBe(1);
    const results = await Promise.all([processNext(db, scope), processNext(db, scope), processNext(db, scope)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.find(Boolean)!.status).toBe("completed");
    expect(results.find(Boolean)!.attempts).toBe(1);
    await scheduleWindow(db, ready);
    expect(await processNext(db, scope)).toBeNull();
  });

  it("recovers a committed clock whose ready record could not be published", async () => {
    const failing = new Proxy(db, { get(target, prop, receiver) {
      if (prop !== "collection") return Reflect.get(target, prop, receiver);
      return (name: string) => {
        const col = target.collection(name);
        return new Proxy(col, { get(c, p, r) {
          if (name === COLLECTIONS.monitoringWindows && p === "updateOne") return async () => { throw new Error("injected ready-record outage"); };
          const value = Reflect.get(c, p, r); return typeof value === "function" ? value.bind(c) : value;
        } });
      };
    } }) as Db;
    const result = await tickRun({ simulationRunId: scope.simulationRunId, ticks: 1 }, { businessId: scope.businessId, db: failing });
    expect(result.virtualTime).toBe("2026-10-01T03:00:00.000Z");
    expect(await db.collection(COLLECTIONS.monitoringWindows).countDocuments(scope)).toBe(1);
    await publishCommittedWindows(db, scope.businessId, scope.simulationRunId);
    expect(await db.collection(COLLECTIONS.monitoringWindows).countDocuments(scope)).toBe(2);
    expect(await reconcileWindows(db, scope)).toBe(1);
  });

  it("recovers a crashed claimant after lease expiry and bounds failures", async () => {
    const claimed = (await claimJob(db, scope))!;
    expect(claimed.status).toBe("running");
    await db.collection(COLLECTIONS.monitoringJobs).updateOne({ jobKey: claimed.jobKey }, { $set: { leaseUntil: new Date(0) } });
    await db.collection(COLLECTIONS.monitorState).updateOne(scope, { $set: { "jobLock.until": new Date(0) } });
    const recovered = (await processNext(db, scope))!;
    expect(recovered.status).toBe("completed"); expect(recovered.attempts).toBe(2);
    await tickRun({ simulationRunId: scope.simulationRunId, ticks: 1 }, { businessId: scope.businessId });
    await reconcileWindows(db, scope);
    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
      const failed = (await processNext(db, scope, async () => { throw new Error("injected detector failure"); }))!;
      expect(failed.status).toBe("failed"); expect(failed.attempts).toBe(n);
      await db.collection(COLLECTIONS.monitoringJobs).updateOne({ jobKey: failed.jobKey }, { $set: { nextAttemptAt: new Date(0) } });
    }
    expect(await processNext(db, scope)).toBeNull();
    expect(jobKey(ready)).not.toBe(jobKey({ ...ready, simulationRunId: "different_run" }));
    expect(jobKey(ready)).not.toBe(jobKey(ready, "future-version"));
  });
});
