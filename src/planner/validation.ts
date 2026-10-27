import "server-only";
import { ActionProposal, ProposedPlan, PlanHandoff, planReferenceErrors, type ActionProposalT, type ProposedPlanT } from "@normal/contracts";
import { ADAPTER_LIMITS } from "@/adapters/types";
import { DELAY_BANNER_MESSAGE, type PlanningContext } from "./context";
import type { ActionCheck, StrategyCheck, StrategyT } from "./schemas";

export function validateStrategy(context: PlanningContext, strategy: StrategyT, planId: string, planVersion = 1): { check: StrategyCheck; plan: ProposedPlanT | null } {
  const errors: string[] = [], actions: ActionProposalT[] = [], checks: ActionCheck[] = [];
  const evidence = new Map(context.evidence.map((item) => [item.evidenceId, item]));
  const primary = context.diagnosis.hypotheses.find((hypothesis) => hypothesis.cause === context.diagnosis.primaryCause);
  const supports = new Set(primary?.strength !== "weak" ? primary?.evidenceIds : []);
  if (strategy.evidenceIds.some((id) => !evidence.has(id) && !(context.archived && context.advisoryOnly && context.report.ledger.some((entry) => entry.evidenceId === id)))) errors.push("Strategy cites evidence outside this investigation.");
  if (context.advisoryOnly && strategy.actions.length) errors.push("This diagnosis has no supported repair adapter; keep it advisory-only.");
  const seen = new Set<string>(), targets = new Set<string>();
  for (const [index, action] of strategy.actions.entries()) {
    const actionId = `${planId}_${planVersion}_${index}`, invalid: string[] = [], preconditions: string[] = ["Exact plan/version approval required; no execution is authorized by planning." ];
    let current: unknown = null, params: unknown = null;
    const category = action.actionType === "ads.set_daily_budget" ? "advertising" : "fulfillment";
    if (!action.evidenceIds.length || action.evidenceIds.some((id) => !evidence.has(id) || !supports.has(id)) || !action.evidenceIds.some((id) => evidence.get(id)?.category === category)) invalid.push("Action requires relevant, primary-diagnosis supporting evidence in this scope.");
    if (seen.has(action.key) || action.dependsOnKeys.some((key) => !seen.has(key))) invalid.push("Duplicate action key, forward dependency or dependency cycle.");
    seen.add(action.key);
    if ([action.budget, action.notice, action.banner].filter(Boolean).length !== 1) invalid.push("Exactly one matching parameter object is required.");
    if (action.actionType === "ads.set_daily_budget") {
      const p = action.budget;
      const campaign = context.campaigns.find((item) => item.campaignId === p?.campaignId);
      current = campaign ? { campaignId: campaign.campaignId, dailyBudgetMinor: campaign.dailyBudgetMinor, currency: campaign.currency, status: campaign.status, updatedAt: campaign.updatedAt } : null;
      params = p;
      if (!p || !campaign || !context.affectedCampaigns.includes(p.campaignId)) invalid.push("Campaign does not exist in the affected business/run.");
      else {
        if (!["ad_inefficiency", "ad_fatigue"].includes(context.diagnosis.primaryCause)) invalid.push("Budget change is unrelated to the diagnosis.");
        if (campaign.status !== "active" || campaign.dailyBudgetMinor <= 0 || p.currency !== campaign.currency) invalid.push("Campaign state or currency does not permit this proposal.");
        const relative = p.newDailyBudgetMinor / campaign.dailyBudgetMinor;
        if (relative < 0.75 || relative > 1.25 || relative === 1 || p.newDailyBudgetMinor > ADAPTER_LIMITS.maxDailyBudgetMinor) invalid.push("Budget must change by at most 25%, remain positive and respect the adapter cap.");
        const linked = context.evidenceDetails?.some((detail) => action.evidenceIds.includes(detail.evidenceId) && detail.tool === "advertising_analysis" &&
          detail.detail && typeof detail.detail === "object" && "campaigns" in detail.detail && Array.isArray(detail.detail.campaigns) && detail.detail.campaigns.some((row: Record<string, unknown>) => row.campaignId === p.campaignId &&
            ((typeof row.roas === "number" && typeof row.baselineRoas === "number" && row.roas < row.baselineRoas) || (typeof row.costPerAcquisitionMinor === "number" && typeof row.baselineCostPerAcquisitionMinor === "number" && row.costPerAcquisitionMinor > row.baselineCostPerAcquisitionMinor) || (row.attributedOrders === 0 && typeof row.spendMinor === "number" && row.spendMinor > 0))));
        if (!linked) invalid.push("No cited campaign-level efficiency comparison justifies changing this target's budget.");
        const key = `budget:${p.campaignId}`;
        if (targets.has(key)) invalid.push("Conflicting duplicate campaign budget action."); targets.add(key);
        preconditions.push(`Re-read campaign ${campaign.campaignId}: budget ${campaign.dailyBudgetMinor} GBP minor units; status ${campaign.status}; updated ${campaign.updatedAt}. Abort on mismatch.`);
      }
    } else if (action.actionType === "customer.send_delay_notice") {
      const p = action.notice; params = p;
      if (context.diagnosis.primaryCause !== "delivery_delays") invalid.push("Delay notice requires a delivery-delay diagnosis.");
      if (!p || p.templateId !== "default" || new Set(p.orderIds).size !== p.orderIds.length || p.maxRecipients !== p.orderIds.length || p.maxRecipients > ADAPTER_LIMITS.maxDelayNoticeRecipients) invalid.push("Invalid notice template, duplicate recipients or recipient cap.");
      else for (const id of p.orderIds) {
        const order = context.delayedOrders.find((item) => item.orderId === id);
        if (!order || order.status !== "placed" || order.shipment?.status !== "delayed" || order.shipment.shippedAt || !Number.isFinite(Date.parse(order.shipment.promisedAt)) || Date.parse(order.shipment.promisedAt) > Date.parse(context.storefront.virtualTime) || context.alreadyNotified.includes(id)) invalid.push(`Order ${id} is not an eligible unnotified, unshipped delayed order for the default template in this run.`);
        if (targets.has(`order:${id}`)) invalid.push(`Duplicate notice for ${id}.`); targets.add(`order:${id}`);
      }
      current = context.delayedOrders.filter((order) => p?.orderIds.includes(order.orderId));
      preconditions.push("Recheck order ownership, delayed status, promised date and absence of prior notice immediately before execution. Default adapter template only; demo test inbox.");
    } else if (action.actionType === "storefront.publish_banner") {
      const p = action.banner;
      if (context.diagnosis.primaryCause !== "delivery_delays") invalid.push("Delivery banner requires a delivery-delay diagnosis.");
      if (!p || p.message !== DELAY_BANNER_MESSAGE || p.message.length > ADAPTER_LIMITS.maxBannerMessageLength || !Number.isInteger(p.durationHours) || p.durationHours < 1 || p.durationHours > 48) invalid.push("Use the approved factual delay message and a 1–48 hour duration; no promises, promotions or invented delivery dates.");
      if (!context.delayedOrders.length || context.storefront.activeBanners.length || targets.has("banner")) invalid.push("No delayed cohort, an active banner, or a conflicting banner prevents publication."); targets.add("banner");
      current = context.storefront;
      if (p) params = { bannerId: `banner_${actionId}`, message: p.message, startsAt: context.storefront.virtualTime, expiresAt: new Date(Date.parse(context.storefront.virtualTime) + p.durationHours * 3600000).toISOString() };
      preconditions.push("Recheck delayed cohort and storefront configuration. Abort if another banner is active. Dates use this run's simulation clock.");
    } else invalid.push("Unsupported action type.");
    const parsed = ActionProposal.safeParse({ actionId, agent: action.actionType === "ads.set_daily_budget" ? "marketing" : action.actionType === "customer.send_delay_notice" ? "customer_care" : "storefront",
      actionType: action.actionType, title: action.title, rationale: `${action.rationale}\nExecution preconditions: ${[...preconditions, ...action.safeguards].join(" ")}\nRollback / contingency: ${action.rollback}\nPartial failure: ${action.partialFailure}`, evidenceIds: action.evidenceIds, requiresApproval: true, risk: action.risk,
      dependsOnActionIds: action.dependsOnKeys.map((key) => `${planId}_${planVersion}_${strategy.actions.findIndex((item) => item.key === key)}`), params });
    if (!parsed.success) invalid.push("Canonical action schema rejected the parameters.");
    if (parsed.success) actions.push(parsed.data);
    checks.push({ actionId, passed: invalid.length === 0, errors: invalid, current, proposed: params, preconditions: [...preconditions, ...action.safeguards], rollback: action.rollback, partialFailure: action.partialFailure });
  }
  errors.push(...checks.flatMap((check) => check.errors));
  for (const criterion of strategy.successCriteria) {
    if (criterion.target !== null && !context.evidence.some((item) => item.measurements.some((measurement) => measurement.metric === criterion.metric && (measurement.value === criterion.target || measurement.baseline === criterion.target)))) errors.push("Numeric success targets must reference an observed current or baseline measurement; otherwise use a directional criterion.");
  }
  // Targets are measurements, not predictions. A numeric forecast cannot be disguised as the expected benefit.
  if ([strategy.benefit, strategy.explanation, strategy.comparison].some((text) => /\d[\d.,]*\s*%[^.]{0,50}(?:revenue|growth|ROI|probability|profit)|(?:revenue|growth|ROI|probability|profit)[^.]{0,50}\d[\d.,]*\s*%|(?:ROI|probability|success rate)[^.]{0,40}\d|\d[^.]{0,40}(?:ROI|probability|success rate)/i.test(text))) errors.push("Precise performance or probability forecasts are not supported.");
  let plan: ProposedPlanT | null = null;
  if (strategy.actions.length && !errors.length) {
    const now = new Date().toISOString();
    const candidate = ProposedPlan.safeParse({ schemaVersion: 1, businessId: context.scope.businessId, planId, planVersion, investigationId: context.scope.investigationId, diagnosisId: context.diagnosis.diagnosisId,
      status: "proposed", objective: strategy.title, summary: `${strategy.explanation}\nExpected benefit: ${strategy.benefit}\nDownside / risk: ${strategy.downside}\nFeasibility: ${strategy.feasibility}\nReversibility: ${strategy.reversibility}\nUncertainty: ${strategy.uncertainty}\nComparison: ${strategy.comparison}`, actions,
      successCriteria: strategy.successCriteria.map(({ target, ...criterion }) => ({ ...criterion, ...(target === null ? {} : { target }) })), createdAt: now, expiresAt: new Date(Date.parse(now) + 24 * 3600000).toISOString() });
    if (!candidate.success) errors.push("Canonical ProposedPlan validation failed.");
    else {
      errors.push(...planReferenceErrors(candidate.data, context.diagnosis, context.evidence));
      if (!errors.length) { PlanHandoff.parse({ plan: candidate.data, diagnosis: context.diagnosis, evidence: context.evidence }); plan = candidate.data; }
    }
  }
  return { check: { strategyKey: strategy.key, passed: errors.length === 0, errors, actions: checks }, plan };
}
