import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BusinessEventT } from "@normal/contracts";
import { computeSnapshots } from "@/analytics/metrics";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { ingestBatch } from "@/ingestion/service";

/**
 * Observation-lag coverage for the late-delivery metric.
 *
 * Shipments are cohorted by the hour their delivery promise falls due. A shipment is late if it was not delivered on
 * or before its promise (overdue-and-still-open, delivered late and lost all count). Shipments whose promise has not
 * yet fallen due by virtual "now" are immature and are excluded rather than treated as healthy.
 */
const BIZ = "nike_test";
const RUN = "t_cohort";
const D = (iso: string) => `2026-10-${iso}Z`;

function ev(type: BusinessEventT["type"], id: string, occurredAt: string, payload: Record<string, unknown>): unknown {
  return {
    schemaVersion: 1, businessId: BIZ, eventId: `ev_${RUN}_${id}`, source: "simulator", type, occurredAt, receivedAt: occurredAt,
    provenance: { sourceRecordId: `${RUN}:${id}`, connectorId: "test_cohort", simulated: true, ingestMethod: "simulation" },
    simulationRunId: RUN, payload,
  };
}
const shipped = (o: string, at: string, promisedAt: string) => ev("delivery.status_changed", `${o}_shipped`, at, { orderId: o, status: "shipped", promisedAt });
const delayed = (o: string, at: string, promisedAt: string) => ev("delivery.status_changed", `${o}_delayed`, at, { orderId: o, status: "delayed", promisedAt, delayMinutes: 600 });
const delivered = (o: string, at: string, promisedAt: string) => ev("delivery.status_changed", `${o}_delivered`, at, { orderId: o, status: "delivered", promisedAt, deliveredAt: at });
const lost = (o: string, at: string, promisedAt: string) => ev("delivery.status_changed", `${o}_lost`, at, { orderId: o, status: "lost", promisedAt });

const PROMISE = D("03T10:00:00.000");
const events = [
  // o1-o4: shipped two days before their promise, delivered on time.
  ...["o1", "o2", "o3", "o4"].flatMap((o) => [shipped(o, D("01T10:00:00.000"), PROMISE), delivered(o, D("03T08:00:00.000"), PROMISE)]),
  // o5-o7: overdue and still open; the simulator has not yet emitted any "delayed" event (observation lag).
  ...["o5", "o6", "o7"].map((o) => shipped(o, D("01T10:00:00.000"), PROMISE)),
  // o8: delivered after its promise. o9: lost.
  shipped("o8", D("01T10:00:00.000"), PROMISE), delayed("o8", D("03T11:00:00.000"), PROMISE), delivered("o8", D("03T15:00:00.000"), PROMISE),
  shipped("o9", D("01T10:00:00.000"), PROMISE), lost("o9", D("03T19:00:00.000"), PROMISE),
  // o10: promise falls due after virtual now (immature) and must not count as on time.
  shipped("o10", D("02T10:00:00.000"), D("03T22:00:00.000")),
  // o11: shipped inside the window but due the next day: belongs to the next day's cohort.
  shipped("o11", D("03T12:00:00.000"), D("04T12:00:00.000")),
];

const WINDOW = { startAt: D("03T00:00:00.000"), endAt: D("04T00:00:00.000") };
const NOW = D("03T20:00:00.000");

describe("late-delivery metric is due-date cohort based (observation lag)", () => {
  const clean = async () => { const db = await getDb(); await db.collection(COLLECTIONS.businessEvents).deleteMany({ businessId: BIZ, simulationRunId: RUN }); };
  beforeAll(async () => {
    await clean();
    const res = await ingestBatch({ schemaVersion: 1, events }, { businessId: BIZ });
    expect(res.result.rejected).toBe(0);
  });
  afterAll(clean);

  it("counts overdue-but-unreported parcels as late instead of reporting a healthy or empty window", async () => {
    const [snap] = await computeSnapshots({ businessId: BIZ, simulationRunId: RUN, ...WINDOW, bucket: "window", dimension: {}, virtualTime: NOW });
    // Due cohort: o1-o9 (o10 immature, o11 due tomorrow). Late: o5, o6, o7 (open past promise), o8 (late), o9 (lost).
    expect(snap.counters.shipments).toBe(9);
    expect(snap.counters.delayedShipments).toBe(5);
    expect(snap.rates.lateDeliveryRate).toBeCloseTo(5 / 9, 10);
    expect(snap.completeness).toBe("partial");
  });

  it("classification is final once a promise has passed: evaluating later gives the same cohort result", async () => {
    const [later] = await computeSnapshots({ businessId: BIZ, simulationRunId: RUN, ...WINDOW, bucket: "window", dimension: {}, virtualTime: D("05T00:00:00.000") });
    // o10 has now fallen due without delivery, so it joins the cohort as late; o1-o9 are unchanged.
    expect(later.counters.shipments).toBe(10);
    expect(later.counters.delayedShipments).toBe(6);
  });

  it("a window with no matured promises reports null, never a healthy 0%", async () => {
    const [early] = await computeSnapshots({ businessId: BIZ, simulationRunId: RUN, startAt: D("03T00:00:00.000"), endAt: D("04T00:00:00.000"), bucket: "window", dimension: {}, virtualTime: D("03T09:00:00.000") });
    expect(early.counters.shipments).toBe(0);
    expect(early.rates.lateDeliveryRate).toBeNull();
  });

  it("hourly buckets place shipments by the hour their promise fell due", async () => {
    const hourly = await computeSnapshots({ businessId: BIZ, simulationRunId: RUN, ...WINDOW, bucket: "hour", dimension: {}, virtualTime: D("05T00:00:00.000") });
    const at10 = hourly.find((s) => s.window.startAt === PROMISE)!;
    const at22 = hourly.find((s) => s.window.startAt === D("03T22:00:00.000"))!;
    expect(at10.counters.shipments).toBe(9);
    expect(at22.counters.shipments).toBe(1);
    expect(hourly.reduce((a, s) => a + s.counters.shipments, 0)).toBe(10);
  });
});
