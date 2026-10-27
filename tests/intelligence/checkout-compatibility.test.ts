import { afterAll, describe, expect, it } from "vitest";
import { Anomaly, MetricSnapshot } from "@normal/contracts";
import { computeSnapshots, snapshotTickWindows } from "@/analytics/metrics";
import { simulate, harnessCatalogue } from "@/intelligence/evaluation/harness";
import { SCENARIO_HOURS } from "@/intelligence/evaluation/evaluate";
import { runMonitor } from "@/intelligence/monitor";
import { publishWindow } from "@/intelligence/monitoring/windows";
import { ingestEvents } from "@/ingestion/service";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { startInvestigation } from "@/intelligence/investigator/store";
import { deleteRun } from "@/simulator/persistence";

const simulationRunId = `t_checkout_compat_${Date.now()}`;
const scope = { businessId: "nike_eval", simulationRunId };

afterAll(async () => { await deleteRun(await getDb(), scope.businessId, scope.simulationRunId); });

describe("checkout metric compatibility", () => {
  it("opens a canonical investigation from a genuinely detected checkout failure and reconciles cited snapshots", async () => {
    const db = await getDb(); await ensureIndexes(db);
    const timeline = simulate({ seed: 11, simulationRunId, healthyHours: 72, scenario: "promo_checkout_failure", severity: 0.8, scenarioHours: SCENARIO_HOURS.promo_checkout_failure });
    expect(timeline.businessId).toBe(scope.businessId);
    expect((await ingestEvents(timeline.events, { businessId: scope.businessId, db })).result.rejected).toBe(0);
    await db.collection(COLLECTIONS.simulatedProducts).insertMany([...harnessCatalogue()].map(([productId, label]) => ({ ...scope, productId, ...label })));
    for (let cursor = Date.parse(timeline.startAt); cursor < Date.parse(timeline.endAt); cursor += 24 * 3600000) {
      const startAt = new Date(cursor).toISOString();
      const endAt = new Date(Math.min(cursor + 24 * 3600000, Date.parse(timeline.endAt))).toISOString();
      const snapshotIds = await snapshotTickWindows(scope.businessId, simulationRunId, [{ startAt, endAt }], endAt, db);
      await publishWindow(db, { ...scope, windowStart: startAt, windowEnd: endAt, snapshotIds });
      await runMonitor({ ...scope, asOf: endAt });
    }
    const incident = await db.collection(COLLECTIONS.incidents).findOne({ ...scope, themes: "conversion", investigationId: { $ne: null } });
    expect(incident?.investigationPolicy.qualifies).toBe(true);
    expect(incident?.investigationId).toBeTruthy();
    const job = await startInvestigation(db, { ...scope, investigationId: incident!.investigationId });
    expect(job.status).toBe("queued");
    const anomalies = await db.collection(COLLECTIONS.anomalies).find({ ...scope, anomalyId: { $in: incident!.anomalyIds } }).toArray();
    expect(anomalies.some((a) => a.metric === "checkout_failure_rate")).toBe(true);
    expect(anomalies.some((a) => a.metric === "coupon_failure_rate")).toBe(true);
    for (const raw of anomalies.filter((a) => ["checkout_failure_rate", "coupon_failure_rate"].includes(a.metric))) {
      const { _id: _id, simulationRunId: _run, ...value } = raw; void _id; void _run;
      const anomaly = Anomaly.parse(value);
      const snaps = await db.collection(COLLECTIONS.metricSnapshots).find({ ...scope, snapshotId: { $in: anomaly.sourceSnapshotIds } }).toArray();
      expect(snaps).toHaveLength(anomaly.sourceSnapshotIds.length);
      const byId = new Map(snaps.map(({ _id, simulationRunId: _run, ...value }) => { void _id; void _run; const s = MetricSnapshot.parse(value); return [s.snapshotId, s] as const; }));
      const current = byId.get(anomaly.sourceSnapshotIds[0])!;
      const metric = anomaly.metric === "checkout_failure_rate" ? "checkoutFailureRate" : "couponFailureRate";
      expect(current.rates[metric]).toBeCloseTo(anomaly.actualValue, 9);
      const baseline = anomaly.sourceSnapshotIds.slice(1).map((id) => byId.get(id)!);
      const numerator = baseline.reduce((sum, s) => sum + (metric === "checkoutFailureRate" ? s.counters.checkoutFailures! : s.counters.couponFailures!), 0);
      const denominator = baseline.reduce((sum, s) => sum + s.counters.orders + s.counters.checkoutFailures!, 0);
      expect(anomaly.baselineValue).toBeCloseTo((numerator + 0.5) / (denominator + 1), 9);
    }
    const [snapshot] = await computeSnapshots({ ...scope, startAt: timeline.startAt, endAt: timeline.endAt, bucket: "window", dimension: {}, virtualTime: timeline.endAt }, db);
    expect(snapshot.rates.checkoutFailureRate).toBeCloseTo(snapshot.counters.checkoutFailures! / (snapshot.counters.orders + snapshot.counters.checkoutFailures!), 9);
  }, 180_000);
});
