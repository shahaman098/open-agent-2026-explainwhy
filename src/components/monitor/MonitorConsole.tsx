"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { virtualDate } from "@/lib/format";
import { NormalLogo } from "@/components/normal/NormalLogo";
import { PageSkeleton } from "@/components/normal/PageSkeleton";

type Severity = "low" | "medium" | "high" | "critical";
interface RunsResponse { activeSimulationRunId: string | null; runs: Array<{ simulationRunId: string; virtualTime: string }> }
interface Status { lastAsOf: string | null; lastScanAt: string | null; watermark: string | null;
  jobs?: Record<string, number>; methodA?: { enabled: boolean }; failedJobs?: Array<{ jobKey: string; lastError: string; attempts: number }>;
  worker?: { connected: boolean; lastHeartbeatAt: string | null; lastError: string | null } }
interface AnomalyItem {
  anomaly: { anomalyId: string; metric: string; direction: string; severity: Severity; status: string; actualValue: number; baselineValue: number; changePercent: number;
    currentWindow: { startAt: string; endAt: string }; baselineWindow: { startAt: string; endAt: string }; detectedAt: string; sourceSnapshotIds: string[] };
  finding: { findingId: string; label: string; theme: string; segmentLabel: string; reason: string; incidentId: string | null; polarity: string } | null;
}
interface Incident {
  incidentId: string; title: string; status: string; polarity: string; primaryTheme: string; severity: { level: Severity; score: number }; findingIds: string[];
  anomalyIds: string[]; investigationId: string | null; investigationPolicy: { qualifies: boolean; reason: string }; onsetAt: string; lastTriggeredAt: string; resolvedAt: string | null; summary: string;
}
interface Bundle {
  investigation: { investigationId: string; title: string; status: string; startedAt: string; anomalyIds: string[] };
  findings: Array<{ findingId: string; label: string; segmentLabel: string; status: string; reason: string; severity: { level: Severity; score: number } }>;
  affected: { campaigns: string[]; products: string[]; channels: string[]; categories: string[] };
  metricSnapshots: unknown[]; sourceRecords: unknown[]; relatedIncidents: Array<{ incidentId: string; title: string }>; note: string;
}
interface ScanSummary { asOf: string; repeatScan: boolean; durationMs: number; findings: { active: number }; persisted: { investigations: { created: string[] }; incidents: { created: number; updated: number } } | null; skippedChecks: unknown[] }

const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
const sevClass = (s: Severity) => (s === "critical" ? "danger" : s === "high" ? "warn" : s === "medium" ? "accent" : "");

function fmtValue(metric: string, v: number): string {
  if (metric.endsWith("_rate") || metric === "ctr") return `${(v * 100).toFixed(2)}%`;
  if (metric.endsWith("_minor")) return `£${(v / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error?.message ?? `Request failed (${res.status})`), { status: res.status, code: body?.error?.code });
  return body as T;
}

export function MonitorConsole() {
  const [runs, setRuns] = useState<RunsResponse | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [anomalies, setAnomalies] = useState<{ total: number; items: AnomalyItem[] } | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // Mirrors the selected run so responses for a run the operator has since left are discarded.
  const selectedRef = useRef<string | null>(null);

  const selectRun = useCallback((id: string | null) => { selectedRef.current = id; setRunId(id); }, []);

  const load = useCallback(async (id: string | null, sev: Severity | null) => {
    if (!id) return;
    try {
      const q = `simulationRunId=${encodeURIComponent(id)}`;
      const [st, an, inc] = await Promise.all([
        api<Status>(`/api/dev/monitor/run?${q}`),
        api<{ total: number; items: AnomalyItem[] }>(`/api/anomalies?${q}&limit=100${sev ? `&severity=${sev}` : ""}`),
        api<{ items: Incident[] }>(`/api/incidents?${q}&limit=50${sev ? `&severity=${sev}` : ""}`),
      ]);
      if (selectedRef.current !== id) return;
      setStatus(st); setAnomalies(an); setIncidents(inc.items); setError(null);
    } catch (e) {
      if ((e as { status?: number }).status === 404 && !(e as { code?: string }).code) setUnavailable(true);
      else if (selectedRef.current === id) setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // Strict Mode mounts twice in development; a cancelled first pass must not override a run chosen meanwhile.
    let cancelled = false;
    void (async () => {
      try {
        const r = await api<RunsResponse>("/api/dev/simulator/runs");
        if (cancelled) return;
        setRuns(r);
        if (selectedRef.current) return;
        const id = r.activeSimulationRunId ?? r.runs[0]?.simulationRunId ?? null;
        selectRun(id);
        await load(id, null);
      } catch (e) {
        if (cancelled) return;
        if ((e as { status?: number }).status === 404) setUnavailable(true); else setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [load, selectRun]);

  useEffect(() => {
    if (!runId) return;
    const timer = setInterval(() => { void load(runId, severity); }, 5_000);
    return () => clearInterval(timer);
  }, [runId, severity, load]);

  const runScan = async () => {
    if (!runId) return;
    setBusy(true); setError(null);
    try {
      const s = await api<ScanSummary>("/api/dev/monitor/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ simulationRunId: runId }) });
      setScan(s);
      await load(runId, severity);
    } catch (e) {
      setError((e as { code?: string }).code === "monitor_locked" ? "A scan is already running for this run (possibly the automatic post-tick scan). Try again in a moment." : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openInvestigation = async (id: string) => {
    try { setBundle(await api<Bundle>(`/api/investigations/${encodeURIComponent(id)}`)); } catch (e) { setError((e as Error).message); }
  };

  const initialLoading = (!runs || (runId !== null && status === null)) && !error && !unavailable;
  return (
    <>
      <header className="topbar"><div className="shell topbar-inner">
        <Link href="/" className="brand normal-legacy-brand"><NormalLogo /><small>· Anomaly monitor</small></Link>
        <div className="row"><Link href="/dev/simulator" className="btn sm">Control room</Link><Link href="/demo-store" className="btn sm">Demo store</Link></div>
      </div></header>
      <main className="shell cr">
        <div className="cr-head">
          <div><h1>Anomaly monitor</h1><div className="muted">Detector reads only canonical events and metric snapshots. Scenario settings are never visible to it.</div></div>
          <div className="row">
            <select className="select" style={{ width: "auto" }} value={runId ?? ""} onChange={(e) => { selectRun(e.target.value); setBundle(null); setScan(null); setStatus(null); setAnomalies(null); setIncidents([]); void load(e.target.value, severity); }} data-testid="monitor-run-select" disabled={!runs?.runs.length}>
              {!runs?.runs.length ? <option value="">No runs</option> : null}
              {runs?.runs.map((r) => <option key={r.simulationRunId} value={r.simulationRunId}>{r.simulationRunId}</option>)}
            </select>
            <button className="btn primary" onClick={runScan} disabled={!runId || busy || unavailable} data-testid="run-scan">{busy ? <><span className="spinner" /> Scanning…</> : "Run anomaly scan"}</button>
          </div>
        </div>
        {unavailable ? <div className="alert error">Monitoring controls are only available in development or a configured demo mode.</div> : null}
        {error ? <div className="alert error" data-testid="monitor-error">{error}</div> : null}
        {initialLoading ? <PageSkeleton variant="section" label="Loading anomaly monitor data" /> : <>
        <div className="card" data-testid="monitor-worker-status">
          Direct trigger: {status?.methodA?.enabled ? "enabled" : "disabled"} · Change Stream worker: {status?.worker?.connected ? "connected (recent heartbeat)" : "no current connection confirmed"}
          <div className="muted">Jobs: {status?.jobs?.pending ?? 0} pending · {status?.jobs?.running ?? 0} running · {status?.jobs?.completed ?? 0} completed · {status?.jobs?.failed ?? 0} failed</div>
          {status?.failedJobs?.map((job) => <div key={job.jobKey} className="alert error">Monitoring attempt {job.attempts}: {job.lastError}</div>)}
        </div>

        <div className="grid kpis">
          <div className="card kpi"><span className="label">Last scan (wall clock)</span><span className="value" style={{ fontSize: 16 }} data-testid="last-scan">{status?.lastScanAt ? new Date(status.lastScanAt).toLocaleString("en-GB") : "never"}</span></div>
          <div className="card kpi"><span className="label">Analysed up to (virtual)</span><span className="value" style={{ fontSize: 16 }} data-testid="last-asof">{virtualDate(status?.lastAsOf ?? null)}</span></div>
          <div className="card kpi"><span className="label">Latest observed hour</span><span className="value" style={{ fontSize: 16 }}>{virtualDate(status?.watermark ?? null)}</span></div>
          <div className="card kpi"><span className="label">Anomalies (canonical)</span><span className="value" data-testid="anomaly-total">{anomalies?.total ?? "—"}</span></div>
        </div>
        {scan ? (
          <div className="alert ok" data-testid="scan-summary">
            Scan to {virtualDate(scan.asOf)}{scan.repeatScan ? " (repeat of an already processed window, so nothing was duplicated)" : ""}: {scan.findings.active} active findings, {scan.persisted?.incidents.created ?? 0} new and {scan.persisted?.incidents.updated ?? 0} updated incidents, {scan.persisted?.investigations.created.length ?? 0} investigations opened, {scan.skippedChecks.length} check groups skipped for insufficient data · {scan.durationMs} ms
          </div>
        ) : null}

        <div className="row">
          <span className="muted small">Severity</span>
          <button className={`chip ${severity === null ? "active" : ""}`} onClick={() => { setSeverity(null); void load(runId, null); }}>All</button>
          {SEVERITIES.map((s) => <button key={s} className={`chip ${severity === s ? "active" : ""}`} onClick={() => { setSeverity(s); void load(runId, s); }} data-testid={`sev-${s}`}>{s}</button>)}
        </div>

        <div className="card">
          <div className="card-head"><h3>Incidents</h3><span>grouped by timing and metric relationships (not causation)</span></div>
          <div className="card-body" style={{ display: "grid", gap: 10 }} data-testid="incidents">
            {incidents.length === 0 ? <div className="muted small">No incidents for this run{severity ? ` at ${severity} severity` : ""}.</div> : null}
            {incidents.map((i) => (
              <div key={i.incidentId} className="order" data-testid="incident">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{i.title}</strong>
                  <div className="row"><span className={`pill ${sevClass(i.severity.level)}`}>{i.severity.level} · {i.severity.score}</span><span className="pill">{i.polarity}</span><span className={`pill ${i.status === "resolved" ? "ok" : ""}`}>{i.status}</span></div>
                </div>
                <span className="muted small">{i.summary}</span>
                <span className="small">{i.findingIds.length} findings · {i.anomalyIds.length} canonical anomalies · since {virtualDate(i.onsetAt)}{i.resolvedAt ? ` · resolved ${virtualDate(i.resolvedAt)}` : ""}</span>
                {i.investigationId
                  ? <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => void openInvestigation(i.investigationId!)} data-testid="open-investigation">Open investigation</button>
                  : <span className="muted small">No investigation: {i.investigationPolicy.reason}</span>}
              </div>
            ))}
          </div>
        </div>

        {bundle ? (
          <div className="card" data-testid="investigation-panel">
            <div className="card-head"><h3>{bundle.investigation.title}</h3><button className="btn sm" onClick={() => setBundle(null)}>Close</button></div>
            <div className="card-body" style={{ display: "grid", gap: 8 }}>
              <span className="small"><code>{bundle.investigation.investigationId}</code> · status {bundle.investigation.status} · opened {virtualDate(bundle.investigation.startedAt)} · {bundle.investigation.anomalyIds.length} anomalies · {bundle.metricSnapshots.length} metric snapshots · {bundle.sourceRecords.length} source records</span>
              <span className="small">Affected: {[...bundle.affected.campaigns, ...bundle.affected.products, ...bundle.affected.channels].join(", ") || "whole business"}</span>
              <span className="muted small">{bundle.note}</span>
              <table><thead><tr><th>Signal</th><th>Segment</th><th>Status</th><th>Severity</th></tr></thead>
                <tbody>{bundle.findings.map((f) => <tr key={f.findingId} title={f.reason}><td>{f.label}</td><td>{f.segmentLabel}</td><td>{f.status}</td><td>{f.severity.level} · {f.severity.score}</td></tr>)}</tbody></table>
            </div>
          </div>
        ) : null}

        <div className="card">
          <div className="card-head"><h3>Anomalies</h3><span>canonical records · click a row for the evidence-based reason</span></div>
          <div className="card-body scroll-x">
            <table data-testid="anomalies-table">
              <thead><tr><th>Metric</th><th>Segment</th><th className="num">Current</th><th className="num">Baseline</th><th className="num">Change</th><th>Severity</th><th>Status</th><th>Detected (virtual)</th></tr></thead>
              <tbody>
                {(anomalies?.items ?? []).map((a) => (
                  <Fragment key={a.anomaly.anomalyId}>
                    <tr onClick={() => setExpanded(expanded === a.anomaly.anomalyId ? null : a.anomaly.anomalyId)} style={{ cursor: "pointer" }} data-testid="anomaly-row">
                      <td>{a.finding?.label ?? a.anomaly.metric}<div className="muted small">{a.anomaly.metric}</div></td>
                      <td>{a.finding?.segmentLabel ?? "—"}</td>
                      <td className="num">{fmtValue(a.anomaly.metric, a.anomaly.actualValue)}</td>
                      <td className="num">{fmtValue(a.anomaly.metric, a.anomaly.baselineValue)}</td>
                      <td className="num">{a.anomaly.changePercent > 0 ? "+" : ""}{a.anomaly.changePercent.toFixed(1)}%</td>
                      <td><span className={`pill ${sevClass(a.anomaly.severity)}`}>{a.anomaly.severity}</span></td>
                      <td>{a.anomaly.status}</td>
                      <td>{virtualDate(a.anomaly.detectedAt)}</td>
                    </tr>
                    {expanded === a.anomaly.anomalyId ? (
                      <tr><td colSpan={8} className="small" data-testid="anomaly-reason">{a.finding?.reason} <span className="muted">Evidence: {a.anomaly.sourceSnapshotIds.length} metric snapshots.</span></td></tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {anomalies && anomalies.items.length === 0 ? <div className="empty">No anomalies recorded for this run{severity ? ` at ${severity} severity` : ""}.</div> : null}
          </div>
        </div>
        </>}
      </main>
    </>
  );
}
