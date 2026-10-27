"use client";

import { num,virtualDate } from "@/lib/format";
import { ArrowUpRight, Filter, Search } from "lucide-react";
import Link from "next/link";
import { useEffect,useState } from "react";
import { api,q,type Capabilities,type InvestigationRow,type MonitorStatus } from "./api";
import { PageSkeleton } from "./PageSkeleton";
import { useRun } from "./run-context";

interface Resource<T> { path: string; data: T | null; error: string | null }

function useScopedResource<T>(makePath: (runId: string) => string) {
  const { runId, loaded, withRun } = useRun();
  const path = runId ? makePath(runId) : null;
  const [resource, setResource] = useState<Resource<T> | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void api<T>(path).then((data) => {
      if (!cancelled) setResource({ path, data, error: null });
    }).catch((error: unknown) => {
      if (!cancelled) setResource({ path, data: null, error: error instanceof Error ? error.message : "Request failed" });
    });
    return () => { cancelled = true; };
  }, [path]);
  const current = resource?.path === path ? resource : null;
  return { runId, loaded, withRun, data: current?.data ?? null, error: current?.error ?? null };
}

function ResourceState({ loaded, runId, error }: { loaded: boolean; runId: string | null; error: string | null }) {
  if (error) return <div className="alert error">{error}</div>;
  if (!loaded) return <PageSkeleton variant="section" />;
  if (!runId) return <div className="section-empty">Select a simulation run to view its records.</div>;
  return <PageSkeleton variant="section" />;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <article className="card section-stat"><small>{label}</small><strong>{value}</strong></article>;
}

interface InvestigationList { total: number; items: InvestigationRow[] }

export function InvestigationIndex() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { runId, loaded, withRun, data, error } = useScopedResource<InvestigationList>((id) => `/api/investigations?${q({ simulationRunId: id, limit: 50 })}`);
  if (!data) return <div className="section-page"><ResourceState loaded={loaded} runId={runId} error={error} /></div>;
  const filtered = data.items.filter(({ investigation, incident }) => {
    const search = query.trim().toLowerCase();
    const matchesQuery = !search || [investigation.title, investigation.investigationId, incident?.primaryTheme ?? ""].some((value) => value.toLowerCase().includes(search));
    const matchesStatus = statusFilter === "all" || investigation.status === statusFilter;
    return matchesQuery && matchesStatus;
  });
  const statuses = [...new Set(data.items.map(({ investigation }) => investigation.status))].sort();
  return <section className="card record-index" data-testid="investigations-page" aria-label="Investigations">
    <header className="record-index-head"><div><h2>Investigations</h2><p>Review the incident, evidence and decisions behind each case.</p></div><span className="record-index-count">{data.total} {data.total === 1 ? "record" : "records"}</span></header>
    {data.items.length > 4 ? <div className="record-index-filters"><label className="record-filter"><Search size={16} aria-hidden="true" /><span className="sr-only">Search investigations</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search investigations" /></label><label className="record-filter"><Filter size={15} aria-hidden="true" /><span className="sr-only">Filter investigations by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{statuses.map((status) => <option value={status} key={status}>{status.replaceAll("_", " ")}</option>)}</select></label></div> : null}
    {data.items.length ? <div className="record-table-scroll"><table className="record-table"><thead><tr><th>Investigation</th><th>Severity</th><th>Status</th><th>Signals</th><th>Evidence</th><th>Updated</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{filtered.map(({ investigation, incident }) => <tr key={investigation.investigationId}><td><strong>{investigation.title}</strong><small>{incident?.primaryTheme?.replaceAll("_", " ") || "Business investigation"}</small></td><td><span className={`record-badge severity-${incident?.severity.level ?? "unknown"}`}>{incident?.severity.level ?? "Unknown"}</span></td><td><span className="record-badge status">{investigation.status.replaceAll("_", " ")}</span></td><td className="record-number">{investigation.anomalyIds.length}</td><td className="record-number">{investigation.evidenceIds.length}</td><td className="record-date">{virtualDate(investigation.updatedAt)}</td><td><Link className="record-open" href={withRun(`/dashboard/investigations/${encodeURIComponent(investigation.investigationId)}`)} aria-label={`Open ${investigation.title}`}><ArrowUpRight size={18} aria-hidden="true" /></Link></td></tr>)}</tbody></table>{filtered.length === 0 ? <div className="record-empty">No investigations match these filters.</div> : null}</div> : <div className="record-empty">No investigations in this run yet.</div>}
  </section>;
}

export { Approvals as ApprovalsPage } from "./Approvals";

export {OutcomesPage} from './OutcomesDashboard';

interface MonitoringData { monitor: MonitorStatus; capabilities: Capabilities }

export function MonitoringPage() {
  const { runId, loaded, withRun } = useRun();
  const [resource, setResource] = useState<{ runId: string; data: MonitoringData | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const query = q({ simulationRunId: runId });
    void Promise.all([api<MonitorStatus>(`/api/dev/monitor/run?${query}`), api<Capabilities>(`/api/intelligence/capabilities?${query}`)])
      .then(([monitor, capabilities]) => { if (!cancelled) setResource({ runId, data: { monitor, capabilities }, error: null }); })
      .catch((error: unknown) => { if (!cancelled) setResource({ runId, data: null, error: error instanceof Error ? error.message : "Request failed" }); });
    return () => { cancelled = true; };
  }, [runId]);
  const current = resource?.runId === runId ? resource : null;
  const data = current?.data ?? null;
  if (!data) return <div className="section-page"><ResourceState loaded={loaded} runId={runId} error={current?.error ?? null} /></div>;
  const observe = data.capabilities.stages.find((stage) => stage.id === "observe");
  const monitor = data.monitor;
  return <div className="section-page" data-testid="monitoring-page">
    <p className="section-intro">Scheduled monitor status and worker health for the currently selected simulation.</p>
    <div className="section-stats"><Stat label="Last scan" value={monitor.lastAsOf ? virtualDate(monitor.lastAsOf) : "Not recorded"} /><Stat label="Direct trigger" value={monitor.methodA?.enabled ? "Enabled" : "Disabled"} /><Stat label="Change stream" value={monitor.worker?.connected ? "Connected" : "Not confirmed"} /><Stat label="Persisted snapshots" value={num(Number(observe?.metrics.snapshots ?? 0))} /></div>
    <article className="card section-card"><div className="section-card-head"><h2>Worker and scan health</h2></div><dl className="outcome-rates"><div><dt>Worker heartbeat</dt><dd>{monitor.worker?.lastHeartbeatAt ? virtualDate(monitor.worker.lastHeartbeatAt) : "No heartbeat recorded"}</dd></div><div><dt>Jobs pending</dt><dd>{monitor.jobs?.pending ?? 0}</dd></div><div><dt>Jobs running</dt><dd>{monitor.jobs?.running ?? 0}</dd></div><div><dt>Jobs completed</dt><dd>{monitor.jobs?.completed ?? 0}</dd></div><div><dt>Jobs failed</dt><dd>{monitor.jobs?.failed ?? 0}</dd></div><div><dt>Events observed</dt><dd>{num(Number(observe?.metrics.events ?? 0))}</dd></div></dl>
      {monitor.failedJobs?.length ? <div className="monitor-failures">{monitor.failedJobs.map((job) => <p key={job.jobKey}>Attempt {job.attempts} · {job.jobKey}: {job.lastError}</p>)}</div> : null}
      <div className="section-links"><Link className="btn primary" href={withRun("/dev/monitor")}>Open anomaly monitor</Link><Link className="btn" href={withRun("/dashboard/architecture")}>View pipeline readiness</Link></div>
    </article>
  </div>;
}
