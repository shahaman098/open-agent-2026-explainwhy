"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExternalSourceT, ReportT, StateT } from "@/intelligence/investigator/schemas";
import type { CallMetadata } from "@/intelligence/investigator/provider";
import { api, q, type EvidenceItem } from "./api";
import { PageSkeleton } from "./PageSkeleton";
import { ExternalEvidenceCard, InternalEvidenceCard } from "./EvidenceCards";
import { scopedExternalSources } from "./evidence-card-model";
interface View { state: StateT | null; report: ReportT | null; sources: ExternalSourceT[]; researchTraces: Array<{ callId: string; queries: string[]; groundingPresent: boolean; candidates: Array<{ url: string }>; limitations: string[] }>;
  calls: Array<{ callId: string; task: string; status: string; metadata: Partial<CallMetadata> | null; error: string | null }> }
export function AIInvestigation({ investigationId, businessId, simulationRunId, evidenceItems, onComplete, onResearchUpdate }: { investigationId: string; businessId: string; simulationRunId: string; evidenceItems: EvidenceItem[]; onComplete: () => void; onResearchUpdate?: (sources: ExternalSourceT[], report: ReportT | null) => void }) {
  const url = `/api/investigations/${encodeURIComponent(investigationId)}/ai?${q({ businessId, simulationRunId })}`;
  const [view, setView] = useState<View | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const sequence = useRef(0), alive = useRef(true), complete = useRef(false), evidenceCount = useRef(0), callback = useRef(onComplete), researchCallback = useRef(onResearchUpdate), researchVersion = useRef("");
  useEffect(() => { callback.current = onComplete; }, [onComplete]);
  useEffect(() => { researchCallback.current = onResearchUpdate; }, [onResearchUpdate]);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const response = await api<View>(url);
      const data = { ...response, sources: scopedExternalSources(response.sources, { businessId, simulationRunId, investigationId }) };
      if (!alive.current || current !== sequence.current) return;
      setView(data); setError(null);
      const version = JSON.stringify([data.report?.reportId, data.sources.map((source) => [source.sourceId, source.status, source.claimSupport])]);
      if (version !== researchVersion.current) { researchVersion.current = version; researchCallback.current?.(data.sources, data.report); }
      if ((data.state?.evidenceIds.length || 0) > evidenceCount.current) {
        evidenceCount.current = data.state!.evidenceIds.length;
        callback.current();
      }
      if (data.report && !complete.current) { complete.current = true; callback.current(); }
    } catch (e) { if (alive.current && current === sequence.current) setError((e as Error).message); }
  }, [url, businessId, simulationRunId, investigationId]);
  useEffect(() => { alive.current = true; void (async () => { await load(); })(); const timer = setInterval(() => void load(), 2500); return () => { alive.current = false; clearInterval(timer); }; }, [load]);
  const act = async (action: "start" | "cancel") => {
    setBusy(true); setError(null);
    try { await api(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }); await load(); }
    catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  };
  const state = view?.state, report = view?.report, latest = state?.hypotheses.at(-1);
  const evidenceById = new Map(evidenceItems.map((item) => [item.evidence.evidenceId, item]));
  const sourcesById = new Map(view?.sources.map((source) => [source.sourceId, source]) || []);
  const evidenceCards = (ids: string[]) => <div className="investigation-inline-evidence">{[...new Set(ids)].slice(0, 3).map((id) => {
    const item = evidenceById.get(id), source = sourcesById.get(id);
    return item ? <InternalEvidenceCard key={id} item={item} compact /> : source ? <ExternalEvidenceCard key={id} source={source} /> : null;
  })}</div>;
  if (!view && !error) return <PageSkeleton variant="panel" label="Loading AI investigation" />;
  const running = state?.status === "running" || state?.status === "queued";
  const cite = (id: string) => {
    const local = evidenceById.has(id) ? `#evidence-${encodeURIComponent(id)}` : sourcesById.has(id) ? `#source-${encodeURIComponent(id)}` : null;
    const link = local || report?.ledger.find((l) => l.evidenceId === id)?.sourceLinks[0];
    return link ? <a key={id} className="investigation-citation" href={link} {...(local ? {} : { target: "_blank", rel: "noopener noreferrer" })}>[{id.slice(-8)}]</a> : <span key={id} className="small">[{id.slice(-8)}]</span>;
  };
  return <section className="card" data-testid="ai-investigation">
    <div className="card-head"><h3>AI investigation</h3><div className="row">
      {!state ? <button className="btn primary" disabled={busy || !view} onClick={() => void act("start")} data-testid="start-ai">{busy ? "Queuing…" : "Start AI investigation"}</button> : <span className="pill" data-testid="ai-status">{state.status.replaceAll("_", " ")}</span>}
      {running ? <button className="btn" disabled={busy} onClick={() => void act("cancel")} data-testid="cancel-ai">Cancel</button> : null}
    </div></div>
    <div className="card-body" style={{ display: "grid", gap: 16 }}>
      {error ? <div role="alert" className="alert error">{error}</div> : null}
      {!state ? <p className="muted small">Compare explanations against read-only evidence. Sources are saved for review.</p> : <div className="small" aria-live="polite" data-testid="ai-progress">
        <strong>{state.stage.replaceAll("_", " ")}</strong> · {state.hypotheses.length} rounds · {state.toolCount} tools · {state.evidenceIds.length} records
        {state.status === "queued" ? <p className="muted">Waiting for the investigator.</p> : null}
        {state.error ? <p className="alert error">{state.error}</p> : null}
        {state.stopReason ? <p className="muted">{state.stopReason}</p> : null}
      </div>}
      {report ? <div className="investigation-brief" data-testid="executive-brief"><span className="investigation-kicker">{state?.status === "failed" ? "Provisional diagnosis" : report.insufficientEvidence ? "Evidence limited" : "AI diagnosis"}</span><h3>{state?.status === "failed" ? "Provisional report" : report.insufficientEvidence ? "Insufficient evidence" : "Final diagnosis"}</h3><p>{report.executiveBrief.explanation}</p><p className="muted small">Confidence: {report.executiveBrief.certainty}</p>
        {report.executiveBrief.review.length ? <details><summary>Review notes</summary><p className="small">{report.executiveBrief.review.join(" · ")}</p></details> : null}{report.sections[0]?.evidenceIds.length ? <><div className="investigation-citations">Evidence: {report.sections[0].evidenceIds.map(cite)}</div>{evidenceCards(report.sections[0].evidenceIds)}</> : null}</div> : null}
      {latest ? <div data-testid="hypothesis-comparison"><h4>Hypothesis comparison</h4>{latest.hypotheses.map((h) => <details key={h.hypothesisId} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
        <summary>{h.cause.replaceAll("_", " ")} · {h.support.replaceAll("_", " ")}</summary><p>{h.explanation}</p><p className="small">Mechanism: {h.mechanism}</p>
        <p className="small">Support: {h.evidenceIds.length ? h.evidenceIds.map(cite) : "None yet"} · Contradictions: {h.counterEvidenceIds.length ? h.counterEvidenceIds.map(cite) : "None recorded"}</p>{evidenceCards([...h.evidenceIds, ...h.counterEvidenceIds])}
        <p className="small">Missing: {h.missingEvidence.join("; ") || "None specified"}</p><p className="small">Could be weakened by: {h.falsificationTests.join("; ")}</p>
        <p className="muted small">Chronology: {h.chronology} Controls: {h.controlComparison}</p>
      </details>)}{state && state.hypotheses.length > 1 ? <details><summary>Assessment history</summary>{state.hypotheses.map((h) => <p key={h.revision} className="small">Round {h.revision}: {h.decisionSummary}</p>)}</details> : null}</div> : null}
      {report ? <>
        <div data-testid="business-impact"><h4>Business impact</h4>{report.impact.status === "measured" ? <p>{report.impact.value?.toLocaleString("en-GB", { maximumFractionDigits: 2 })} {report.impact.unit} versus {report.impact.baseline?.toLocaleString("en-GB", { maximumFractionDigits: 2 })} baseline. Observed difference: {report.impact.delta?.toLocaleString("en-GB", { maximumFractionDigits: 2 })}. {report.impact.evidenceId ? cite(report.impact.evidenceId) : null}</p> : <p>{report.impact.interpretation}</p>}<p className="muted small">{report.impact.limitations.join(" ")}</p></div>
        <details data-testid="full-report"><summary>Full investigation dossier</summary>{report.sections.map((s) => <section className="investigation-report-section" key={s.title}><h4>{s.title}</h4><p style={{ whiteSpace: "pre-line" }}>{s.text}</p><div className="investigation-citations">{s.evidenceIds.map(cite)}</div>{evidenceCards(s.evidenceIds)}</section>)}</details>
        {report.insufficientEvidence ? <details data-testid="insufficient-evidence"><summary>Evidence gaps and limits</summary><p>Known: {report.insufficientEvidence.known.join("; ") || "No verified observations"}</p><p>Unknown: {report.insufficientEvidence.unknown.join("; ")}</p><p>Plausible explanations: {report.insufficientEvidence.plausibleExplanations.join("; ")}</p><p>Useful next evidence: {report.insufficientEvidence.usefulNextEvidence.join("; ")}</p><p>Conclusions not justified: {report.insufficientEvidence.conclusionsNotJustified.join("; ")}</p></details> : null}
        <details data-testid="claim-matrix"><summary>Claim and source ledger</summary>{report.claims.map((c) => <div className="investigation-report-section" key={c.claimId}><p>{c.claim}</p><p className="small">{c.kind.replaceAll("_", " ")} · {c.support.replaceAll("_", " ")} · Support {c.evidenceIds.map(cite)} · Contradictions {c.counterEvidenceIds.map(cite)} · Public context {c.sourceIds.map(cite)}</p><p className="muted small">{c.limitations.join(" ")}</p>{evidenceCards([...c.evidenceIds, ...c.counterEvidenceIds, ...c.sourceIds])}</div>)}{report.ledger.map((l) => <p key={l.evidenceId} className="small">{cite(l.evidenceId)} {l.origin} · {l.role} · {l.verification}</p>)}</details>
        <details data-testid="planner-readiness"><summary>Planner readiness handoff</summary><p>{report.handoff.ready ? "Ready for a planner to review." : "Further evidence needed before planning."}</p><p className="small">{report.handoff.constraints.join(" · ")}</p><p>Supported findings: {report.handoff.supportedFindings.join(" ") || "None established."}</p><p>Affected: {report.handoff.affectedEntities.join(", ")}</p><p>Uncertainty: {report.handoff.uncertainty.join(" ")}</p>{report.handoff.evidenceIds.map(cite)}</details>
        <details data-testid="report-validation"><summary>Report validation</summary><p>{report.validation.checks.join(" · ")}</p><p>Claim support is model assessed; resolved citations do not prove causality.</p></details>
      </> : null}
      {view?.sources.length ? <div data-testid="research-sources"><h4>Research sources</h4>{view.sources.map((s) => <details key={s.sourceId} id={`source-${s.sourceId}`}><summary>{s.title} · {s.status.replaceAll("_", " ")}</summary><ExternalEvidenceCard source={s} />
        <p>{s.publisher || "Publisher unknown"} · {s.canonicalUrl ? <a href={s.canonicalUrl} target="_blank" rel="noreferrer">{s.httpStatus === 200 ? "Open retrieved source" : "Open candidate URL"} ↗</a> : "No verified URL"}</p><p className="small">Published {s.publishedAt || "unknown"} · Retrieved {s.retrievedAt} · Updated {s.updatedAt || "unknown"}</p>
        <p>Proposed finding: {s.proposedClaim}</p>{s.excerpt ? <blockquote>{s.excerpt}</blockquote> : null}<p className="small">Passage match: {s.excerptMatched ? "yes" : "no"} · Timing: {s.temporalValidity.replaceAll("_", " ")} · Claim assessment: {s.semanticAssessment.replaceAll("_", " ")}</p><p className="muted small">{s.limitations.join(" ")}</p></details>)}</div> : null}
      {view?.researchTraces.length ? <details data-testid="research-activity"><summary>External research activity</summary>{view.researchTraces.map((trace) => <div key={trace.callId} className="small"><p>Grounding: {trace.groundingPresent ? "returned" : "not returned"} · {trace.candidates.length} source candidates</p><p>Search queries: {trace.queries.join(" · ") || "none returned"}</p><p className="muted">{trace.limitations.join(" ")}</p></div>)}</details> : null}
      {state?.steps.length ? <details open={running} data-testid="ai-timeline"><summary>Investigation activity</summary>{state.steps.map((s) => <div key={s.stepId} className="small investigation-activity-step"><div className="investigation-card-top"><strong>{["reasoning", "diagnosis", "research"].includes(s.type) ? "Mubit" : s.identifier}</strong><span className={`pill ${s.status === "completed" ? "ok" : s.status === "failed" ? "danger" : "warn"}`}>{s.status}</span></div>
        <div className="muted"><time dateTime={s.startedAt}>{new Date(s.startedAt).toLocaleString("en-GB")}</time>{s.completedAt ? ` · ${Math.max(0, Date.parse(s.completedAt) - Date.parse(s.startedAt)).toLocaleString("en-GB")} ms` : " · in progress"}</div>
        <div>{s.question}</div><div className="muted">{s.resultSummary || "Running…"}</div>{s.evidenceIds.length ? <div className="investigation-citations">Evidence: {s.evidenceIds.map(cite)}</div> : null}{s.error ? <div className="alert error">{s.error}</div> : null}{s.parameters ? <details><summary>Validated tool parameters</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(s.parameters, null, 2)}</pre></details> : null}</div>)}</details> : null}
      {view?.calls.length ? <details data-testid="model-calls"><summary>Mubit requests and usage</summary>{view.calls.map((c) => <p className="small" key={c.callId}>{c.task} · {c.status} · {c.metadata?.provider === "google_direct" ? "External research" : "Mubit"} · request {c.metadata?.requestId || "not returned"} · {c.metadata?.totalTokens ?? "unknown"} tokens · {c.metadata?.latencyMs ?? "unknown"} ms · cost {c.metadata?.estimatedCostUsd == null ? "not estimated" : `$${c.metadata.estimatedCostUsd.toFixed(4)}`}</p>)}</details> : null}
    </div>
  </section>;
}
