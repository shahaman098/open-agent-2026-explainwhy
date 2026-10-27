"use client";
import { useCallback, useEffect, useState } from "react";
import { api, q, type EvidenceItem } from "./api";
import { InternalEvidenceCard } from "./EvidenceCards";
import type { PlanningView } from "@/planner/schemas";

const concise = (value: string, max = 190) => {
  const first = value.split("\n")[0];
  return first.length <= max ? first : `${first.slice(0, max).trimEnd()}…`;
};
const pounds = (minor: number) => `£${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function SolutionPlanning({ investigationId, businessId, simulationRunId, evidenceItems }: { investigationId: string; businessId: string; simulationRunId: string; evidenceItems: EvidenceItem[] }) {
  const scope = q({ businessId, simulationRunId });
  const url = `/api/investigations/${encodeURIComponent(investigationId)}/planning?${scope}`;
  const [view, setView] = useState<PlanningView | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const data = await api<PlanningView>(url); setView(data); }, [url]);
  useEffect(() => {
    let active = true;
    const refresh = () => { void api<PlanningView>(url).then((data) => { if (active) setView(data); }).catch((e: Error) => { if (active) setError(e.message); }); };
    refresh(); const timer = setInterval(refresh, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [url]);
  const act = async (input: { action: "generate" | "select" | "submit" | "repair" | "refresh"; strategyKey?: string }) => {
    setBusy(true); setError(null);
    try { await api(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const job = view?.job, output = job?.output, plan = view?.plan;
  const working = job?.status === "queued" || job?.status === "running";
  const selected = output?.strategies.find((strategy) => strategy.key === job?.selectedKey);
  const handoff = plan ? `/api/plans/${encodeURIComponent(plan.planId)}?${scope}&planVersion=${plan.planVersion}` : null;
  const evidenceCards = (ids: string[]) => <div className="investigation-inline-evidence">{[...new Set(ids)].slice(0, 2).map((id) => { const item = evidenceItems.find((item) => item.evidence.evidenceId === id); return item ? <InternalEvidenceCard key={id} item={item} compact /> : <a key={id} className="investigation-citation" href={`#evidence-${encodeURIComponent(id)}`}>Evidence {id.slice(-8)}</a>; })}</div>;
  return <section className="card solution-planning" data-testid="solution-planning">
    <div className="card-head"><div><span className="eyebrow">Plan and review</span><h3>Solution planning</h3></div><span className="pill" data-testid="planning-status">{job?.status.replaceAll("_", " ") || (view?.eligible ? "ready to generate" : "blocked")}</span></div>
    <div className="card-body">
      <p className="small muted">Compare options, choose a validated plan, then submit it for approval. No action runs here.</p>
      {error || job?.error ? <div className="alert error" role="alert">{error || job?.error}</div> : null}
      {view?.blockedReasons.map((reason) => <p key={reason} className="planning-blocked" data-testid="planning-blocked">{reason}</p>)}
      {view?.advisoryOnly ? <div className="alert info">Advice only: no supported action is available for this diagnosis.</div> : null}
      {view?.stale ? <div className="alert info">Evidence changed. Refresh before submitting this plan. <button className="btn sm" disabled={busy || working} data-testid="refresh-planning" onClick={() => void act({ action: "refresh" })}>Refresh plan</button></div> : null}
      {!job ? <button className="btn primary" onClick={() => void act({ action: "generate" })} disabled={!view?.eligible || busy} data-testid="generate-plan">{busy ? "Queuing…" : "Generate solution plan"}</button> : null}
      {job?.status === "awaiting_selection" && !job.repair && job.checks.some((check) => !check.passed) ? <button className="btn" disabled={busy || !view?.eligible} data-testid="repair-strategies" onClick={() => void act({ action: "repair" })}>Fix validation issues</button> : null}
      {working ? <div className="planning-progress" aria-live="polite"><span className="spinner" /><strong>{job.stage.replaceAll("_", " ")}</strong><span>{job.status === "queued" ? "Waiting for the planner." : "Comparing options and checking actions."}</span></div> : null}
      {output ? <>
        <div className="planning-recommendation"><span className="eyebrow">Recommendation</span><h4>{output.strategies.find((strategy) => strategy.key === output.recommendedKey)?.title}</h4><p>{concise(output.recommendation, 170)}</p></div>
        <div className="planning-strategies" data-testid="strategy-comparison">{output.strategies.map((strategy) => {
          const check = job?.checks.find((item) => item.strategyKey === strategy.key);
          return <article className={`planning-strategy${job?.selectedKey === strategy.key ? " selected" : ""}`} key={strategy.key} data-testid="strategy-card" data-strategy-key={strategy.key}>
            <div className="row"><span className={`pill ${strategy.risk === "high" ? "warn" : ""}`}>{strategy.risk} risk</span>{strategy.key === output.recommendedKey ? <span className="pill accent">Recommended</span> : null}<span className="pill">{strategy.actions.length ? `${strategy.actions.length} action${strategy.actions.length === 1 ? "" : "s"}` : "Advice only"}</span></div>
            <h4>{strategy.title}</h4><p>{concise(strategy.explanation)}</p>
            <div className="planning-strategy-essentials"><div><strong>Expected benefit</strong><span>{concise(strategy.benefit, 120)}</span></div><div><strong>Main risk</strong><span>{concise(strategy.downside, 120)}</span></div></div>
            {strategy.advisory.length ? <div className="planning-advisory"><strong>Advisory only</strong><ul>{strategy.advisory.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
            <div className={`small ${check?.passed ? "planning-valid" : "planning-invalid"}`}>{check?.passed ? "Deterministic validation passed" : check?.errors.join(" ") || "Validation pending"}</div>
            <details><summary>Details and evidence</summary><dl><dt>Full explanation</dt><dd>{strategy.explanation}</dd><dt>Expected benefit</dt><dd>{strategy.benefit}</dd><dt>Potential downside</dt><dd>{strategy.downside}</dd><dt>Feasibility</dt><dd>{strategy.feasibility}</dd><dt>Reversibility</dt><dd>{strategy.reversibility}</dd><dt>Uncertainty</dt><dd>{strategy.uncertainty}</dd><dt>Why select or reject</dt><dd>{strategy.comparison}</dd></dl>{evidenceCards(strategy.evidenceIds)}</details>
            <button className={`btn ${job?.selectedKey === strategy.key ? "accent" : ""}`} disabled={busy || !view?.eligible || view.stale || !check?.passed || job?.selectedKey === strategy.key} onClick={() => void act({ action: "select", strategyKey: strategy.key })}> {job?.selectedKey === strategy.key ? "Selected" : "Select strategy"}</button>
          </article>;
        })}</div>
      </> : null}
      {selected ? <div className="planning-selected" data-testid="selected-plan"><div className="row" style={{ justifyContent: "space-between" }}><div><span className="eyebrow">Selected strategy</span><h4>{plan?.objective || selected.title}</h4></div><span className="pill">Version {job?.planVersion} · {plan?.status.replaceAll("_", " ") || "advisory only"}</span></div>
        <p>{concise(plan?.summary || selected.explanation, 180)}</p>
        {!plan ? <p className="alert info" data-testid="advisory-only">No executable proposal. The advice is saved for review; no adapter can repair the diagnosed issue.</p> : plan.actions.map((action) => {
          const check = job?.checks.find((item) => item.strategyKey === selected.key)?.actions[plan.actions.indexOf(action)];
          const current = check?.current && typeof check.current === "object" && "dailyBudgetMinor" in check.current && typeof check.current.dailyBudgetMinor === "number" ? check.current.dailyBudgetMinor : null;
          return <article className="planning-action" key={action.actionId} data-testid="planned-action"><h5>{action.title}</h5><p>{concise(selected.actions[plan.actions.indexOf(action)]?.rationale || action.rationale)}</p><div className="row"><span className="pill">Approval required</span><span className="pill">{action.agent} · {action.risk} risk</span></div>
            {action.actionType === "ads.set_daily_budget" ? <div className="planning-action-change"><span>{action.params.campaignId.replaceAll("_", " ")}</span><strong>{current === null ? "Current budget unavailable" : pounds(current)} → {pounds(action.params.newDailyBudgetMinor)} / day</strong></div> : null}
            <details><summary>Technical details and evidence</summary><div className="planning-values"><div><strong>Current state</strong><pre>{JSON.stringify(check?.current, null, 2)}</pre></div><div><strong>Proposed parameters</strong><pre>{JSON.stringify(action.params, null, 2)}</pre></div></div>
              <p className="small">Dependencies: {action.dependsOnActionIds.join(", ") || "None"}</p><ul className="small">{check?.preconditions.map((condition) => <li key={condition}>{condition}</li>)}</ul>
              <p className="small"><strong>Rollback / contingency:</strong> {check?.rollback}</p><p className="small"><strong>Partial failure:</strong> {check?.partialFailure}</p>{evidenceCards(action.evidenceIds)}</details></article>;
        })}
        <h5>Monitoring and success criteria</h5><ul className="small">{selected.successCriteria.map((criterion, i) => <li key={i}>{criterion.metric.replaceAll("_", " ")} · {criterion.direction} · {criterion.measurementWindowMinutes} minute window{criterion.target === null ? " · no precise outcome promised" : ` · observed target ${criterion.target}`}</li>)}</ul>
        {plan ? <div className="planning-handoff" data-testid="planning-handoff"><strong>{job?.status === "submitted" ? "Ready for approval" : "Prepare for approval"}</strong><p>Submitting saves this plan for human review. It does not approve or run actions.</p><div className="row"><a className="btn" href={`/dashboard/approvals?run=${encodeURIComponent(simulationRunId)}`}>Open Approvals</a><button className="btn primary" disabled={busy || !view?.eligible || job?.status === "submitted"} onClick={() => void act({ action: "submit" })} data-testid="prepare-handoff">{job?.status === "submitted" ? "Handoff prepared" : "Prepare handoff"}</button><a className="btn" href={handoff!} target="_blank" rel="noreferrer" data-testid="plan-handoff-link">Plan handoff ↗</a></div></div> : null}
      </div> : null}
      {job?.history.length ? <details data-testid="planning-history"><summary>Planning history · {job.history.length} version(s)</summary>{job.history.map((entry) => <p className="small" key={entry.planVersion}>Version {entry.planVersion} · {entry.strategyKey} · {entry.status.replaceAll("_", " ")} · {new Date(entry.at).toLocaleString("en-GB")}</p>)}</details> : null}
      {view?.calls.length ? <details data-testid="planning-calls"><summary>Mubit requests and usage</summary>{view.calls.map((call) => <p className="small" key={call.callId}>{call.status} · Mubit · request {call.metadata?.requestId || "not returned"} · {call.metadata?.totalTokens ?? "unknown"} tokens · cost {call.metadata?.estimatedCostUsd == null ? "unknown" : call.metadata.estimatedCostUsd}<br />Task {call.task} · {call.promptVersion}<br />Fingerprint <code>{call.promptFingerprint}</code><br />Input checksum <code>{call.checksum}</code></p>)}</details> : null}
    </div>
  </section>;
}
