import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BusinessEvent } from "@normal/contracts";
import {
  AdapterError, listDelayedOrders, publishBanner, readCampaign, readCampaigns, readOrdersShipping, readStorefront, readTestInbox,
  sendDelayNotice, setDailyBudget, verifyAction,
} from "@/adapters";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { injectScenario, startRun, tickRun } from "@/simulator/runtime";
import type { SimulatedOrder } from "@/types/domain";
import { TEST_BUSINESS, eventsForRun, resetTestRun } from "../helpers";

const RUN = "t_adapters";
const ctx = { businessId: TEST_BUSINESS, simulationRunId: RUN };

async function spendFor(campaignId: string, fromTick: number, toTick: number): Promise<{ spend: number; impressions: number }> {
  const events = await eventsForRun(RUN, "ad.metrics_observed");
  const windows = events.filter((e) => e.type === "ad.metrics_observed" && e.payload.campaignId === campaignId);
  const slice = windows.slice(fromTick, toTick);
  return slice.reduce((a, e) => e.type === "ad.metrics_observed" ? { spend: a.spend + e.payload.spendMinor, impressions: a.impressions + e.payload.impressions } : a, { spend: 0, impressions: 0 });
}

describe("partner execution adapters (Milestone 3)", () => {
  beforeAll(async () => {
    await resetTestRun(RUN);
    const db = await getDb();
    await db.collection("action_receipts").deleteMany({ businessId: TEST_BUSINESS });
    await startRun({ businessId: TEST_BUSINESS, simulationRunId: RUN, seed: 42, makeActive: false });
    await tickRun({ simulationRunId: RUN, ticks: 48 }, { businessId: TEST_BUSINESS });
  });
  afterAll(async () => {
    await resetTestRun(RUN);
    const db = await getDb();
    await db.collection("action_receipts").deleteMany({ businessId: TEST_BUSINESS });
  });

  it("reads campaign state without hidden parameters", async () => {
    const campaigns = await readCampaigns(ctx);
    expect(campaigns).toHaveLength(5);
    expect(JSON.stringify(campaigns)).not.toContain("baseCtr");
    expect(campaigns[0].totals.impressions).toBeGreaterThan(0);
  });

  it("ads.set_daily_budget changes persisted budget, emits campaign.budget_updated once, and later ticks obey it", async () => {
    const before = (await readCampaign(ctx, "cmp_running_pegasus"))!;
    const baselineSpend = await spendFor("cmp_running_pegasus", 24, 48);
    const action = { businessId: TEST_BUSINESS, simulationRunId: RUN, actionId: "act_ads_001", idempotencyKey: "plan_t:v1:act_ads_001" };
    const result = await setDailyBudget(action, { campaignId: "cmp_running_pegasus", newDailyBudgetMinor: Math.round(before.dailyBudgetMinor / 2), currency: "GBP" });
    expect(result.applied).toBe(true);
    expect(result.state.dailyBudgetMinor).toBe(Math.round(before.dailyBudgetMinor / 2));
    expect(result.emittedEventIds).toHaveLength(1);
    const cb = (await eventsForRun(RUN, "campaign.budget_updated"))[0];
    expect(BusinessEvent.safeParse(cb).success).toBe(true);
    expect(cb.type === "campaign.budget_updated" && cb.payload).toMatchObject({ campaignId: "cmp_running_pegasus", previousDailyBudgetMinor: before.dailyBudgetMinor, actionId: "act_ads_001" });
    expect(cb.provenance.ingestMethod).toBe("action_callback");

    // Replay with the same idempotency key: no second change, no second event.
    const replay = await setDailyBudget(action, { campaignId: "cmp_running_pegasus", newDailyBudgetMinor: Math.round(before.dailyBudgetMinor / 2), currency: "GBP" });
    expect(replay.applied).toBe(false);
    expect((await eventsForRun(RUN, "campaign.budget_updated")).length).toBe(1);

    // Future behaviour follows the new budget.
    await tickRun({ simulationRunId: RUN, ticks: 24 }, { businessId: TEST_BUSINESS });
    const after = await spendFor("cmp_running_pegasus", 48, 72);
    expect(after.spend).toBeLessThanOrEqual(result.state.dailyBudgetMinor);
    expect(after.spend).toBeLessThan(baselineSpend.spend * 0.65);
    expect(after.impressions).toBeLessThan(baselineSpend.impressions * 0.65);
    // Other campaigns are unaffected (same budget, same order of spend).
    const otherBefore = await spendFor("cmp_lifestyle_af1", 24, 48);
    const otherAfter = await spendFor("cmp_lifestyle_af1", 48, 72);
    expect(otherAfter.spend).toBeGreaterThan(otherBefore.spend * 0.8);

    const verification = await verifyAction(ctx, action.idempotencyKey);
    expect(verification).toMatchObject({ found: true, toolName: "ads.set_daily_budget", stateMatches: true, callbackEventsPresent: true });
  });

  it("enforces server-side limits and exact param schema", async () => {
    const action = { businessId: TEST_BUSINESS, simulationRunId: RUN, actionId: "act_ads_002", idempotencyKey: "plan_t:v1:act_ads_002" };
    await expect(setDailyBudget(action, { campaignId: "cmp_running_pegasus", newDailyBudgetMinor: 999_999, currency: "GBP" })).rejects.toBeInstanceOf(AdapterError);
    await expect(setDailyBudget(action, { campaignId: "cmp_running_pegasus", newDailyBudgetMinor: 100, currency: "GBP" })).rejects.toMatchObject({ code: "budget_change_limit" });
    await expect(setDailyBudget(action, { campaignId: "cmp_running_pegasus", newDailyBudgetMinor: 5000, currency: "USD" })).rejects.toMatchObject({ code: "currency_mismatch" });
    await expect(setDailyBudget(action, { campaignId: "cmp_running_pegasus", budget: 5000 })).rejects.toThrow();
    await expect(setDailyBudget(action, { campaignId: "nope", newDailyBudgetMinor: 5000, currency: "GBP" })).rejects.toMatchObject({ code: "campaign_not_found" });
    expect((await eventsForRun(RUN, "campaign.budget_updated")).length).toBe(1);
  });

  it("customer.send_delay_notice writes to the fake inbox only and emits customer.message_sent per real order", async () => {
    await injectScenario({ simulationRunId: RUN, scenario: "delivery_delays", severity: 0.9 }, TEST_BUSINESS);
    await tickRun({ simulationRunId: RUN, ticks: 60 }, { businessId: TEST_BUSINESS });
    const delayed = await listDelayedOrders(ctx, 20);
    expect(delayed.length).toBeGreaterThan(0);
    const orderIds = delayed.slice(0, 3).map((o) => o.orderId);
    const action = { businessId: TEST_BUSINESS, simulationRunId: RUN, actionId: "act_cc_001", idempotencyKey: "plan_t:v1:act_cc_001" };
    const result = await sendDelayNotice(action, { orderIds: [...orderIds, "ord_does_not_exist"], templateId: "delay_notice_v1", maxRecipients: 10 });
    expect(result.applied).toBe(true);
    expect(result.state.messages).toHaveLength(orderIds.length);
    expect(result.state.skippedOrderIds).toEqual(["ord_does_not_exist"]);
    expect(result.state.messages.every((m) => m.inbox === "demo_test_inbox")).toBe(true);
    const events = await eventsForRun(RUN, "customer.message_sent");
    expect(events).toHaveLength(orderIds.length);
    for (const e of events) {
      expect(e.type === "customer.message_sent" && orderIds.includes(e.payload.orderId)).toBe(true);
      expect(e.provenance.ingestMethod).toBe("action_callback");
    }
    const inbox = await readTestInbox(ctx);
    expect(inbox.length).toBe(orderIds.length);
    expect(inbox[0].body).toContain("[Demo test inbox]");
    const replay = await sendDelayNotice(action, { orderIds, templateId: "delay_notice_v1", maxRecipients: 10 });
    expect(replay.applied).toBe(false);
    expect((await eventsForRun(RUN, "customer.message_sent")).length).toBe(orderIds.length);
    const shipping = await readOrdersShipping(ctx, orderIds);
    expect(shipping.every((s) => s.shipment?.status === "delayed" || s.shipment?.status === "delivered")).toBe(true);
    expect(await verifyAction(ctx, action.idempotencyKey)).toMatchObject({ found: true, stateMatches: true, callbackEventsPresent: true });
  });

  it("storefront.publish_banner persists a visible banner and emits storefront.banner_published", async () => {
    const view0 = await readStorefront(ctx);
    expect(view0.activeBanners).toHaveLength(0);
    const action = { businessId: TEST_BUSINESS, simulationRunId: RUN, actionId: "act_sf_001", idempotencyKey: "plan_t:v1:act_sf_001" };
    const startsAt = view0.virtualTime;
    const expiresAt = new Date(Date.parse(startsAt) + 48 * 3_600_000).toISOString();
    const result = await publishBanner(action, { bannerId: "bnr_delay_apology", message: "Deliveries are running late this week — thank you for your patience.", startsAt, expiresAt });
    expect(result.applied).toBe(true);
    expect(result.state.activeBanners.map((b) => b.bannerId)).toEqual(["bnr_delay_apology"]);
    const events = await eventsForRun(RUN, "storefront.banner_published");
    expect(events).toHaveLength(1);
    expect(events[0].type === "storefront.banner_published" && events[0].payload.bannerId).toBe("bnr_delay_apology");
    const replay = await publishBanner(action, { bannerId: "bnr_delay_apology", message: "changed text must not apply on replay", startsAt, expiresAt });
    expect(replay.applied).toBe(false);
    expect((await readStorefront(ctx)).banners[0].message).toContain("running late");
    await expect(publishBanner({ ...action, idempotencyKey: "plan_t:v1:act_sf_002" }, { bannerId: "b2", message: "x", startsAt: expiresAt, expiresAt: startsAt })).rejects.toMatchObject({ code: "invalid_window" });
    expect(await verifyAction(ctx, action.idempotencyKey)).toMatchObject({ found: true, stateMatches: true, callbackEventsPresent: true });
    expect(await verifyAction(ctx, "unknown-key")).toMatchObject({ found: false });
  });

  it("reads order + shipping status for storefront-relevant orders", async () => {
    const db = await getDb();
    const some = await db.collection<SimulatedOrder>(COLLECTIONS.simulatedOrders).find({ businessId: TEST_BUSINESS, simulationRunId: RUN }).limit(3).toArray();
    const views = await readOrdersShipping(ctx, some.map((o) => o.orderId));
    expect(views).toHaveLength(3);
    for (const v of views) expect(v.shipment).not.toBeNull();
  });
});
