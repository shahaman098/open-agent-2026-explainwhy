import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { Anomaly, Investigation } from "@normal/contracts";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { ingestEvents } from "@/ingestion/service";
import { snapshotTickWindows } from "@/analytics/metrics";
import { deleteRun } from "@/simulator/persistence";
import { harnessCatalogue, simulate } from "@/intelligence/evaluation/harness";
import { runMonitor } from "@/intelligence/monitor";
import { publishWindow, type ReadyWindow } from "@/intelligence/monitoring/windows";
import { scheduleWindow } from "@/intelligence/monitoring/schedule";
import { processNext } from "@/intelligence/monitoring/process";
import { reconcileWindows } from "@/intelligence/monitoring/recovery";

const scope = { businessId: "nike_eval", simulationRunId: `t_reliable_${randomUUID().replaceAll("-", "")}` };
const t = (h: number) => new Date(Date.parse("2026-10-01T00:00:00.000Z") + h * 3_600_000).toISOString();
let db: Db, baseline: ReadyWindow, incident: ReadyWindow;
async function ids() {
  return Promise.all([COLLECTIONS.anomalies, COLLECTIONS.investigations].map(async (name) => {
    const key = name === COLLECTIONS.anomalies ? "anomalyId" : "investigationId";
    return (await db.collection(name).find(scope, { projection: { [key]: 1 } }).toArray()).map((d) => d[key]).sort();
  }));
}
describe("monitoring retries after a real persisted incident", () => {
  beforeAll(async () => {
    db = await getDb(); await ensureIndexes(db);
    // Real deterministic simulator events are persisted; only the test harness sees the injection label.
    const timeline = simulate({ seed: 808, simulationRunId: scope.simulationRunId, healthyHours: 72, scenario: "ad_fatigue", severity: 0.8, scenarioHours: 24 });
    const outcome = await ingestEvents(timeline.events, { businessId: scope.businessId, db });
    expect(outcome.result.rejected).toBe(0);
    await db.collection(COLLECTIONS.simulatedProducts).insertMany([...harnessCatalogue()].map(([productId, label]) => ({ ...scope, productId, ...label })));
    const publish = async (a: number, b: number) => {
      const snapshotIds = await snapshotTickWindows(scope.businessId, scope.simulationRunId, [{ startAt: t(a), endAt: t(b) }], t(b), db);
      return publishWindow(db, { ...scope, windowStart: t(a), windowEnd: t(b), snapshotIds });
    };
    baseline = await publish(0, 72); incident = await publish(72, 96);
  }, 180_000);
  afterAll(async () => { if (db) await deleteRun(db, scope.businessId, scope.simulationRunId); }, 120_000);

  it("runs healthy history before the incident and has no investigations", async () => {
    await scheduleWindow(db, baseline);
    expect((await processNext(db, scope))!.status).toBe("completed");
    expect((await ids())[1]).toEqual([]);
  });

  it("retries a crash after graph commit without duplicate anomalies or investigations", async () => {
    const key = await scheduleWindow(db, incident);
    const crashed = await processNext(db, scope, async (input, options) => {
      await runMonitor(input, options);
      throw new Error("injected crash after incident commit, before job completion");
    });
    expect(crashed!.status).toBe("failed");
    const before = await ids();
    expect(before[0].length).toBeGreaterThan(2); expect(before[1]).toHaveLength(1);
    for (const [name, schema] of [[COLLECTIONS.anomalies, Anomaly], [COLLECTIONS.investigations, Investigation]] as const) {
      const docs = await db.collection(name).find(scope, { projection: { _id: 0, simulationRunId: 0 } }).toArray();
      for (const d of docs) expect(schema.safeParse(d).success).toBe(true);
    }
    await db.collection(COLLECTIONS.monitoringJobs).updateOne({ jobKey: key }, { $set: { nextAttemptAt: new Date(0) } });
    const workers = await Promise.all([processNext(db, scope), processNext(db, scope)]);
    expect(workers.filter(Boolean)).toHaveLength(1);
    expect(workers.find(Boolean)!.status).toBe("completed");
    expect(workers.find(Boolean)!.summary!.repeatScan).toBe(true);
    expect(await ids()).toEqual(before);
  });

  it("a connection restart and repeated notifications do not recreate a closed investigation", async () => {
    const before = await ids();
    await db.collection(COLLECTIONS.investigations).updateOne({ ...scope, investigationId: before[1][0] }, { $set: { status: "closed" } });
    await (await getMongoClient()).close(); globalThis._normalMongoClientPromise = undefined; db = await getDb();
    await Promise.all([scheduleWindow(db, incident), scheduleWindow(db, incident)]);
    expect(await reconcileWindows(db, scope)).toBe(0);
    expect(await processNext(db, scope)).toBeNull();
    await runMonitor({ ...scope, asOf: t(96) }, { db });
    expect(await ids()).toEqual(before);
    expect((await db.collection(COLLECTIONS.investigations).findOne({ ...scope, investigationId: before[1][0] }))!.status).toBe("closed");
  });
});
