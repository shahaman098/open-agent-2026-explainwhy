"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, CircleDashed, ArrowRight, Brain } from "lucide-react";
import { useRun } from "./run-context";
import "./integrations.css";

interface Status {
  scope: { businessId: string; simulationRunId: string };
  docker: { capturedAt: string; output: string } | null;
  checkedAt: string;
  zetaris: { configured: boolean; live: { status: string; rows?: number; campaigns?: number; checkedAt?: string; requestId?: string; cursorClosed?: boolean }; verifiedRecords: number; verifiedObservations: number; investigationId: string | null; verifiedAt: string | null; evidenceIds: string[] };
  meterless: { engine: string; verified: boolean; storedReports: number; recalled: number; investigationId: string | null; verifiedAt: string | null; context: { id: string; content: string; source: string; refs: string[] }[]; ledger: { action: string; memoryId: string; timestamp: number }[] };
  animation: { status: string; video: string | null; investigationId: string | null; evidenceId: string | null; metric: string | null };
}
const time = (value: string | null | undefined) => value ? new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
export function IntegrationStatus() {
  const { runId, businessId, withRun } = useRun();
  const [data, setData] = useState<Status | null>(null), [error, setError] = useState<string | null>(null);
  const load = useCallback((signal?: AbortSignal) => {
    if (!runId) return;
    return fetch(`/api/dev/integrations?${new URLSearchParams({ businessId, simulationRunId: runId })}`, { cache: "no-store", signal }).then(response => {
      if (!response.ok) throw new Error("Integration status could not be loaded.");
      return response.json();
    }).then(result => { if (!signal?.aborted) { setData(result); setError(null); } })
      .catch(e => { if (!signal?.aborted) setError((e as Error).message); });
  }, [runId, businessId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const scoped = data?.scope.simulationRunId === runId && data?.scope.businessId === businessId ? data : null;
  const z = scoped?.zetaris, m = scoped?.meterless, a = scoped?.animation;
  const live = z?.live.status === "passed";
  const investigation = (id: string | null | undefined) => id ? withRun(`/dashboard/investigations/${encodeURIComponent(id)}`) : withRun("/dashboard/investigations");
  return <section className="integrations-page" aria-label="Integrations">
    {error && <p className="record-alert" role="alert">{error}</p>}
    <div className="integration-grid">
      <article className="card integration-card"><div className="integration-card-head"><div className="integration-icon zetaris-icon" aria-hidden="true">Z</div><span className="integration-required">Required</span><span className={`record-badge integration-badge ${live || z?.verifiedRecords && z?.live.status !== "failed" ? "ok" : "neutral"}`}>{live ? "Live query verified" : z?.live.status === "failed" ? "Live check needs attention" : z?.verifiedRecords ? "Evidence verified" : "Awaiting evidence"}</span></div><h2>Zetaris</h2><p>Queries advertising observations and the campaign catalogue through the Zetaris SQL API.</p><div className="integration-stat"><strong>{live ? z.live.rows : z?.verifiedObservations ?? "—"}</strong><span>source observations<br/>{live ? "verified now" : "verified in saved evidence"}</span></div><div className="integration-proof"><Check size={16}/>{z?.verifiedRecords ?? 0} verified campaign evidence records</div><div className="integration-proof"><Check size={16}/>Every returned row checked against its source</div><div className="integration-proof"><Check size={16}/>Read-only SQL join · synthetic data</div><div className="integration-card-foot"><small>{live ? `Live check ${time(z?.live.checkedAt)} · cursor closed` : `Last evidence ${time(z?.verifiedAt)}`}</small><Link href={investigation(z?.investigationId)}>Inspect evidence <ArrowRight size={15}/></Link></div></article>
      <article className="card integration-card"><div className="integration-card-head"><div className="integration-icon memory-icon" aria-hidden="true"><Brain size={25}/></div><span className="integration-required">Required</span><span className={`record-badge integration-badge ${m?.verified ? "ok" : "neutral"}`}>{m?.verified ? "Save + recall verified" : "Awaiting recall"}</span></div><h2>Meterless H-MEM</h2><p>Returns findings from prior investigations when the next investigation needs relevant context.</p><div className="integration-stat"><strong>{m?.recalled ?? "—"}</strong><span>prior {m?.recalled === 1 ? "report" : "reports"}<br/>recalled into a new investigation</span></div><div className="integration-proof"><Check size={16}/>Reference engine · durable report history</div><div className="integration-proof">{m?.ledger.length ? <Check size={16}/> : <CircleDashed size={16}/>}{m?.ledger.length ? "Create and read operations in the audit ledger" : "No recall operations recorded in this run yet"}</div><div className="integration-proof"><Check size={16}/>Memory is context; new evidence verifies claims</div><div className="integration-card-foot"><small>{m?.verifiedAt ? `Verified recall ${time(m.verifiedAt)}` : "Awaiting a prior investigation"}</small><Link href={investigation(m?.investigationId)}>Inspect recalled context <ArrowRight size={15}/></Link></div></article>
    </div>
    <details className="card integration-runtime-log"><summary><span>Verification log</span><small>Docker snapshot and integration receipts</small></summary><pre>{[
      "EXPLAINWHY / INTEGRATION RECEIPTS",
      `Run: ${runId ?? "loading"}`,
      ...(scoped?.docker ? [`\n$ docker ps  [snapshot ${scoped.docker.capturedAt}]`, scoped.docker.output, ""] : []),
      `ZETARIS  ${live ? "PASS" : "SAVED EVIDENCE"}  | SQL join → canonical source verification`,
      live ? `  ${z?.live.rows} rows | ${z?.live.campaigns} campaigns | cursor closed: ${z?.live.cursorClosed}` : `  ${z?.verifiedObservations ?? 0} observations in saved receipts`,
      ...(live ? [`  request: ${z?.live.requestId}`, `  checked: ${z?.live.checkedAt}`] : []),
      `H-MEM    ${m?.verified ? "PASS" : "AWAITING RECALL"}  | Meterless reference implementation`,
      ...(m?.ledger ?? []).map(entry => `  ${entry.action.toUpperCase().padEnd(6)} ${entry.memoryId} | ${new Date(entry.timestamp).toISOString()}`),
      ...(m?.context ?? []).flatMap(item => [`  source: ${item.source}`, ...item.refs.map(ref => `  ref: ${ref}`)]),
      `RENDER   ${a?.status?.toUpperCase() ?? "UNAVAILABLE"} | ${a?.metric ?? "no measurement selected"}`,
      `  evidence: ${a?.evidenceId ?? "none"}`,
      "DATA     SYNTHETIC | memory is context only | human review required",
    ].join("\n")}</pre></details>
    <footer className="integration-note">Local hackathon demo · synthetic business data · H-MEM reference implementation. Checks reflect returned results and saved receipts. A causal diagnosis still requires human review.{live && <span> Query receipt: {z?.live.requestId}</span>}<span><a href="/assets/ExplainWhy_UI_Walkthrough.mp4">{businessId === "nvidia_demo" ? "Watch the prior Nike UI walkthrough · 60s" : "Watch the full UI walkthrough · 60s"} <ArrowRight size={12}/></a></span></footer>
  </section>;
}
