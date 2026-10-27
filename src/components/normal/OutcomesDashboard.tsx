"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActionProposalT } from "@normal/contracts";
import type { BusinessOutcomeAssessmentT } from "@/outcomes/schema";
import { api, q } from "./api";
import type { OutcomeDetailRow } from "./Outcomes";
import { useRun } from "./run-context";

type Row = OutcomeDetailRow;
type Assessment = BusinessOutcomeAssessmentT;
type Observation = NonNullable<Assessment["before"]>;
type Sample = Observation["series"][number];
type Metric = "spendMinor" | "ctr" | "roas" | "attributedOrders" | "impressions";
type OutcomeResponse = { businessId: string; simulationRunId: string; rows: Row[] };

const METRICS: Array<{ key: Metric; label: string; windowLabel: string }> = [
  { key: "spendMinor", label: "Spend", windowLabel: "Spend per observed hour" },
  { key: "ctr", label: "CTR", windowLabel: "CTR per observed hour" },
  { key: "roas", label: "ROAS", windowLabel: "ROAS per observed hour" },
  { key: "attributedOrders", label: "Attributed orders", windowLabel: "Orders per observed hour" },
  { key: "impressions", label: "Impressions", windowLabel: "Impressions per observed hour" },
];
const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const integer = new Intl.NumberFormat("en-GB");
const dateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });

function money(minor: number | null | undefined) {
  return minor == null ? "—" : gbp.format(minor / 100);
}
function metricText(metric: Metric, value: number | null | undefined) {
  if (value == null) return "—";
  if (metric === "spendMinor") return money(value);
  if (metric === "ctr") return (value * 100).toFixed(2) + "%";
  if (metric === "roas") return value.toFixed(2) + "×";
  return integer.format(value);
}
function observationValue(observation: Observation | null, metric: Metric) {
  return !observation || observation.coveredMinutes === 0 ? null : observation.metrics[metric];
}
function sampleValue(sample: Sample, metric: Metric): number | null {
  if (metric === "ctr") return sample.impressions ? sample.clicks / sample.impressions : null;
  if (metric === "roas") return sample.spendMinor ? sample.attributedRevenueMinor / sample.spendMinor : null;
  return sample[metric];
}
function hours(minutes: number) {
  return integer.format(minutes / 60) + " h";
}
function coverage(observation: Observation | null) {
  return observation ? hours(observation.coveredMinutes) + " / " + hours(observation.requiredMinutes) : "No window";
}
function formattedDate(value: string | null | undefined) {
  return value ? dateTime.format(new Date(value)) + " UTC" : "—";
}
function plain(value: string) {
  return value.replaceAll("_", " ");
}
function criterionName(metric: string) {
  const labels: Record<string, string> = { ad_spend_minor: "Spend", ctr: "CTR", orders: "Attributed orders", revenue_minor: "Attributed revenue", cac_minor: "Cost per acquisition" };
  return labels[metric] ?? plain(metric);
}
function criterionText(metric: string, value: number | null) {
  if (value == null) return "—";
  if (["ad_spend_minor", "revenue_minor", "cac_minor"].includes(metric)) return money(value);
  if (["ctr", "conversion_rate", "late_delivery_rate"].includes(metric)) return (value * 100).toFixed(2) + "%";
  return integer.format(value);
}
function actionTarget(action: ActionProposalT) {
  if (action.actionType === "ads.set_daily_budget") return "Campaign " + action.params.campaignId;
  if (action.actionType === "customer.send_delay_notice") return integer.format(action.params.orderIds.length) + " intended recipients";
  if (action.actionType === "storefront.publish_banner") return "Banner " + action.params.bannerId;
  return action.title;
}
function resultTitle(assessment: Assessment | null) {
  if (!assessment) return "Business effect not assessed";
  if (assessment.status === "pending_measurement" || assessment.status === "ready_to_evaluate" || assessment.status === "evaluating") return "Business measurement pending";
  if (assessment.status === "failed") return "Assessment failed";
  if (assessment.status === "insufficient_data") return "Insufficient evidence";
  if (assessment.businessEffect === "improved") return "Improvement observed";
  if (assessment.businessEffect === "deteriorated") return "Performance deteriorated";
  if (assessment.businessEffect === "unchanged") return "No observed return improvement";
  return "Result inconclusive";
}
function runHref(path: string, runId: string) {
  return path + (path.includes("?") ? "&" : "?") + "run=" + encodeURIComponent(runId);
}

function trendSegments(series: Sample[], metric: Metric, cadence: number) {
  const segments: Array<Array<{ time: number; value: number; at: string }>> = [];
  let current: Array<{ time: number; value: number; at: string }> = [];
  for (const sample of series) {
    const value = sampleValue(sample, metric);
    const time = Date.parse(sample.startAt);
    if (value == null || !Number.isFinite(time)) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    if (current.length && time - current[current.length - 1].time > cadence * 1.5) {
      segments.push(current);
      current = [];
    }
    current.push({ time, value, at: sample.startAt });
  }
  if (current.length) segments.push(current);
  return segments;
}

function PerformanceChart({ assessment, metric }: { assessment: Assessment; metric: Metric }) {
  const before = assessment.before;
  const after = assessment.after;
  const baseline = before?.series ?? [];
  const following = after?.series ?? [];
  const values = [...baseline, ...following].map((sample) => sampleValue(sample, metric)).filter((value): value is number => value != null);
  const trend = baseline.length > 1 || following.length > 1;

  if (trend && values.length) {
    const start = Date.parse(assessment.beforeWindow.startAt);
    const end = Date.parse(assessment.window.endAt);
    const actionTime = Date.parse(assessment.anchorAt);
    const span = Math.max(1, end - start);
    const x = (time: number) => 54 + (time - start) / span * 650;
    const observedMax = Math.max(...values);
    const maximum = observedMax > 0 ? observedMax * 1.15 : metric === "ctr" ? 0.01 : 1;
    const y = (value: number) => 182 - value / maximum * 140;
    const intervals = [baseline, following].flatMap((series) => series.slice(1).map((sample, index) => Date.parse(sample.startAt) - Date.parse(series[index].startAt))).filter((interval) => interval > 0);
    const cadence = intervals.length ? Math.min(...intervals) : 3_600_000;
    const drawSeries = (series: Sample[], color: string, label: string) =>
      trendSegments(series, metric, cadence).map((segment, index) => (
        <g key={label + index}>
          {segment.length > 1 ? <polyline fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={segment.map((point) => x(point.time) + "," + y(point.value)).join(" ")} /> : null}
          {segment.map((point) => <circle key={point.at} cx={x(point.time)} cy={y(point.value)} r="2.8" fill={color}><title>{label + " · " + formattedDate(point.at) + " · " + metricText(metric, point.value)}</title></circle>)}
        </g>
      ));
    const beforeHours = Math.round((actionTime - start) / 3_600_000);
    const afterHours = Math.round((end - actionTime) / 3_600_000);
    return <figure className="outcome-viz" aria-label={METRICS.find((entry) => entry.key === metric)?.windowLabel}>
      <svg viewBox="0 0 760 230" role="img" aria-label={"Recorded " + (METRICS.find((entry) => entry.key === metric)?.label ?? metric) + " before and after execution"}>
        {[0, 0.5, 1].map((fraction) => <g key={fraction}>
          <line x1="54" x2="704" y1={y(maximum * fraction)} y2={y(maximum * fraction)} stroke="#e7e9e5" strokeWidth="1" />
          <text x="47" y={y(maximum * fraction) + 4} textAnchor="end" className="outcome-viz-axis">{metricText(metric, maximum * fraction)}</text>
        </g>)}
        <line x1={x(actionTime)} x2={x(actionTime)} y1="22" y2="182" stroke="#333b34" strokeWidth="1.5" strokeDasharray="4 4" />
        <text x={x(actionTime)} y="16" textAnchor="middle" className="outcome-viz-marker">Executed</text>
        {drawSeries(baseline, "#8e9990", "Before")}
        {drawSeries(following, "#497b50", "After")}
        <text x="54" y="210" textAnchor="start" className="outcome-viz-axis">−{beforeHours} h</text>
        <text x={x(actionTime)} y="210" textAnchor="middle" className="outcome-viz-axis">0 h</text>
        <text x="704" y="210" textAnchor="end" className="outcome-viz-axis">+{afterHours} h</text>
      </svg>
      <figcaption><span><i className="outcome-viz-key before" /> Before</span><span><i className="outcome-viz-key after" /> After</span><small>Recorded campaign windows · simulated hours from execution. Blank periods have no observations.</small></figcaption>
    </figure>;
  }

  const pairs = [
    { label: "Before", value: observationValue(before, metric) },
    { label: "After", value: observationValue(after, metric) },
  ];
  if (pairs.every((pair) => pair.value == null)) return <div className="outcome-no-chart">No comparable campaign observations are saved for this metric.</div>;
  const maximum = Math.max(0, ...pairs.map((pair) => pair.value ?? 0));
  return <figure className="outcome-aggregate" aria-label={"Recorded before and after " + metric}>
    {pairs.map((pair) => <div className="outcome-aggregate-row" key={pair.label}>
      <strong>{pair.label}</strong>
      <div className="outcome-aggregate-track">{pair.value == null ? <span className="outcome-aggregate-missing">No observation</span> : <span className={pair.label === "After" ? "after" : "before"} style={{ width: (maximum ? pair.value / maximum * 100 : 0) + "%" }} />}</div>
      <b>{metricText(metric, pair.value)}</b>
    </div>)}
    <figcaption>Aggregate values from saved campaign observations. No individual time points were supplied.</figcaption>
  </figure>;
}

function PerformancePanel({ assessment }: { assessment: Assessment | null }) {
  const [metric, setMetric] = useState<Metric>("spendMinor");
  return <section className="outcome-performance">
    <div className="outcome-panel-heading"><div><span className="outcome-kicker">Performance</span><h3>Before and after</h3></div>{assessment?.before ? <small>Same campaign · equal planned windows</small> : null}</div>
    {assessment?.actionType === "ads.set_daily_budget" ? <>
      <div className="outcome-metric-explorer" aria-label="Select performance metric">
        {METRICS.map((item) => <button type="button" key={item.key} className={metric === item.key ? "active" : ""} aria-pressed={metric === item.key} aria-label={"Show " + item.label + " chart. Before " + metricText(item.key, observationValue(assessment.before, item.key)) + ", after " + metricText(item.key, observationValue(assessment.after, item.key))} onClick={() => setMetric(item.key)}>
          <span>{item.label}</span><strong>{metricText(item.key, observationValue(assessment.before, item.key))} <em>→</em> {metricText(item.key, observationValue(assessment.after, item.key))}</strong>
        </button>)}
      </div>
      <div className="outcome-chart-heading"><strong>{METRICS.find((item) => item.key === metric)?.windowLabel}</strong><span>Before {coverage(assessment.before)} · After {coverage(assessment.after)}</span></div>
      <PerformanceChart assessment={assessment} metric={metric} />
    </> : <div className="outcome-no-chart">{assessment ? "No comparable action-linked business cohort is recorded. The verified operational result appears above." : "Evaluate this action to inspect its saved business observations."}</div>}
  </section>;
}

function CriteriaPanel({ assessment }: { assessment: Assessment | null }) {
  const criteria = assessment?.successCriteria ?? [];
  return <aside className="outcome-verdict">
    <div className="outcome-panel-heading"><div><span className="outcome-kicker">Outcome</span><h3>{resultTitle(assessment)}</h3></div><span className={"outcome-status " + (assessment?.status ?? "unassessed")}>{assessment ? plain(assessment.status) : "Not assessed"}</span></div>
    <div className="outcome-effect"><span>Business effect</span><strong>{assessment?.status === "completed" ? plain(assessment.businessEffect) : "Unmeasured"}</strong><small>{assessment?.targetStateAchieved === true ? "Applied action verified" : assessment?.targetStateAchieved === false ? "Target state not verified" : "Execution record available"}</small></div>
    <div className="outcome-criteria-heading"><h4>Plan criteria</h4><span>{assessment?.successCriteriaMet === true ? "All met" : assessment?.successCriteriaMet === false ? "Not all met" : "Pending"}</span></div>
    {criteria.length ? <div className="outcome-criteria-list">{criteria.map((criterion, index) => {
      const result = assessment?.criterionResults[index];
      const state = result?.met == null ? "Unmeasurable" : result.met ? "Met" : "Not met";
      return <div className="outcome-criteria-item" key={criterion.metric + index}>
        <div><strong>{criterionName(criterion.metric)} · {criterion.direction}</strong><small>{result?.before != null || result?.after != null ? criterionText(criterion.metric, result?.before ?? null) + " → " + criterionText(criterion.metric, result?.after ?? null) : "Comparable result pending"}{criterion.target != null ? " · target " + criterionText(criterion.metric, criterion.target) : ""}</small></div>
        <span className={"outcome-criterion-state " + state.toLowerCase().replaceAll(" ", "-")}>{state}</span>
      </div>;
    })}</div> : <p className="outcome-verdict-empty">Evaluate the action to compare it with the original plan criteria.</p>}
  </aside>;
}

function assessmentCopy(assessment: Assessment | null) {
  if (!assessment) return "Execution succeeded. Evaluate the outcome to inspect saved business observations and the plan criteria.";
  if (assessment.actionType !== "ads.set_daily_budget" || !assessment.before?.complete || !assessment.after?.complete) {
    if (assessment.actionType === "ads.set_daily_budget" && assessment.status === "pending_measurement")
      return "The budget change is verified. Baseline coverage is " + coverage(assessment.before) + "; post-action coverage is " + coverage(assessment.after) + ". A full post-action window is needed before business impact can be assessed.";
    return assessment.summary;
  }
  const before = assessment.before.metrics;
  const after = assessment.after.metrics;
  const spend = after.spendMinor === before.spendMinor ? "stayed at " + money(after.spendMinor) : after.spendMinor < before.spendMinor ? "fell from " + money(before.spendMinor) + " to " + money(after.spendMinor) : "rose from " + money(before.spendMinor) + " to " + money(after.spendMinor);
  const ctr = before.ctr == null || after.ctr == null ? "could not be compared" : after.ctr === before.ctr ? "stayed at " + metricText("ctr", after.ctr) : after.ctr < before.ctr ? "fell from " + metricText("ctr", before.ctr) + " to " + metricText("ctr", after.ctr) : "rose from " + metricText("ctr", before.ctr) + " to " + metricText("ctr", after.ctr);
  const orders = before.attributedOrders === after.attributedOrders ? "stayed at " + integer.format(after.attributedOrders) : "changed from " + integer.format(before.attributedOrders) + " to " + integer.format(after.attributedOrders);
  const roas = before.roas == null || after.roas == null ? "is unavailable" : before.roas === after.roas ? "stayed at " + metricText("roas", after.roas) : "changed from " + metricText("roas", before.roas) + " to " + metricText("roas", after.roas);
  const unmet = assessment.criterionResults.filter((result) => result.met === false).map((result) => criterionName(result.metric));
  const criteria = unmet.length ? " The " + unmet.join(" and ") + " criterion" + (unmet.length === 1 ? " was" : " were") + " not met." : "";
  return "Spend " + spend + "; CTR " + ctr + ". Attributed orders " + orders + "; ROAS " + roas + "." + criteria + " Observed changes do not establish causation.";
}

function Feedback({ assessment, feedback, onSaved }: { assessment: Assessment; feedback: { note: string; rating: string; recordedAt: string } | null; onSaved: () => void }) {
  const [note, setNote] = useState("");
  const [rating, setRating] = useState<"uncertain" | "helpful" | "concern">("uncertain");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try {
      await api("/api/outcomes/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: assessment.businessId, simulationRunId: assessment.simulationRunId, assessmentId: assessment.assessmentId, rating, note }) });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Feedback could not be saved."); }
    finally { setBusy(false); }
  };
  return feedback ? <p className="outcome-detail-copy"><strong>{plain(feedback.rating)}</strong> · {feedback.note} · {formattedDate(feedback.recordedAt)}</p> :
    <div className="outcome-feedback"><select aria-label="Feedback rating" value={rating} onChange={(event) => setRating(event.target.value as typeof rating)}><option value="uncertain">Uncertain</option><option value="helpful">Helpful</option><option value="concern">Concern</option></select><textarea aria-label="Operator note" placeholder="What did you observe?" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /><button className="btn sm" type="button" disabled={busy || !note.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save feedback"}</button>{error ? <p role="alert">{error}</p> : null}</div>;
}

function ActionDetail({ row, runId, onFeedbackSaved }: { row: Row; runId: string; onFeedbackSaved: () => void }) {
  const assessment = row.latest;
  const action = row.action;
  const isBudget = action.actionType === "ads.set_daily_budget";
  const intended = action.actionType === "customer.send_delay_notice" ? action.params.orderIds.length : null;
  const reached = typeof assessment?.operational.reachedRecipients === "number" ? assessment.operational.reachedRecipients : null;
  const investigationHref = runHref("/dashboard/investigations/" + encodeURIComponent(row.plan.investigationId), runId);
  const planHref = runHref("/dashboard/approvals", runId);
  return <div className="outcome-action-dashboard" data-testid="outcome-detail">
    <section className="outcome-action-summary">
      <div className="outcome-action-title"><span className="outcome-kicker">Executed action</span><h2>{action.title}</h2><p>{actionTarget(action)}</p></div>
      <div className="outcome-action-facts">
        <div><small>Execution</small><strong>{assessment?.targetStateAchieved === true ? "Verified" : plain(row.execution.status)}</strong></div>
        {isBudget ? <div className="outcome-applied-change"><small>{assessment?.targetStateAchieved === true ? "Daily budget applied" : "Daily budget recorded"}</small><strong>{money(assessment?.beforeValue)} <em>→</em> {money(assessment?.afterValue)} <span>/ day</span></strong>{!assessment ? <span>Planned target {money(action.params.newDailyBudgetMinor)} / day</span> : null}</div> : null}
        {intended != null ? <div className="outcome-applied-change"><small>Notice delivery</small><strong>{integer.format(intended)} intended <em>→</em> {reached == null ? "—" : integer.format(reached)} reached</strong></div> : null}
        {action.actionType === "storefront.publish_banner" ? <div className="outcome-applied-change"><small>Publication window</small><strong>{formattedDate(action.params.startsAt)} <em>→</em> {formattedDate(action.params.expiresAt)}</strong></div> : null}
      </div>
      <div className="outcome-action-links"><Link href={investigationHref}>Investigation ↗</Link><Link href={planHref}>Reviewed plan v{row.plan.planVersion} ↗</Link><span>Recorded {formattedDate(row.execution.finishedAt)}</span></div>
    </section>
    <div className="outcome-analysis-grid"><PerformancePanel assessment={assessment} /><CriteriaPanel assessment={assessment} /></div>
    <section className="outcome-explanation"><span className="outcome-kicker">Normal’s assessment</span><p>{assessmentCopy(assessment)}</p></section>
    <div className="outcome-disclosures" aria-label="Outcome details">
      <details><summary>Original plan</summary><div className="outcome-disclosure-body"><p><strong>Objective</strong> {row.plan.objective}</p>{row.plan.summary ? <p><strong>Plan summary</strong> {row.plan.summary}</p> : null}<p><strong>Action rationale</strong> {action.rationale}</p><p><strong>Plan ID</strong> <code>{row.plan.planId}</code> · version {row.plan.planVersion}</p>{(row.plan.successCriteria ?? assessment?.successCriteria ?? []).map((criterion, index) => <p key={criterion.metric + index}>{criterionName(criterion.metric)} · {criterion.direction}{criterion.target != null ? " · target " + criterionText(criterion.metric, criterion.target) : ""} · {hours(criterion.measurementWindowMinutes)} window</p>)}</div></details>
      <details><summary>Execution receipt</summary><div className="outcome-disclosure-body">{row.receipt ? <pre>{JSON.stringify(row.receipt, null, 2)}</pre> : <p>Receipt unavailable in this scope.</p>}<p>{row.execution.result?.verification ?? "No verification note recorded."}</p></div></details>
      <details><summary>Source records</summary><div className="outcome-disclosure-body outcome-reference-list">{assessment?.sourceReferences.length ? assessment.sourceReferences.map((reference) => <code key={reference.collection + reference.recordId}>{reference.collection} / {reference.recordId}</code>) : <p>No assessment source references saved yet.</p>}</div></details>
      <details><summary>Assessment history</summary><div className="outcome-disclosure-body">{row.history.length ? row.history.map((entry) => <p key={entry.assessmentId}><strong>{formattedDate(entry.createdAt)}</strong> · {plain(entry.status)} · {plain(entry.businessEffect)} · <code>{entry.assessmentId}</code></p>) : <p>No assessment has been saved for this action.</p>}</div></details>
      <details><summary>Limitations</summary><div className="outcome-disclosure-body">{assessment?.limitations.length ? assessment.limitations.map((limit, index) => <p key={index}>{limit}</p>) : <p>No limitations recorded yet.</p>}{assessment ? <p><strong>Diagnosis context</strong> {assessment.diagnosis}</p> : null}{assessment?.criterionResults.map((result, index) => <p key={result.metric + index}><strong>{criterionName(result.metric)}</strong> {result.reason}</p>)}</div></details>
      {assessment ? <details><summary>Operator feedback</summary><div className="outcome-disclosure-body"><Feedback assessment={assessment} feedback={row.latest?.feedback ?? null} onSaved={onFeedbackSaved} /></div></details> : null}
    </div>
  </div>;
}

export function OutcomesPage() {
  const { businessId, runId, runs, setRun, loaded } = useRun();
  const params = useSearchParams();
  const router = useRouter();
  const requestedAction = params.get("action");
  const [resource, setResource] = useState<{ runId: string; data: OutcomeResponse | null; error: string | null } | null>(null);
  const [selected, setSelected] = useState<{ runId: string; actionId: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<{ runId: string; message: string } | null>(null);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!loaded || !runId) return;
    let active = true;
    void api<OutcomeResponse>("/api/outcomes?" + q({ businessId, simulationRunId: runId }))
      .then((data) => { if (active) setResource({ runId, data, error: null }); })
      .catch((cause) => { if (active) setResource({ runId, data: null, error: cause instanceof Error ? cause.message : "Outcomes could not be loaded." }); });
    return () => { active = false; };
  }, [businessId, runId, loaded, revision]);

  const data = resource?.runId === runId ? resource.data : null;
  const error = resource?.runId === runId ? resource.error : null;
  const chosenId = selected?.runId === runId ? selected.actionId : requestedAction;
  const row = useMemo(() => data?.rows.find((item) => item.action.actionId === chosenId) ?? data?.rows[0] ?? null, [data, chosenId]);
  const selectAction = (actionId: string) => {
    if (!runId) return;
    setSelected({ runId, actionId });
    const next = new URLSearchParams(params.toString());
    next.set("run", runId);
    next.set("action", actionId);
    router.replace("/dashboard/outcomes?" + next.toString(), { scroll: false });
  };
  const evaluate = async () => {
    if (!runId || !row) return;
    setBusy(true); setActionError(null);
    try {
      await api("/api/outcomes/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId, simulationRunId: runId, planId: row.plan.planId, planVersion: row.plan.planVersion, actionId: row.action.actionId }) });
      refresh();
    } catch (cause) { setActionError({ runId, message: cause instanceof Error ? cause.message : "Assessment could not be retrieved." }); }
    finally { setBusy(false); }
  };
  const runPicker = <label className="outcome-run-picker">Simulation run
    <select aria-label="Outcome simulation run" value={runId ?? ""} onChange={(event) => setRun(event.target.value)} disabled={!runs.length}>
      {!runId ? <option value="">Select a run</option> : null}
      {runId && !runs.some((run) => run.simulationRunId === runId) ? <option value={runId}>{runId}</option> : null}
      {runs.map((run) => <option value={run.simulationRunId} key={run.simulationRunId}>{run.simulationRunId}</option>)}
    </select>
  </label>;

  return <div className="outcomes-dashboard" data-testid="outcomes-page">
    <header className="outcomes-dashboard-header"><div><span className="outcome-kicker">Action outcomes</span><h1>Outcomes</h1><p>Verified changes and subsequent business observations for one run at a time.</p></div>{runPicker}</header>
    {!loaded || runId && !data && !error ? <div className="outcome-loading">Loading saved outcomes…</div> : null}
    {error ? <div className="outcome-load-error" role="alert"><p>{error}</p><button className="btn sm" type="button" onClick={refresh}>Retry</button></div> : null}
    {loaded && !runId ? <div className="outcome-empty-state"><span className="outcome-empty-icon" aria-hidden="true">○</span><h2>Select a simulation run</h2><p>Choose a run above to inspect its executed actions and saved measurements.</p></div> : null}
    {data && data.rows.length === 0 ? <div className="outcome-empty-state"><span className="outcome-empty-icon" aria-hidden="true">○</span><h2>No executed actions in this run</h2><p>{runId === "demo_nike" ? "The storefront demo has no executed actions. " : ""}Choose an execution run from the selector above to view verified changes and performance.</p><Link href={runHref("/dashboard/approvals", runId!)}>View plans in this run ↗</Link></div> : null}
    {data && data.rows.length > 0 && row ? <>
      <div className="outcomes-dashboard-toolbar"><div><strong>{data.rows.length} executed {data.rows.length === 1 ? "action" : "actions"}</strong></div><div className="outcomes-toolbar-actions"><button className="btn sm" type="button" onClick={refresh}>Refresh</button><button className="btn sm primary" type="button" disabled={busy} onClick={() => void evaluate()}>{busy ? "Evaluating…" : row.latest ? "Recheck assessment" : "Evaluate outcome"}</button></div></div>
      {data.rows.length > 1 ? <nav className="outcome-action-switcher" aria-label="Executed actions">{data.rows.map((item) => <button type="button" key={item.execution.executionId} className={item.execution.executionId === row.execution.executionId ? "selected" : ""} aria-current={item.execution.executionId === row.execution.executionId ? "true" : undefined} onClick={() => selectAction(item.action.actionId)} data-testid={"outcome-action-" + item.action.actionId}><strong>{item.action.title}</strong><span>{item.latest ? resultTitle(item.latest) : "Not assessed"}</span></button>)}</nav> : null}
      {actionError?.runId === runId ? <div className="alert error" role="alert">{actionError.message}</div> : null}
      <ActionDetail key={row.execution.executionId} row={row} runId={runId!} onFeedbackSaved={refresh} />
    </> : null}
  </div>;
}
