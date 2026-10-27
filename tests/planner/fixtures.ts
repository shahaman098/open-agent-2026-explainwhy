import handoff from "../../packages/contracts/examples/plan-handoff.json";
import { Diagnosis, Evidence } from "@normal/contracts";
import type { PlanningContext } from "@/planner/context";
import { DELAY_BANNER_MESSAGE } from "@/planner/context";
import { PlanningOutput, type StrategyT } from "@/planner/schemas";

export function contextFixture(cause: "ad_fatigue" | "delivery_delays" | "discount_failure" = "ad_fatigue"): PlanningContext {
  const diagnosis = Diagnosis.parse({ ...handoff.diagnosis, primaryCause: cause, hypotheses: [{ ...handoff.diagnosis.hypotheses[cause === "delivery_delays" ? 1 : 0], cause }] });
  return { scope: { businessId: diagnosis.businessId, simulationRunId: "test_run", investigationId: diagnosis.investigationId }, diagnosis,
    report: { ledger: [] } as unknown as PlanningContext["report"], evidence: handoff.evidence.map((item) => Evidence.parse(item)), cutoff: "2026-10-23T19:00:00Z",
    evidenceDetails: [{ evidenceId: "e_ads_01", tool: "advertising_analysis", input: null, detail: { campaigns: [{ campaignId: "campaign_A", roas: 1, baselineRoas: 4, costPerAcquisitionMinor: 6000, baselineCostPerAcquisitionMinor: 2000 }] } }],
    campaigns: [{ campaignId: "campaign_A", name: "Campaign A", platform: "meta_ads", status: "active", dailyBudgetMinor: 10000, currency: "GBP", targetCategory: "running", targetProductIds: [], totals: { impressions: 0, clicks: 0, spendMinor: 0, sessions: 0, attributedOrders: 0, attributedRevenueMinor: 0 }, updatedAt: "2026-10-23T19:00:00Z" }],
    delayedOrders: ["ord_001", "ord_002"].map((orderId) => ({ orderId, customerId: "test_customer", placedAt: "2026-10-20T00:00:00Z", netRevenueMinor: 5000, status: "placed", shipment: { status: "delayed", promisedAt: "2026-10-22T00:00:00Z" } })),
    storefront: { banners: [], activeBanners: [], promotions: [], virtualTime: "2026-10-23T19:00:00Z", updatedAt: "2026-10-23T19:00:00Z" }, alreadyNotified: [], affectedCampaigns: ["campaign_A"], advisoryOnly: cause === "discount_failure" };
}
export function strategyFixture(shipping = false): StrategyT {
  const common = { safeguards: ["Recheck state before execution."], rollback: "Restore the prior value after human review; notices cannot be unsent.", partialFailure: "Stop dependent actions, retain receipts, request review.", risk: "medium" as const, evidenceIds: [shipping ? "e_ship_01" : "e_ads_01"] };
  return { key: "bounded", title: "Bounded intervention", explanation: "Apply a reversible response to the verified evidence.", benefit: "Contain exposure while monitoring recovery.", downside: "May reduce demand or add messaging noise.", risk: "medium", feasibility: "Existing adapters support the proposed parameters.", reversibility: "Budgets can be restored; messages cannot be unsent.", uncertainty: "The causal assessment remains qualified.", evidenceIds: common.evidenceIds,
    actions: shipping ? [
      { ...common, key: "notice", title: "Notify delayed cohort", rationale: "The shipping evidence supports a targeted notice.", actionType: "customer.send_delay_notice", budget: null, notice: { orderIds: ["ord_001", "ord_002"], templateId: "default", maxRecipients: 2 }, banner: null, dependsOnKeys: [] },
      { ...common, key: "banner", title: "Publish factual delivery context", rationale: "Set clear expectations for current visitors.", actionType: "storefront.publish_banner", budget: null, notice: null, banner: { message: DELAY_BANNER_MESSAGE, durationHours: 24 }, dependsOnKeys: ["notice"] },
    ] : [{ ...common, key: "budget", title: "Reduce campaign budget", rationale: "Advertising evidence supports a bounded change.", actionType: "ads.set_daily_budget", budget: { campaignId: "campaign_A", newDailyBudgetMinor: 8000, currency: "GBP" }, notice: null, banner: null, dependsOnKeys: [] }],
    advisory: [], successCriteria: [{ metric: shipping ? "late_delivery_rate" : "cac_minor", direction: "decrease", target: null, measurementWindowMinutes: 240 }], comparison: "Prefer a bounded intervention over an irreversible broad change." };
}
export function outputFixture() {
  const selected = strategyFixture();
  return PlanningOutput.parse({ strategies: [selected, { ...selected, key: "observe", title: "Continue observation", actions: [], advisory: ["Collect another comparable window before intervening."] }], recommendedKey: selected.key, recommendation: "The bounded response balances risk and current evidence." });
}
