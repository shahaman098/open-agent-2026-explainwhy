"use client";

import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ActionExecutionT, ActionProposalT, PlanApprovalT, ProposedPlanT } from "@normal/contracts";
import type { ExternalSourceT, ReportT, StateT } from "@/intelligence/investigator/schemas";
import type { PlanningView, StrategyT } from "@/planner/schemas";
import type { BusinessOutcomeAssessmentT } from "@/outcomes/schema";
import { virtualDate } from "@/lib/format";
import { api, q, type Bundle, type EvidenceItem } from "./api";
import { internalCardView, scopedExternalSources } from "./evidence-card-model";
import { ComparisonPreview, InvestigationCanvas, type CanvasBlock } from "./InvestigationCanvas";
import { AssessmentDetail, type OutcomeDetailRow } from "./Outcomes";

type InvestigationView = { state: StateT | null; report: ReportT | null; sources: ExternalSourceT[] };
type ReviewRow = { plan: ProposedPlanT; approval: PlanApprovalT | null; run: { status: string } | null; executions: ActionExecutionT[] };
type OutcomeRow = OutcomeDetailRow;
type StoryData = { ai: InvestigationView | null; planning: PlanningView | null; review: ReviewRow | null; outcomes: OutcomeRow[]; errors: string[] };

const label = (value: string) => value.replaceAll("_", " ");
const money = (minor: number) => `£${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percentage = (value: number) => `${(value * 100).toFixed(2)}%`;
const short = (value: string | null | undefined, max = 230) => {
  if (!value) return "";
  const first = value.split(/\n|(?<=[.!?])\s+(?=[A-Z])/)[0].trim();
  return first.length <= max ? first : `${first.slice(0, max).trimEnd()}…`;
};

function currentBudget(planning: PlanningView | null, action: ActionProposalT, assessment: BusinessOutcomeAssessmentT | null): number | null {
  if (assessment?.beforeValue !== null && assessment?.beforeValue !== undefined) return assessment.beforeValue;
  const job = planning?.job;
  const strategyCheck = job?.checks.find((check) => check.strategyKey === job.selectedKey);
  const actionCheck = strategyCheck?.actions.find((check) => check.actionId === action.actionId);
  const current = actionCheck?.current;
  if (current && typeof current === "object" && "dailyBudgetMinor" in current && typeof current.dailyBudgetMinor === "number") return current.dailyBudgetMinor;
  return null;
}

function lifecycle(data: StoryData | null, selected: StrategyT | null, assessment: BusinessOutcomeAssessmentT | null, actionExecution: ActionExecutionT | null) {
  const ai = data?.ai?.state, plan = data?.planning?.plan, review = data?.review;
  if (review?.run?.status === "running") return "Executing";
  if (review?.run?.status === "failed" || actionExecution?.status === "failed") return "Execution failed";
  if (assessment?.status === "completed") return "Measured";
  if (actionExecution?.status === "succeeded") return "Executed";
  if (review?.approval?.decision === "rejected") return "Rejected";
  if (review?.approval?.decision === "changes_requested") return "Changes requested";
  if (review?.approval?.decision === "approved") return "Approved";
  if (plan?.status === "awaiting_approval" || data?.planning?.job?.status === "submitted") return "Awaiting approval";
  if (data?.planning?.job?.status === "failed") return "Planning failed";
  if (selected && !selected.actions.length) return "Advisory only";
  if (data?.planning?.job) return "Planning";
  if (ai?.status === "failed") return "Investigation failed";
  if (ai?.status === "cancelled") return "Cancelled";
  if (data?.ai?.report) return "Diagnosed";
  if (ai) return "Investigating";
  return "Detected";
}

export function InvestigationStory({ bundle, evidenceItems, investigationDetails, evidenceDetails, decisionDetails }: { bundle: Bundle; evidenceItems: EvidenceItem[]; investigationDetails: ReactNode; evidenceDetails: (sources: ExternalSourceT[], report: ReportT | null) => ReactNode; decisionDetails: ReactNode }) {
  const { investigation: investigation, incident, simulationRunId: runId } = bundle;
  const businessId = investigation.businessId;
  const investigationId = investigation.investigationId;
  const [resource, setResource] = useState<{ data: StoryData | null; error: string | null }>({ data: null, error: null });
  const scope = q({ businessId, simulationRunId: runId });
  const load = useCallback(async () => {
    const [ai, planning, approvals, outcomes] = await Promise.allSettled([
      api<InvestigationView>(`/api/investigations/${encodeURIComponent(investigationId)}/ai?${scope}`),
      api<PlanningView>(`/api/investigations/${encodeURIComponent(investigationId)}/planning?${scope}`),
      api<{ plans: ReviewRow[] }>(`/api/approvals?${scope}`),
      api<{ rows: OutcomeRow[] }>(`/api/outcomes?${scope}&investigationId=${encodeURIComponent(investigationId)}`),
    ]);
    const failures = [ai, planning, approvals, outcomes].flatMap((result) => result.status === "rejected" ? [(result.reason as Error).message] : []);
    const planView = planning.status === "fulfilled" ? planning.value : null;
    const plan = planView?.plan;
    const review = approvals.status === "fulfilled" && plan ? approvals.value.plans.find((item) => item.plan.planId === plan.planId && item.plan.planVersion === plan.planVersion) ?? null : null;
    setResource({ data: { ai: ai.status === "fulfilled" ? ai.value : null, planning: planView, review, outcomes: outcomes.status === "fulfilled" ? outcomes.value.rows : [], errors: failures }, error: failures.length === 4 ? failures[0] : null });
  }, [investigationId, scope]);
  useEffect(() => { let active = true; const refresh = () => { if (active) void load(); }; refresh(); const timer = setInterval(refresh, 4000); return () => { active = false; clearInterval(timer); }; }, [load]);

  const data = resource.data;
  const report = data?.ai?.report;
  const job = data?.planning?.job;
  const strategies = job?.output?.strategies ?? [];
  const selected = strategies.find((strategy) => strategy.key === job?.selectedKey) ?? null;
  const recommended = strategies.find((strategy) => strategy.key === job?.output?.recommendedKey) ?? null;
  const featured = selected ?? recommended;
  const plan = data?.planning?.plan ?? null;
  const action = plan?.actions[0] ?? null;
  const exactOutcome = action ? data?.outcomes.find((row) => row.plan.planId === plan?.planId && row.plan.planVersion === plan?.planVersion && row.action.actionId === action.actionId) ?? null : null;
  const assessment = exactOutcome?.latest ?? null;
  const actionExecution = action ? data?.review?.executions.find((entry) => entry.actionId === action.actionId) ?? exactOutcome?.execution ?? null : null;
  const allMeasured = plan?.actions.every((item) => data?.outcomes.some((row) => row.plan.planId === plan.planId && row.plan.planVersion === plan.planVersion && row.action.actionId === item.actionId && row.latest?.status === "completed"));
  const stage = lifecycle(data, selected, allMeasured ? assessment : null, actionExecution);
  const evidenceIds = [...new Set([...(action?.evidenceIds ?? []), ...(featured?.evidenceIds ?? []), ...(report?.handoff.evidenceIds ?? [])])];
  const linkedEvidence = evidenceIds.map((id) => evidenceItems.find((item) => item.evidence.evidenceId === id)).filter((item): item is EvidenceItem => Boolean(item));
  const approval = data?.review?.approval;
  const updatedAt = [investigation.updatedAt, job?.updatedAt, approval?.reviewedAt, actionExecution?.finishedAt, assessment?.updatedAt].filter((value): value is string => Boolean(value)).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const impacted = [...new Set([...bundle.affected.channels, ...bundle.affected.campaigns, ...bundle.affected.products, ...(report?.handoff.affectedEntities ?? [])])];
  const impactedCampaigns = impacted.filter((id) => id.startsWith("cmp_"));
  const impactedChannels = impacted.filter((id) => !id.startsWith("cmp_"));
  const affectedLabel = impactedCampaigns.length ? `${impactedCampaigns.length} campaign${impactedCampaigns.length === 1 ? "" : "s"}${impactedChannels.length ? ` · ${impactedChannels.slice(0, 2).map(label).join(" / ")}` : ""}` : impacted.length ? impacted.slice(0, 3).map(label).join(" · ") : "Scope under review";
  const severity = incident?.severity.level ?? (["critical", "high", "medium", "low"] as const).find((level) => bundle.anomalies.some((item) => item.severity === level)) ?? null;
  const area = incident?.primaryTheme ? label(incident.primaryTheme) : report?.diagnosis.primaryCause.startsWith("ad_") ? "Paid advertising" : report?.diagnosis.primaryCause.includes("checkout") || report?.diagnosis.primaryCause.includes("discount") ? "Checkout" : "Business operations";
  const mainFinding = report?.diagnosis.summary || incident?.summary || bundle.findings[0]?.label || "Diagnosis pending. Open Signal to start the investigation.";
  const uncertainty = report?.handoff.uncertainty[0] || report?.executiveBrief.certainty || "The current observations do not establish a cause.";
  const approvalUrl = `/dashboard/approvals?run=${encodeURIComponent(runId)}`;
  const outcomeUrl = `/dashboard/outcomes?run=${encodeURIComponent(runId)}`;
  const sources = scopedExternalSources(data?.ai?.sources ?? [], { businessId, simulationRunId: runId, investigationId });
  const ranked = [...bundle.anomalies].sort((a, b) => ["critical", "high", "medium", "low"].indexOf(a.severity) - ["critical", "high", "medium", "low"].indexOf(b.severity) || Math.abs(b.changePercent) - Math.abs(a.changePercent));
  const signalAnomalies = ranked.filter((item, index) => ranked.findIndex((other) => other.metric === item.metric) === index).slice(0, 3);
  const metricName = (metric: string) => ({ ctr: "Click-through rate", cac_minor: "Cost per acquisition", ad_spend_minor: "Ad spend", conversion_rate: "Conversion rate", late_delivery_rate: "Late deliveries" }[metric] || label(metric));
  const formatMetric = (metric: string, value: number) => metric.endsWith("_minor") ? money(value) : ["ctr", "conversion_rate", "late_delivery_rate"].includes(metric) ? percentage(value) : value.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  const signalBlocks: CanvasBlock[] = signalAnomalies.map((item) => ({ icon: item.changePercent > 0 ? <TrendingUp size={18} aria-hidden="true" /> : <TrendingDown size={18} aria-hidden="true" />, title: metricName(item.metric), value: `${item.changePercent > 0 ? "+" : ""}${item.changePercent.toFixed(1)}%`, detail: `vs baseline · ${Math.round((Date.parse(item.currentWindow.endAt) - Date.parse(item.currentWindow.startAt)) / 3600000)}h window` }));
  const primaryEvidence = linkedEvidence[0] ?? evidenceItems[0];
  const evidenceCard = primaryEvidence ? internalCardView(primaryEvidence) : null;
  const targetComparison = action?.actionType === "ads.set_daily_budget" ? evidenceCard?.campaigns.find((item) => item.campaignId === action.params.campaignId) : null;
  const measurement = primaryEvidence?.evidence.measurements.find((item) => item.baseline !== undefined && item.baseline >= 0 && item.value >= 0);
  const preview = targetComparison?.baselineCtr != null && targetComparison.ctr != null
    ? <ComparisonPreview label="Target campaign CTR" before={targetComparison.baselineCtr} after={targetComparison.ctr} format={percentage} />
    : measurement?.baseline !== undefined ? <ComparisonPreview label={label(measurement.metric)} before={measurement.baseline} after={measurement.value} format={(value) => measurement.unit.startsWith("GBP minor") ? money(value) : measurement.unit === "ratio" ? percentage(value) : value.toLocaleString("en-GB", { maximumFractionDigits: 2 })} /> : null;
  const verified = evidenceItems.filter((item) => item.verification?.passed).length;
  const advisory = Boolean(featured && (data?.planning?.advisoryOnly || !featured.actions.length));
  const decisionBlocks: CanvasBlock[] = plan ? plan.actions.map((item) => {
    const row = data?.outcomes.find((entry) => entry.plan.planId === plan.planId && entry.plan.planVersion === plan.planVersion && entry.action.actionId === item.actionId);
    const current = currentBudget(data?.planning ?? null, item, row?.latest ?? null);
    const execution = data?.review?.executions.find((entry) => entry.actionId === item.actionId) ?? row?.execution;
    const campaignName = item.actionType === "ads.set_daily_budget" ? evidenceItems.flatMap((entry) => entry.campaignMetadata ?? []).find((entry) => entry.campaignId === item.params.campaignId)?.name : null;
    return { title: item.actionType === "ads.set_daily_budget" ? current === null || current === item.params.newDailyBudgetMinor ? "Set budget" : current > item.params.newDailyBudgetMinor ? "Reduce budget" : "Increase budget" : item.actionType === "customer.send_delay_notice" ? "Send delay notice" : item.actionType === "storefront.publish_banner" ? "Publish banner" : item.title,
      value: item.actionType === "ads.set_daily_budget" ? `${current === null ? "—" : money(current)} → ${money(row?.latest?.afterValue ?? item.params.newDailyBudgetMinor)}/day` : item.actionType === "customer.send_delay_notice" ? `${item.params.orderIds.length} recipients` : undefined,
      detail: campaignName || item.title, status: execution?.status === "succeeded" ? "Executed" : approval?.decision === "approved" ? "Approved" : "Approval required" };
  }) : [{ title: advisory ? "Advisory only" : featured ? "Select a strategy" : job?.status === "failed" ? "Planning failed" : job ? "Planning in progress" : "Plan pending", value: advisory ? "No executable action" : undefined, detail: featured ? short(featured.title, 85) : data?.planning?.eligible ? "Generate a plan from the verified diagnosis" : "Complete the investigation first", status: featured ? "Saved strategy" : undefined }];
  const outcomeTitle = assessment?.status === "pending_measurement" ? "Pending measurement" : assessment?.status === "completed" ? assessment.successCriteriaMet === false ? "Criteria not met" : assessment.businessEffect === "improved" ? "Improvement observed" : "No observed improvement" : assessment?.status === "insufficient_data" ? "Insufficient evidence" : assessment?.status === "failed" ? "Verification failed" : assessment ? label(assessment.status) : advisory ? "Advisory only" : actionExecution?.status === "succeeded" ? "Not measured" : "Execution pending";
  const outcomeDetail = assessment?.after?.complete && assessment.before?.complete ? `CTR ${assessment.before.metrics.ctr === null ? "—" : percentage(assessment.before.metrics.ctr)} → ${assessment.after.metrics.ctr === null ? "—" : percentage(assessment.after.metrics.ctr)}` : assessment?.after ? `${assessment.after.coveredMinutes / 60}/${assessment.after.requiredMinutes / 60} hours observed` : !plan && featured ? "No business action to measure" : "Awaiting a verified action and follow-up window";
  const panels = {
    signal: <><section className="canvas-detail-intro"><span>Detected context</span><h3>{investigation.title}</h3><p>{short(mainFinding, 180)}</p><dl><dt>Affected</dt><dd>{affectedLabel}</dd><dt>Window</dt><dd>{bundle.timeWindows.incident.startAt ? virtualDate(bundle.timeWindows.incident.startAt) : "Unavailable"} → {bundle.timeWindows.incident.endAt ? virtualDate(bundle.timeWindows.incident.endAt) : "Ongoing"}</dd></dl></section><section className="canvas-detail-section"><h3>Detected signals</h3><div className="scroll-x"><table data-testid="related-anomalies"><thead><tr><th>Metric</th><th>Actual</th><th>Baseline</th><th>Change</th><th>Severity</th></tr></thead><tbody>{bundle.anomalies.map((item) => <tr key={item.anomalyId}><td>{metricName(item.metric)}</td><td>{formatMetric(item.metric, item.actualValue)}</td><td>{formatMetric(item.metric, item.baselineValue)}</td><td>{item.changePercent.toFixed(1)}%</td><td>{item.severity}</td></tr>)}</tbody></table></div></section>{investigationDetails}</>,
    evidence: evidenceDetails(sources, report ?? null),
    decision: <><section className="canvas-detail-intro"><span>Assessment</span><h3>{report ? label(report.diagnosis.primaryCause) : "Diagnosis pending"}</h3><p>{short(mainFinding, 180)}</p><div className="canvas-detail-caution"><strong>Uncertainty</strong><p>{short(uncertainty, 140)}</p></div>{report?.insufficientEvidence ? <p className="small">Evidence gap: {short(report.insufficientEvidence.reason, 140)}</p> : null}</section>{decisionDetails}</>,
    outcome: <><section className="canvas-detail-intro"><span>Outcome</span><h3>{outcomeTitle}</h3><p>{short(assessment?.summary || "Results use the approved action and follow-up business records.", 160)}</p><div className="canvas-detail-links"><Link href={approvalUrl}>Approvals ↗</Link><Link href={outcomeUrl}>All outcomes ↗</Link></div></section>{data?.outcomes.filter((row) => !plan || row.plan.planId === plan.planId && row.plan.planVersion === plan.planVersion).map((row) => <AssessmentDetail key={row.execution.executionId} row={row} assessment={row.latest} runId={runId} onFeedbackSaved={load} compact />)}{!data?.outcomes.length ? <div className="canvas-detail-section"><p>No executed action has an outcome receipt yet.</p>{data?.review?.executions.map((entry) => <p key={entry.executionId}>{label(entry.status)} · {entry.error?.message || entry.result?.verification || "Awaiting completion"}</p>)}</div> : null}</>,
  };
  return <InvestigationCanvas recordId={investigationId} title={investigation.title} summary={short(mainFinding, 190)} business="Nike — Unaffiliated Simulation" run={runId} area={area} severity={severity ? `${label(severity)} ${incident ? "severity" : "signal"}` : null} lifecycle={stage} loading={!data}
    error={data?.errors.length ? `Some live status is unavailable: ${data.errors.join(" · ")}` : resource.error}
    blocks={{ signal: signalBlocks.length ? signalBlocks : [{ title: report ? "Saved finding" : "Investigation pending", detail: short(report?.handoff.supportedFindings[0] || mainFinding, 100) }],
      evidence: [{ title: evidenceItems.length ? `${verified} verified records` : "Evidence pending", detail: primaryEvidence ? primaryEvidence.evidence.category === "advertising" ? "Campaign comparison" : primaryEvidence.evidence.title : "Collect and inspect source records", preview }], decision: decisionBlocks,
      outcome: [{ title: outcomeTitle, detail: outcomeDetail, status: assessment?.status === "completed" ? `${(assessment.after?.requiredMinutes ?? 0) / 60}h comparison` : undefined }] }} panels={panels}
    footer={<><strong>{approval ? label(approval.decision) : "Human review"}</strong><span>{actionExecution?.status === "succeeded" ? "Action executed" : "No completed execution"}</span><span>Updated {virtualDate(updatedAt)}</span></>} />;
}
