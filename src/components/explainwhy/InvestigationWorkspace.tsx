"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, q, type Bundle, type CollectionSummary, type EvidenceList, type Trace } from "./api";
import { useRun } from "./run-context";
import { EvidenceExplorer } from "./EvidenceExplorer";
import { AIInvestigation } from "./AIInvestigation";
import { EvidenceToolTrace } from "./EvidenceToolTrace";
import { PageSkeleton } from "./PageSkeleton";
import { SolutionPlanning } from "./SolutionPlanning";
import { InvestigationStory } from "./InvestigationStory";
import { InvestigationArchive } from "./InvestigationArchive";

interface Data { bundle: Bundle; evidence: EvidenceList; trace: Trace }

export function InvestigationWorkspace() {
  const investigationId = decodeURIComponent(useParams<{ id: string }>().id);
  const archiveBusinessId = useSearchParams().get("businessId");
  const { runId, loaded, withRun } = useRun();
  const [result, setResult] = useState<{ runId: string | null; data: Data | null; notFound: boolean; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastRun, setLastRun] = useState<{ runId: string | null; summary: CollectionSummary } | null>(null);
  const selected = useRef<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async (run: string | null) => {
    const key = run;
    const sequence = ++requestSequence.current;
    try {
      const scope = q({ simulationRunId: run });
      const [bundle, evidence, trace] = await Promise.all([
        api<Bundle>(`/api/investigations/${encodeURIComponent(investigationId)}?${scope}`),
        api<EvidenceList>(`/api/investigations/${encodeURIComponent(investigationId)}/evidence?${scope}&limit=100`),
        api<Trace>(`/api/investigations/${encodeURIComponent(investigationId)}/evidence-trace?${scope}`),
      ]);
      if (selected.current !== key || requestSequence.current !== sequence) return;
      setResult({ runId: key, data: { bundle, evidence, trace }, notFound: false, error: null });
    } catch (e) {
      if (selected.current !== key || requestSequence.current !== sequence) return;
      setResult({ runId: key, data: null, notFound: (e as { status?: number }).status === 404, error: (e as { status?: number }).status === 404 ? null : (e as Error).message });
    }
  }, [investigationId]);
  useLayoutEffect(() => { selected.current = runId; requestSequence.current++; }, [runId]);
  useEffect(() => { if (!loaded) return; void (async () => { await load(runId); })(); }, [runId, loaded, load]);

  const collect = async (mode: "initial" | "refresh") => {
    setBusy(true); setError(null);
    try {
      const summary = await api<CollectionSummary>(`/api/dev/investigations/${encodeURIComponent(investigationId)}/collect-evidence`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(runId ? { simulationRunId: runId } : {}), collectionMode: mode }) });
      setLastRun({ runId, summary }); await load(runId);
    } catch (e) {
      setError((e as { code?: string }).code === "evidence_collection_in_progress" ? "Evidence collection is already running for this investigation; it will appear when finished." : (e as Error).message);
    } finally { setBusy(false); }
  };

  if (!loaded) return <PageSkeleton variant="workspace" label="Loading investigation workspace" />;
  const current = result && result.runId === runId ? result : null;
  const data = current?.data ?? null, notFound = current?.notFound ?? false, last = lastRun && lastRun.runId === runId ? lastRun.summary : null;
  if (notFound && archiveBusinessId && runId) return <InvestigationArchive key={`${archiveBusinessId}:${runId}:${investigationId}`} investigationId={investigationId} businessId={archiveBusinessId} simulationRunId={runId} />;
  if (notFound) return <div className="empty" data-testid="investigation-not-found">Investigation <code>{investigationId}</code> does not exist in run <code>{runId}</code>. Evidence is scoped to one business and simulation run; pick the run it belongs to. <Link href={withRun("/dashboard")}>Back to overview</Link>.</div>;
  if (current?.error && !data) return <div className="alert error" data-testid="investigation-error">{current.error}</div>;
  if (!data) return <PageSkeleton variant="workspace" label="Loading investigation workspace" />;
  const { bundle, evidence, trace } = data;
  const inv = bundle.investigation, latest = evidence.latestCollection;
  return <InvestigationStory key={`story:${bundle.simulationRunId}:${inv.investigationId}`} bundle={bundle} evidenceItems={evidence.items}
    investigationDetails={<AIInvestigation investigationId={inv.investigationId} businessId={inv.businessId} simulationRunId={bundle.simulationRunId} evidenceItems={evidence.items} onComplete={() => void load(runId)} />}
    evidenceDetails={(sources, report) => <>
      <div className="card" data-testid="evidence-panel" id="evidence-controls">
        <div className="card-head"><h3>Evidence retrieval</h3>
          <div className="row">
            <button className="btn primary" onClick={() => collect("initial")} disabled={busy} data-testid="collect-evidence">{busy ? <><span className="spinner" /> Collecting…</> : "Collect evidence"}</button>
            <button className="btn" onClick={() => collect("refresh")} disabled={busy || !latest} title="Repeat retrieval for the current cutoff" data-testid="refresh-evidence">Refresh</button>
          </div>
        </div>
        <div className="card-body" style={{ display: "grid", gap: 6 }}>
          {error ? <div className="alert error" data-testid="collect-error">{error}</div> : null}
          {latest ? (
            <>
              <span className="small" data-testid="collection-summary">Status <strong>{latest.status}</strong> · {latest.completedTools.length}/{latest.selectedTools.length} tools complete · {evidence.total} records · cutoff {latest.cutoff}{latest.failedTools.length ? ` · ${latest.failedTools.length} failed` : ""}{latest.attempt > 1 ? ` · attempt ${latest.attempt}` : ""}</span>
              <div className="row" style={{ flexWrap: "wrap" }} data-testid="selected-tools">{latest.selectedTools.map((t) => <span key={t.tool} className={`pill ${latest.completedTools.includes(t.tool) ? "ok" : latest.failedTools.includes(t.tool) ? "danger" : latest.emptyTools.includes(t.tool) ? "" : "warn"}`} title={t.reason}>{t.tool} · {t.role.replaceAll("_", " ")}</span>)}</div>
              {last ? <span className="muted small" data-testid="collect-result">{last.reused ? "Returned the existing collection; nothing rerun." : `Ran ${last.outcomes.length} tools; saved ${last.evidenceIds.length} records.`}</span> : null}
            </>
          ) : <span className="muted small">No evidence collected yet. Collect records to review the investigation sources.</span>}
        </div>
      </div>

      <EvidenceExplorer items={evidence.items} total={evidence.total} simulationRunId={bundle.simulationRunId} externalSources={sources} report={report} />
      <details className="canvas-detail-section"><summary>Evidence collection and tool timeline</summary><EvidenceToolTrace collections={trace.collections} runs={trace.toolRuns} /></details>
    </>}
    decisionDetails={<><SolutionPlanning investigationId={inv.investigationId} businessId={inv.businessId} simulationRunId={bundle.simulationRunId} evidenceItems={evidence.items} />
      <section className="card" data-testid="execution-intake"><div className="card-head"><h3>Approval and execution</h3></div><div className="card-body"><p>Review the saved plan or check completed actions.</p><div className="row"><a className="btn primary" href={`/dashboard/approvals?run=${encodeURIComponent(bundle.simulationRunId)}`}>Open Approvals</a><a className="btn" href={`/dashboard/activity?run=${encodeURIComponent(bundle.simulationRunId)}`}>Execution activity</a></div></div></section></>}
  />;
}
