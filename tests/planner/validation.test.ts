import { describe, expect, it } from "vitest";
import { PlanHandoff, planReferenceErrors } from "@normal/contracts";
import { validateStrategy } from "@/planner/validation";
import { PlanningOutput } from "@/planner/schemas";
import { contextHash } from "@/planner/context";
import { contextFixture, outputFixture, strategyFixture } from "./fixtures";

describe("planner deterministic validation (no adapter execution)", () => {
  it("creates an exact canonical budget proposal and handoff with no mutation", () => {
    const context = contextFixture(), before = structuredClone(context);
    const { check, plan } = validateStrategy(context, strategyFixture(), "plan_test");
    expect(check.passed).toBe(true); expect(plan?.actions[0].params).toEqual({ campaignId: "campaign_A", newDailyBudgetMinor: 8000, currency: "GBP" });
    const handoff = PlanHandoff.parse({ plan, diagnosis: context.diagnosis, evidence: context.evidence });
    expect(planReferenceErrors(handoff.plan, handoff.diagnosis, handoff.evidence)).toEqual([]);
    expect(plan?.actions[0].requiresApproval).toBe(true); expect(context).toEqual(before);
  });
  it("coordinates shipping notices before a factual banner with exact recipients and simulation dates", () => {
    const context = contextFixture("delivery_delays");
    const { plan, check } = validateStrategy(context, strategyFixture(true), "plan_ship");
    expect(check.errors).toEqual([]); expect(plan?.actions).toHaveLength(2);
    expect(plan?.actions[1].dependsOnActionIds).toEqual([plan?.actions[0].actionId]);
    expect(plan?.actions[0].params).toEqual({ orderIds: ["ord_001", "ord_002"], maxRecipients: 2, templateId: "default" });
    expect(plan?.actions[1].params).toMatchObject({ startsAt: "2026-10-23T19:00:00Z", expiresAt: "2026-10-24T19:00:00.000Z" });
    expect(check.actions[0].partialFailure).toContain("Stop dependent");
    const handoff = PlanHandoff.parse({ plan, diagnosis: context.diagnosis, evidence: context.evidence });
    expect(planReferenceErrors(handoff.plan, handoff.diagnosis, handoff.evidence)).toEqual([]);
  });
  it("keeps checkout repairs advisory-only and rejects even an otherwise registered substitute action", () => {
    const context = contextFixture("discount_failure"), action = strategyFixture();
    expect(validateStrategy(context, action, "plan_bad").check.passed).toBe(false);
    expect(validateStrategy(context, { ...action, actions: [], advisory: ["Investigate coupon validation; there is no repair adapter."] }, "plan_advice")).toMatchObject({ plan: null, check: { passed: true } });
  });
  it("rejects unknown actions and malformed model output", () => {
    const output = outputFixture();
    expect(PlanningOutput.safeParse({ ...output, strategies: [{ ...output.strategies[0], actions: [{ ...output.strategies[0].actions[0], actionType: "coupon.fix" }] }, output.strategies[1]] }).success).toBe(false);
    expect(PlanningOutput.safeParse({ strategies: [] }).success).toBe(false);
  });
  it("rejects unknown targets, cross-investigation evidence, excessive budgets and duplicate/conflicting actions", () => {
    for (const modify of [
      (strategy: ReturnType<typeof strategyFixture>) => { strategy.actions[0].budget!.campaignId = "other_campaign"; },
      (strategy: ReturnType<typeof strategyFixture>) => { strategy.actions[0].budget!.newDailyBudgetMinor = 100000; },
      (strategy: ReturnType<typeof strategyFixture>) => { strategy.actions[0].evidenceIds = ["foreign_evidence"]; },
      (strategy: ReturnType<typeof strategyFixture>) => { strategy.actions.push({ ...strategy.actions[0], key: "duplicate" }); },
      (strategy: ReturnType<typeof strategyFixture>) => { strategy.actions[0].dependsOnKeys = ["budget"]; },
    ]) { const strategy = strategyFixture(); modify(strategy); expect(validateStrategy(contextFixture(), strategy, "plan_reject").check.passed).toBe(false); }
  });
  it("rejects stale shipping recipients, unsafe messaging, duplicate notices and active-banner conflicts", () => {
    const context = contextFixture("delivery_delays"); context.alreadyNotified = ["ord_001"];
    expect(validateStrategy(context, strategyFixture(true), "plan_reject").plan).toBeNull();
    const strategy = strategyFixture(true); strategy.actions[1].banner!.message = "We guarantee delivery tomorrow with a free refund.";
    expect(validateStrategy(contextFixture("delivery_delays"), strategy, "plan_reject").check.passed).toBe(false);
    const recipients = strategyFixture(true); recipients.actions[0].notice!.orderIds.push("ord_001");
    expect(validateStrategy(contextFixture("delivery_delays"), recipients, "plan_reject").check.passed).toBe(false);
    const shipped = contextFixture("delivery_delays"); shipped.delayedOrders[0].shipment!.shippedAt = "2026-10-22T00:00:00Z";
    expect(validateStrategy(shipped, strategyFixture(true), "plan_reject").check.passed).toBe(false);
    const current = contextFixture("delivery_delays"); current.storefront.activeBanners = [{ bannerId: "existing", message: "existing", actionId: "prior", startsAt: current.storefront.virtualTime, publishedAt: current.storefront.virtualTime }];
    expect(validateStrategy(current, strategyFixture(true), "plan_reject").check.passed).toBe(false);
  });
  it("uses current state in stale checks and rejects invented numeric outcome forecasts", () => {
    const context = contextFixture(), changed = structuredClone(context); changed.campaigns[0].dailyBudgetMinor = 12000;
    expect(contextHash(context)).not.toBe(contextHash(changed));
    const strategy = strategyFixture(); strategy.benefit = "Guaranteed 40% revenue growth.";
    expect(validateStrategy(context, strategy, "plan_reject").check.passed).toBe(false);
  });
});
