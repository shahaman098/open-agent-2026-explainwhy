import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BusinessEvent, MetricSnapshot, type BusinessEventT } from "@normal/contracts";
import { readCampaign, setDailyBudget, verifyAction } from "@/adapters";
import { campaignBreakdown, computeSnapshots, snapshotTickWindows } from "@/analytics/metrics";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { checkout } from "@/simulator/checkout";
import { loadState } from "@/simulator/persistence";
import { getRunSummary, injectScenario, startRun, tickRun } from "@/simulator/runtime";
import { addHours } from "@/simulator/time";
import type { SimulatedCustomer, SimulatedProduct } from "@/types/domain";
import { TEST_BUSINESS, eventsForRun, normaliseEvents, resetTestRun } from "../helpers";

const RUN = "t_regression";
const RUN_B = "t_regression_b";
const START = "2026-10-01T00:00:00.000Z";
const T = (h: number) => addHours(START, h);
const tickOpts = { businessId: TEST_BUSINESS, afterPersist: (s: { businessId: string; simulationRunId: string; virtualTime: string }, w: Array<{ startAt: string; endAt: string }>, db: Parameters<typeof snapshotTickWindows>[4]) => snapshotTickWindows(s.businessId, s.simulationRunId, w, s.virtualTime, db) };

async function dayMetrics(fromH: number, toH: number) {
  const [snap] = await computeSnapshots({ businessId: TEST_BUSINESS, simulationRunId: RUN, startAt: T(fromH), endAt: T(toH), bucket: "window", dimension: {}, virtualTime: T(toH) });
  const campaigns = await campaignBreakdown(TEST_BUSINESS, RUN, T(fromH), T(toH));
  return { snap, campaigns };
}

describe("Milestone 7 — full system regression (seed 42)", () => {
  beforeAll(async () => { await resetTestRun(RUN); await resetTestRun(RUN_B); }, 120_000);
  afterAll(async () => { await resetTestRun(RUN); await resetTestRun(RUN_B); }, 120_000);

  let baseline: Awaited<ReturnType<typeof dayMetrics>>;
  let fatigued: Awaited<ReturnType<typeof dayMetrics>>;
  let af1Before: { spend: number; impressions: number };
  let newBudget: number;

  it("1-3. initialises the twin from seed 42 and records a healthy 3-day baseline", async () => {
    const summary = await startRun({ businessId: TEST_BUSINESS, simulationRunId: RUN, seed: 42, makeActive: true });
    expect(summary.run.seed).toBe(42);
    const res = await tickRun({ simulationRunId: RUN, ticks: 60 }, tickOpts);
    expect(res.metricSnapshotIds).toHaveLength(60);
    await tickRun({ simulationRunId: RUN, ticks: 12 }, tickOpts);
    baseline = await dayMetrics(48, 72);
    expect(MetricSnapshot.safeParse(baseline.snap).success).toBe(true);
    expect(baseline.snap.counters.orders).toBeGreaterThan(10);
    expect(baseline.snap.counters.revenueMinor).toBeGreaterThan(100_000);
    expect(baseline.snap.rates.ctr).toBeGreaterThan(0.01);
    expect(baseline.snap.completeness).toBe("complete");
  }, 600_000);

  it("4-7. ad_fatigue (0.8) degrades campaign behaviour and the metrics reveal it", async () => {
    await injectScenario({ simulationRunId: RUN, scenario: "ad_fatigue", severity: 0.8 }, TEST_BUSINESS);
    await tickRun({ simulationRunId: RUN, ticks: 60 }, tickOpts);
    await tickRun({ simulationRunId: RUN, ticks: 12 }, tickOpts);
    fatigued = await dayMetrics(120, 144);
    // Evidence straight from MongoDB.
    const ads = (await eventsForRun(RUN, "ad.metrics_observed")).filter((e): e is Extract<BusinessEventT, { type: "ad.metrics_observed" }> => e.type === "ad.metrics_observed");
    const after = ads.filter((e) => e.payload.window.startAt >= T(120) && e.payload.window.startAt < T(144));
    const before = ads.filter((e) => e.payload.window.startAt >= T(48) && e.payload.window.startAt < T(72));
    expect(after).toHaveLength(5 * 24);
    const avgFreq = (xs: typeof ads) => xs.reduce((a, e) => a + e.payload.frequency, 0) / xs.length;
    expect(avgFreq(after)).toBeGreaterThan(avgFreq(before) * 1.5);
    expect(fatigued.snap.rates.ctr!).toBeLessThan(baseline.snap.rates.ctr! * 0.6);
    expect(fatigued.snap.counters.clicks).toBeLessThan(baseline.snap.counters.clicks * 0.6);
    expect(fatigued.snap.counters.adSpendMinor).toBeGreaterThan(baseline.snap.counters.adSpendMinor * 0.85);
    expect(fatigued.snap.counters.attributedOrders).toBeLessThan(baseline.snap.counters.attributedOrders);
    expect(fatigued.snap.counters.revenueMinor).toBeLessThan(baseline.snap.counters.revenueMinor);
    const hidden = JSON.stringify([...after, ...(await eventsForRun(RUN, "order.completed"))]);
    for (const k of ["ctrFatigueStrength", "adAudienceShrink", "scenario"]) expect(hidden).not.toContain(k);
  }, 600_000);

  it("8-10. a safe budget change through the adapter alters future advertising", async () => {
    const af1 = (await readCampaign({ businessId: TEST_BUSINESS, simulationRunId: RUN }, "cmp_lifestyle_af1"))!;
    af1Before = { spend: fatigued.campaigns.find((c) => c.campaignId === "cmp_lifestyle_af1")!.spendMinor, impressions: fatigued.campaigns.find((c) => c.campaignId === "cmp_lifestyle_af1")!.impressions };
    newBudget = Math.round(af1.dailyBudgetMinor / 2);
    const ctx = { businessId: TEST_BUSINESS, simulationRunId: RUN, actionId: "act_reg_budget", idempotencyKey: "plan_reg:v1:act_reg_budget" };
    const result = await setDailyBudget(ctx, { campaignId: "cmp_lifestyle_af1", newDailyBudgetMinor: newBudget, currency: "GBP" });
    expect(result.applied).toBe(true);
    const callback = await eventsForRun(RUN, "campaign.budget_updated");
    expect(callback).toHaveLength(1);
    expect(BusinessEvent.safeParse(callback[0]).success).toBe(true);
    await tickRun({ simulationRunId: RUN, ticks: 24 }, tickOpts);
    const next = await dayMetrics(144, 168);
    const af1After = next.campaigns.find((c) => c.campaignId === "cmp_lifestyle_af1")!;
    expect(af1After.spendMinor).toBeLessThanOrEqual(newBudget);
    expect(af1After.spendMinor).toBeLessThan(af1Before.spend * 0.65);
    expect(af1After.impressions).toBeLessThan(af1Before.impressions * 0.65);
    const pegBefore = fatigued.campaigns.find((c) => c.campaignId === "cmp_running_pegasus")!.spendMinor;
    const pegAfter = next.campaigns.find((c) => c.campaignId === "cmp_running_pegasus")!.spendMinor;
    expect(pegAfter).toBeGreaterThan(pegBefore * 0.85);
    expect(await verifyAction({ businessId: TEST_BUSINESS, simulationRunId: RUN }, ctx.idempotencyKey)).toMatchObject({ stateMatches: true, callbackEventsPresent: true });
  }, 600_000);

  it("11-12. delivery_delays (0.8) delays shipments and hurts customers downstream", async () => {
    const db = await getDb();
    const satBefore = await db.collection<SimulatedCustomer>(COLLECTIONS.simulatedCustomers).aggregate<{ avg: number }>([{ $match: { businessId: TEST_BUSINESS, simulationRunId: RUN } }, { $group: { _id: null, avg: { $avg: "$satisfaction" } } }]).next();
    await injectScenario({ simulationRunId: RUN, scenario: "delivery_delays", severity: 0.8 }, TEST_BUSINESS);
    // Seven virtual days: delayed parcels are delivered 3-10 days after purchase, so downstream effects need room to appear.
    for (let i = 0; i < 3; i++) await tickRun({ simulationRunId: RUN, ticks: 56 }, tickOpts);
    const [late] = await computeSnapshots({ businessId: TEST_BUSINESS, simulationRunId: RUN, startAt: T(264), endAt: T(336), bucket: "window", dimension: {}, virtualTime: T(336) });
    expect(late.counters.shipments).toBeGreaterThan(20);
    // Delays only become observable ~48h after dispatch, so a 3-day window right after injection understates the
    // eventual rate; require a sharp rise versus the healthy baseline rather than the long-run plateau.
    expect(late.rates.lateDeliveryRate!).toBeGreaterThan(0.25);
    expect(baseline.snap.rates.lateDeliveryRate ?? 0).toBeLessThan(0.15);
    expect(late.rates.lateDeliveryRate!).toBeGreaterThan((baseline.snap.rates.lateDeliveryRate ?? 0.01) * 4);
    // Downstream customer effect, causally: customers whose parcel was delayed in this window are now less satisfied
    // than customers whose parcel arrived on time (the whole-pool mean is diluted by new visitors and on-time boosts).
    const byOutcome = await db.collection(COLLECTIONS.simulatedShipments).aggregate<{ _id: string; avg: number; n: number }>([
      { $match: { businessId: TEST_BUSINESS, simulationRunId: RUN, status: "delivered", deliveredAt: { $gte: T(192) } } },
      { $lookup: { from: COLLECTIONS.simulatedCustomers, let: { cid: "$customerId" }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$customerId", "$$cid"] }, { $eq: ["$simulationRunId", RUN] }] } } }], as: "customer" } },
      { $unwind: "$customer" },
      { $group: { _id: "$plannedOutcome", avg: { $avg: "$customer.satisfaction" }, n: { $sum: 1 } } },
    ]).toArray();
    const delayedSat = byOutcome.find((b) => b._id === "delayed");
    const onTimeSat = byOutcome.find((b) => b._id === "on_time");
    expect(delayedSat!.n).toBeGreaterThan(5);
    expect(delayedSat!.avg).toBeLessThan(onTimeSat!.avg - 0.05);
    expect(satBefore!.avg).toBeGreaterThan(0.5);
    const delayedEvents = (await eventsForRun(RUN, "delivery.status_changed")).filter((e) => e.type === "delivery.status_changed" && e.payload.status === "delayed" && e.occurredAt >= T(264));
    expect(delayedEvents.length).toBeGreaterThan(20);
  }, 900_000);

  it("13-14. a storefront purchase persists an order, events and an inventory change", async () => {
    const db = await getDb();
    const before = (await db.collection<SimulatedProduct>(COLLECTIONS.simulatedProducts).findOne({ businessId: TEST_BUSINESS, simulationRunId: RUN, productId: "nk_air_force_1_07" }))!;
    const res = await checkout({ businessId: TEST_BUSINESS, simulationRunId: RUN, idempotencyKey: "regression-checkout-0001", items: [{ productId: "nk_air_force_1_07", quantity: 1 }], device: "ios" });
    expect(res.status).toBe("completed");
    const order = res.order!;
    expect(order.netRevenueMinor).toBe(10999);
    const after = (await db.collection<SimulatedProduct>(COLLECTIONS.simulatedProducts).findOne({ businessId: TEST_BUSINESS, simulationRunId: RUN, productId: "nk_air_force_1_07" }))!;
    expect(after.availableUnits).toBe(before.availableUnits - 1);
    const stored = await db.collection(COLLECTIONS.simulatedOrders).findOne({ businessId: TEST_BUSINESS, orderId: order.orderId });
    expect(stored).not.toBeNull();
    const ev = (await eventsForRun(RUN)).filter((e) => e.provenance.sourceRecordId.includes(order.orderId));
    expect(ev.map((e) => e.type).sort()).toEqual(["delivery.status_changed", "inventory.level_changed", "order.completed"]);
    const [snap] = await computeSnapshots({ businessId: TEST_BUSINESS, simulationRunId: RUN, startAt: T(336), endAt: T(337), bucket: "window", dimension: {}, virtualTime: T(336) });
    expect(snap.counters.revenueMinor).toBe(10999);
    expect(snap.completeness).toBe("partial");
  }, 120_000);

  it("15-16. durable state and history survive a fresh load (restart equivalence)", async () => {
    const db = await getDb();
    const state = (await loadState(db, TEST_BUSINESS, RUN))!;
    expect(state.tickIndex).toBe(336);
    expect(state.virtualTime).toBe(T(336));
    expect(state.lock).toBeNull();
    expect(state.activeScenario).toBe("delivery_delays");
    const summary = await getRunSummary(TEST_BUSINESS, RUN);
    expect(summary.run.virtualTime).toBe(T(336));
    const events = await eventsForRun(RUN);
    // tick events + 1 budget callback + 3 storefront events (session, order, pending delivery) + 1 inventory event
    expect(events.length).toBe(state.totals.events + 1 + 4);
    expect(await db.collection(COLLECTIONS.simulatedOrders).countDocuments({ businessId: TEST_BUSINESS, simulationRunId: RUN })).toBe(state.totals.orders + 1);
    expect(await db.collection(COLLECTIONS.metricSnapshots).countDocuments({ businessId: TEST_BUSINESS, simulationRunId: RUN })).toBe(336);
    for (const e of events.slice(0, 200)) expect(BusinessEvent.safeParse(e).success).toBe(true);
  }, 120_000);

  it("17. replaying seed 42 in a new run reproduces the first three days exactly", async () => {
    await startRun({ businessId: TEST_BUSINESS, simulationRunId: RUN_B, seed: 42, makeActive: false });
    await tickRun({ simulationRunId: RUN_B, ticks: 60 }, { businessId: TEST_BUSINESS });
    await tickRun({ simulationRunId: RUN_B, ticks: 12 }, { businessId: TEST_BUSINESS });
    // Run B contains exactly the first 72 ticks; compare each of its events with run A by (normalised) eventId.
    const a = normaliseEvents(await eventsForRun(RUN), RUN);
    const b = normaliseEvents(await eventsForRun(RUN_B), RUN_B);
    expect(b.length).toBeGreaterThan(2000);
    const aById = new Map(a.map((e) => [e.eventId, e]));
    for (const e of b) expect(aById.get(e.eventId), e.eventId).toEqual(e);
    // And run A has nothing extra inside the first 72 hours beyond what B produced.
    const bIds = new Set(b.map((e) => e.eventId));
    const extra = a.filter((e) => !bIds.has(e.eventId) && e.occurredAt < T(72));
    expect(extra).toEqual([]);
  }, 600_000);
});
