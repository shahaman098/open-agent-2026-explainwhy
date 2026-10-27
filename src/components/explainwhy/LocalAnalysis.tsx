"use client";
import Link from "next/link";
import { Cpu, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api, q } from "./api";
import type { analysisView } from "@/intelligence/dashboard/store";
import type { AnalysisFact } from "@/intelligence/dashboard/schema";
import "./local-analysis.css";

type View = Awaited<ReturnType<typeof analysisView>>;
const date = (value: string | null) => value ? new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" }) + " UTC" : "Awaiting analysis";
function Fact({ fact, interpretation }: { fact: AnalysisFact; interpretation: string }) {
  return <article className="local-analysis-fact"><span>{fact.label}</span><strong>{fact.current}</strong><small>{fact.previous !== null ? `Previous window ${fact.previous}` : "Current records"}{fact.changePercent !== null ? ` · ${fact.changePercent > 0 ? "+" : ""}${fact.changePercent}%` : ""}</small><p>{interpretation}</p></article>;
}
export function LocalAnalysis({ businessId, simulationRunId, compact = false }: { businessId: string; simulationRunId: string; compact?: boolean }) {
  const url = `/api/dev/dashboard-analysis?${q({ businessId, simulationRunId })}`;
  const [view, setView] = useState<View | null>(null), [error, setError] = useState<string | null>(null), [retrying, setRetrying] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try { const next = await api<View>(url, { signal: controller.signal }); if (!controller.signal.aborted) { setView(next); setError(null); } }
      catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Local analysis is unavailable"); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 5000);
    };
    void api(url, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "watch" }) }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Local model is unavailable"); }).finally(() => { if (!controller.signal.aborted) void poll(); });
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [url]);
  const current = view?.scope.businessId === businessId && view?.scope.simulationRunId === simulationRunId ? view : null;
  const report = current?.latest, working = current?.state === "pending" || current?.state === "queued" || current?.state === "running";
  const ready = !!report && !current?.stale && !working;
  const status = error ? "Unavailable" : !current ? "Connecting" : !current.local ? "Local model required" : !current.workerOnline ? "Worker offline" : current.state === "failed" ? "Needs attention" : working ? report ? "Updating analysis" : "Analyzing data" : ready ? "Up to date" : "Watching for data";
  const retry = async () => {
    setRetrying(true);
    try { const next = await api<View>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry" }) }); setView(next); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Analysis could not restart"); }
    finally { setRetrying(false); }
  };
  return <section className={`card local-analysis${compact ? " local-analysis-compact" : ""}`} id={compact ? undefined : "explainwhy-analysis"} aria-label={compact ? "Current run AI analysis" : "ExplainWhy automatic analysis"} data-testid="local-analysis">
    <header className="local-analysis-head"><div className="local-analysis-title"><span className="local-analysis-icon"><Sparkles size={21} aria-hidden="true"/></span><div><h2>{compact ? "Current run analysis" : "ExplainWhy analysis"}</h2><p>Updates automatically when operational data changes.</p></div></div><div className="local-analysis-status"><span><Cpu size={14} aria-hidden="true"/> Local Nemotron</span><span className={`record-badge ${ready && current?.workerOnline ? "approval-completed" : "approval-awaiting_review"}`} role="status">{working && current?.workerOnline ? <RefreshCw size={12} className="local-analysis-spin" aria-hidden="true"/> : null}{status}</span></div></header>
    {(error || current?.error) && <div className="local-analysis-error" role="alert"><span>{error || current?.error}</span>{current?.workerOnline && current.local && !working ? <button className="btn sm" disabled={retrying} onClick={() => void retry()}>{retrying ? "Retrying…" : "Retry analysis"}</button> : null}</div>}
    {report ? <>
      {current?.stale && <p className="local-analysis-stale">New data detected. Showing the previous analysis while the latest snapshot is processed.</p>}
      <div className="local-analysis-summary"><span>AI-prioritized observations · for review</span><h3>{report.output.headline}</h3><p>{report.output.summary}</p></div>
      {!compact && <div className="local-analysis-facts">{report.output.findings.map(finding => { const fact = report.packet.facts.find(item => item.id === finding.factId); return fact ? <Fact key={fact.id} fact={fact} interpretation={finding.interpretation}/> : null; })}</div>}
      <div className="local-analysis-checks"><h3>What to check next</h3><ol>{report.output.nextChecks.map((check, index) => <li key={index}><span>{check.topic.replaceAll("_", " ")}</span><p>{check.reason}</p><small>Based on {check.factIds.map(id => report.packet.facts.find(fact => fact.id === id)?.label ?? id).join(" · ")}</small></li>)}</ol></div>
      {!compact && report.packet.investigations.length > 0 && <div className="local-analysis-investigations">{report.packet.investigations.slice(0, 2).map(item => <Link key={item.investigationId} href={`/dashboard/investigations/${encodeURIComponent(item.investigationId)}?${q({ businessId, run: simulationRunId })}`}>Inspect investigation ↗</Link>)}</div>}
      <details className="local-analysis-receipt"><summary>Data snapshot and model receipt</summary><p>Window {date(report.packet.window.startAt)} → {date(report.packet.window.endAt)} · GBP</p><dl>{report.packet.facts.map(fact => <div key={fact.id}><dt>{fact.label}</dt><dd>{fact.current}{fact.previous !== null ? ` · previous ${fact.previous}` : ""}<small>{fact.explanation} Source: {fact.source}.</small></dd></div>)}</dl><p>Nemotron selects the focus, observations and next checks. Comparison wording and numeric values are rendered from the cited facts.{report.noteAccepted ? " The summary includes a qualitative model note." : " A free-form model note is not used."}</p><p>Model: <code>{report.model}</code> · Snapshot <code>{report.fingerprint.slice(0, 16)}</code></p>{report.calls.map((call, index) => <p key={index}>Local request <code>{call.requestId}</code> · {call.totalTokens ?? "Unknown"} tokens · {(call.latencyMs / 1000).toFixed(1)}s</p>)}{report.packet.limitations.map(item => <p key={item}>{item}</p>)}</details>
    </> : <div className="local-analysis-empty"><Cpu size={27} aria-hidden="true"/><strong>{current?.workerOnline ? "Nemotron is reading the latest database snapshot" : "Waiting for the local analysis service"}</strong><p>{current?.workerOnline ? "The explanation will appear here automatically. Charts remain available while it runs." : "A saved analysis appears when the local worker processes this run."}</p></div>}
    <footer><span>Last analysis {date(report?.generatedAt ?? null)}</span><span>Interpretation is separate from a validated diagnosis. Actions require human review.</span></footer>
  </section>;
}
