import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MetricSnapshot, type BusinessEventT } from "@normal/contracts";
import { campaignBreakdown, computeSnapshots, persistSnapshots, productBreakdown, snapshotTickWindows } from "@/analytics/metrics";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { ingestBatch } from "@/ingestion/service";
import { startRun, tickRun } from "@/simulator/runtime";
import { TEST_BUSINESS, eventsForRun, resetTestRun } from "../helpers";

const RUN = "t_metrics";
const START = "2026-10-01T00:00:00.000Z";
const END = "2026-10-03T00:00:00.000Z";

function manual(events: BusinessEventT[], startAt: string, endAt: string, now = endAt) {
  const inWin = events.filter((e) => e.occurredAt >= startAt && e.occurredAt < endAt);
  const c = { sessions: 0, orders: 0, revenueMinor: 0, refundMinor: 0, adSpendMinor: 0, impressions: 0, clicks: 0, attributedOrders: 0, shipments: 0, delayedShipments: 0, reviews: 0, lowRatingReviews: 0, checkoutFailures: 0, couponFailures: 0 };
  const shipped = new Set<string>(); const delayed = new Set<string>();
  for (const e of inWin) {
    switch (e.type) {
      case "web.session_started": c.sessions++; break;
      case "order.completed": c.orders++; c.revenueMinor += e.payload.netRevenueMinor; break;
      case "order.refunded": c.refundMinor += e.payload.refundMinor; break;
      case "ad.metrics_observed": break; // ads are windowed by window.startAt below
      case "delivery.status_changed": break; // shipping uses the due-date cohort below
      case "review.created": c.reviews++; if (e.payload.rating <= 2) c.lowRatingReviews++; break;
      case "checkout.failed": c.checkoutFailures++; if (e.payload.failureCode === "coupon_rejected") c.couponFailures++; break;
      default: break;
    }
  }
  // Due-date cohort: shipped orders whose promise falls due in [startAt, min(endAt, now)); late unless delivered on time.
  const dueEnd = endAt < now ? endAt : now;
  const deliveredAt = new Map<string, string>();
  for (const e of events) if (e.type === "delivery.status_changed" && e.payload.status === "delivered") {
    const prev = deliveredAt.get(e.payload.orderId);
    if (!prev || e.occurredAt < prev) deliveredAt.set(e.payload.orderId, e.occurredAt);
  }
  for (const e of events) {
    if (e.type !== "delivery.status_changed" || e.payload.status !== "shipped" || !e.payload.promisedAt) continue;
    if (e.payload.promisedAt < startAt || e.payload.promisedAt >= dueEnd) continue;
    shipped.add(e.payload.orderId);
    const d = deliveredAt.get(e.payload.orderId);
    if (!d || Date.parse(d) > Date.parse(e.payload.promisedAt)) delayed.add(e.payload.orderId);
  }
  c.shipments = shipped.size; c.delayedShipments = delayed.size;
  // Ads: observations whose window STARTS in [startAt, endAt), deduplicated by (campaign, window start).
  const seen = new Set<string>();
  for (const e of events) {
    if (e.type !== "ad.metrics_observed") continue;
    if (e.payload.window.startAt < startAt || e.payload.window.startAt >= endAt) continue;
    const k = `${e.payload.campaignId}|${e.payload.window.startAt}`;
    if (seen.has(k)) continue;
    seen.add(k);
    c.adSpendMinor += e.payload.spendMinor; c.impressions += e.payload.impressions; c.clicks += e.payload.clicks; c.attributedOrders += e.payload.attributedOrders;
  }
  return c;
}

describe("analytics: MetricSnapshot aggregation (Milestone 5)", () => {
  let events: BusinessEventT[] = [];
  beforeAll(async () => {
    await resetTestRun(RUN);
    await startRun({ businessId: TEST_BUSINESS, simulationRunId: RUN, seed: 42, makeActive: false });
    await tickRun({ simulationRunId: RUN, ticks: 48 }, { businessId: TEST_BUSINESS });
    events = await eventsForRun(RUN);
  });
  afterAll(async () => { await resetTestRun(RUN); });

  it("whole-window counters equal an independent recount of the stored events", async () => {
    const [snap] = await computeSnapshots({ businessId: TEST_BUSINESS, simulationRunId: RUN, startAt: START, endAt: END, bucket: "window", dimension: {}, virtualTime: END });
    expect(MetricSnapshot.safeParse(snap).success).toBe(true);
    expect(snap.counters).toEqual(manual(events, START, END));
    expect(snap.completeness).toBe("complete");
    expect(snap.rates.conversionRate).toBeCloseTo(snap.counters.orders / snap.counters.sessions, 10);
    expect(snap.rates.ctr).toBeCloseTo(snap.counters.clicks / snap.counters.impressions, 10);
    expect(snap.rates.costPerAcquisitionMinor).toBe(Math.round(snap.counters.adSpendMinor / snap.counters.attributedOrders));
    expect(snap.rates.checkoutFailureRate).toBeCloseTo(snap.counters.checkoutFailures! / (snap.counters.orders + snap.counters.checkoutFailures!), 10);
    expect(snap.rates.couponFailureRate).toBeCloseTo(snap.counters.couponFailures! / (snap.counters.orders + snap.counters.checkoutFailures!), 10);
    for (const v of Object.values(snap.rates)) if (v !== null) expect(Number.isFinite(v)).toBe(true);
  });

  it("time filtering is half-open and hourly/daily buckets sum to the window total", async () => {
    const [total] = await computeSnapshots({ businessId: TEST_BUSINESS, simulationRunId: RUN, startAt: START, endAt: END, bucket: "window", dimension: {}, virtualTime: END });
    const hourly = await computeSnapshots({ businessId: TEST_BUSINESS, simulationRunId: RUN, startAt: START, endAt: END, bucket: "hour", dimension: {}, virtualTime: END });
    const daily = await computeSnapshots({ businessId: TEST_BUSINESS, simulationRunId: RUN, startAt: START, endAt: END, bucket: "day", dimension: {}, virtualTime: END });
    expect(hourly).toHaveLength(48);
    expect(daily).toHaveLength(2);
    for (const key of ["sessions", "orders", "revenueMinor", "adSpendMinor", "impressions", "clicks", "reviews", "checkoutFailures", "couponFailures"] as const) {
      expect(hourly.reduce((a, s) => a + (s.counters[key] ?? 0), 0)).toBe(total.counters[key]);
      expect(daily.reduce((a, s) => a + (s.counters[key] ?? 0), 0)).toBe(total.counters[key]);
    }
    expect(hourly[0].window).toEqual({ startAt: START, endAt: "2026-10-01T01:00:00.000Z" });
    expect(daily[1].counters).toEqual(manual(events, "2026-10-02T00:00:00.000Z", END));
    // A window that ends after virtual time is partial; one with nothing in it has null rates, never NaN.
    const [future] = await computeSnapshots({ businessId: TEST_BUSINESS, simulationRunId: RUN, startAt: END, endAt: "2026-10-04T00:00:00.000Z", bucket: "window", dimension: {}, virtualTime: END });
    expect(future.completeness).toBe("partial");
    expect(future.counters.sessions).toBe(0);
    expect(future.rates).toEqual({ conversionRate: null, ctr: null, lateDeliveryRate: null, lowRatingRate: null, costPerAcquisitionMinor: null, checkoutFailureRate: null, couponFailureRate: null });
  });

  it("campaign and product dimensions slice correctly; cross-business data is isolated", async () => {
    const [camp] = await computeSnapshots({ businessId: TEST_BUSINESS, simulationRunId: RUN, startAt: START, endAt: END, bucket: "window", dimension: { campaignId: "cmp_running_pegasus" }, virtualTime: END });
    const sessions = events.filter((e) => e.type === "web.session_started" && e.payload.campaignId === "cmp_running_pegasus" && e.occurredAt < END).length;
    const orders = events.filter((e) => e.type === "order.completed" && e.payload.campaignId === "cmp_running_pegasus" && e.occurredAt < END);
    expect(camp.counters.sessions).toBe(sessions);
    expect(camp.counters.orders).toBe(orders.length);
    expect(camp.counters.attributedOrders).toBe(orders.length);
    expect(camp.dimension).toEqual({ campaignId: "cmp_running_pegasus" });
    const [prod] = await computeSnapshots({ businessId: TEST_BUSINESS, simulationRunId: RUN, startAt: START, endAt: END, bucket: "window", dimension: { productId: "nk_air_force_1_07" }, virtualTime: END });
    expect(prod.counters.orders).toBe(events.filter((e) => e.type === "order.completed" && e.payload.productIds.includes("nk_air_force_1_07") && e.occurredAt < END).length);
    expect(prod.counters.impressions).toBe(0);
    const [other] = await computeSnapshots({ businessId: "someone_else", simulationRunId: RUN, startAt: START, endAt: END, bucket: "window", dimension: {}, virtualTime: END });
    expect(other.counters.sessions).toBe(0);
    expect(other.counters.orders).toBe(0);
  });

  it("does not double count overlapping ad observations for the same campaign window", async () => {
    const ad = events.find((e) => e.type === "ad.metrics_observed")!;
    const dup = { ...ad, eventId: `${ad.eventId}_dup`, provenance: { ...ad.provenance, sourceRecordId: `${ad.provenance.sourceRecordId}_dup` } };
    const res = await ingestBatch({ schemaVersion: 1, events: [dup] }, { businessId: TEST_BUSINESS });
    expect(res.result.accepted).toBe(1);
    const [snap] = await computeSnapshots({ businessId: TEST_BUSINESS, simulationRunId: RUN, startAt: START, endAt: END, bucket: "window", dimension: {}, virtualTime: END });
    expect(snap.counters.impressions).toBe(manual(events, START, END).impressions);
    const camps = await campaignBreakdown(TEST_BUSINESS, RUN, START, END);
    expect(camps.find((c) => c.campaignId === (ad.type === "ad.metrics_observed" ? ad.payload.campaignId : ""))!.impressions)
      .toBe(manual(events.filter((e) => e.type === "ad.metrics_observed" && e.payload.campaignId === (ad.type === "ad.metrics_observed" ? ad.payload.campaignId : "")), START, END).impressions);
  });

  it("product breakdown reconciles to order lines and inventory; campaign breakdown arithmetic is exact", async () => {
    const products = await productBreakdown(TEST_BUSINESS, RUN, START, END);
    expect(products).toHaveLength(17);
    const totalRevenue = products.reduce((a, p) => a + p.revenueMinor, 0);
    expect(totalRevenue).toBe(manual(events, START, END).revenueMinor);
    for (const p of products) expect(p.availableUnits).toBeGreaterThanOrEqual(0);
    const camps = await campaignBreakdown(TEST_BUSINESS, RUN, START, END);
    expect(camps).toHaveLength(5);
    for (const c of camps) {
      expect(c.ctr).toBeCloseTo(c.clicks / c.impressions, 10);
      if (c.attributedOrders > 0) expect(c.costPerAcquisitionMinor).toBe(Math.round(c.spendMinor / c.attributedOrders));
      expect(c.roas).toBe(Math.round((c.attributedRevenueMinor / c.spendMinor) * 100) / 100);
    }
  });

  it("persists validated snapshots idempotently, including the per-tick hook", async () => {
    const snaps = await computeSnapshots({ businessId: TEST_BUSINESS, simulationRunId: RUN, startAt: START, endAt: END, bucket: "day", dimension: {}, virtualTime: END });
    const ids1 = await persistSnapshots(snaps);
    const ids2 = await persistSnapshots(snaps);
    expect(ids1).toEqual(ids2);
    const db = await getDb();
    expect(await db.collection(COLLECTIONS.metricSnapshots).countDocuments({ businessId: TEST_BUSINESS, snapshotId: { $in: ids1 } })).toBe(2);
    const hookIds = await snapshotTickWindows(TEST_BUSINESS, RUN, [{ startAt: START, endAt: "2026-10-01T01:00:00.000Z" }, { startAt: "2026-10-01T01:00:00.000Z", endAt: "2026-10-01T02:00:00.000Z" }], END, db);
    expect(hookIds).toHaveLength(2);
    const stored = await db.collection(COLLECTIONS.metricSnapshots).findOne({ businessId: TEST_BUSINESS, snapshotId: hookIds[0] }, { projection: { _id: 0, simulationRunId: 0 } });
    expect(MetricSnapshot.safeParse(stored).success).toBe(true);
  });
});
