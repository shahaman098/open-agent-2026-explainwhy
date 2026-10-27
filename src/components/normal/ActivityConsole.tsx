"use client";

import { Activity, ArrowUpRight, Bot, Check, ChevronDown, CircleAlert, Clock3, Filter, Radar, Search, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, q } from "./api";
import { PageSkeleton } from "./PageSkeleton";
import { useRun } from "./run-context";

type Kind = "monitoring" | "incident" | "tool" | "agent" | "decision" | "business";
interface ActivityItem { id: string; at: string; clock: "recorded" | "simulation"; kind: Kind; source: string; title: string; detail: string; status: string; href: string | null }
interface ActivityResponse { businessId: string; simulationRunId: string; items: ActivityItem[]; generatedAt: string }
const GROUPS = [
  { id: "all", label: "All activity" },
  { id: "agent", label: "Agents & tools" },
  { id: "monitor", label: "Monitoring" },
  { id: "business", label: "Business data" },
] as const;
const ACTIVE = new Set(["running", "queued", "pending", "collecting_evidence", "investigating", "open", "awaiting_review", "awaiting_approval"]);
const FAILED = new Set(["failed", "rejected", "needs_review"]);
const DONE = new Set(["completed", "succeeded", "approved", "verified", "submitted"]);
const statusTone = (status: string) => FAILED.has(status) ? "error" : DONE.has(status) ? "success" : ACTIVE.has(status) ? "active" : "neutral";
const statusLabel = (status: string) => status.replaceAll("_", " ");
const timeLabel = (at: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(at));
const kindIcon: Record<Kind, typeof Activity> = { monitoring: Radar, incident: CircleAlert, tool: Wrench, agent: Bot, decision: Check, business: Activity };

export function ActivityConsole() {
  const { businessId, runId, loaded, withRun } = useRun();
  const [resource, setResource] = useState<{ runId: string; data: ActivityResponse | null; error: string | null } | null>(null);
  const [group, setGroup] = useState<(typeof GROUPS)[number]["id"]>("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(80);

  useEffect(() => {
    if (!runId) return;
    let live = true;
    const currentRun = runId;
    const refresh = async () => {
      try {
        const data = await api<ActivityResponse>(`/api/activity?${q({ businessId, simulationRunId: currentRun })}`);
        if (live) setResource({ runId: currentRun, data, error: null });
      } catch (error) {
        if (live) setResource((previous) => ({ runId: currentRun, data: previous?.runId === currentRun ? previous.data : null, error: error instanceof Error ? error.message : "Activity could not be loaded." }));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [businessId, runId]);

  const data = resource?.runId === runId ? resource.data : null;
  const error = resource?.runId === runId ? resource.error : null;
  const statuses = useMemo(() => [...new Set((data?.items ?? []).map((item) => item.status))].sort(), [data]);
  const visible = useMemo(() => (data?.items ?? []).filter((item) => {
    const matchesGroup = group === "all" || (group === "agent" && (item.kind === "agent" || item.kind === "tool" || item.kind === "decision")) || (group === "monitor" && (item.kind === "monitoring" || item.kind === "incident")) || (group === "business" && item.kind === "business");
    const search = query.trim().toLowerCase();
    return matchesGroup && (status === "all" || item.status === status) && (!search || `${item.title} ${item.detail} ${item.source} ${item.status}`.toLowerCase().includes(search));
  }), [data, group, status, query]);

  if (!loaded) return <PageSkeleton variant="section" />;
  if (!runId) return <div className="activity-empty">Select a run to view its activity.</div>;
  return <section className="card activity-console" data-testid="activity-page" aria-label="Activity stream">
    <div className="activity-console-head">
      <div className="activity-console-title"><div><h2>Activity stream</h2><p>What Normal observed and did in this run.</p></div></div>
      <span className="activity-live"><i aria-hidden="true" /> Updates every 15s</span>
    </div>
    <div className="activity-run-strip"><span className="activity-prompt">normal<span className="activity-prompt-slash">/</span>activity</span><span className="activity-run-value">{runId}</span><span className="activity-strip-count">{data ? `${data.items.length} entries` : "Loading"}</span></div>
    <div className="activity-controls">
      <div className="activity-group-filters" role="group" aria-label="Activity type">{GROUPS.map((option) => <button type="button" key={option.id} className={group === option.id ? "selected" : ""} aria-pressed={group === option.id} onClick={() => { setGroup(option.id); setShown(80); }}>{option.label}</button>)}</div>
      <div className="activity-utility-filters">
        <label className="activity-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search activity</span><input value={query} onChange={(event) => { setQuery(event.target.value); setShown(80); }} placeholder="Search activity" /></label>
        <label className="activity-status-filter"><Filter size={14} aria-hidden="true" /><span className="sr-only">Filter by status</span><select value={status} onChange={(event) => { setStatus(event.target.value); setShown(80); }}><option value="all">Any status</option>{statuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select><ChevronDown size={13} aria-hidden="true" /></label>
      </div>
    </div>
    {error ? <div className="activity-error" role="alert">{error}{data ? " Showing the last loaded activity." : ""}</div> : null}
    {!data ? <div className="activity-loading"><PageSkeleton variant="section" /></div> : <>
      <div className="activity-table-head"><span>Time <small>UTC</small></span><span>Source</span><span>Event</span><span>Status</span><span className="sr-only">Open record</span></div>
      {visible.length ? <div className="activity-table" role="table" aria-label="Run activity"><div className="sr-only" role="rowgroup"><div role="row"><span role="columnheader">Time</span><span role="columnheader">Source</span><span role="columnheader">Event</span><span role="columnheader">Status</span></div></div><div role="rowgroup">{visible.slice(0, shown).map((item) => {
        const Icon = kindIcon[item.kind];
        return <div className="activity-row" role="row" key={item.id} data-kind={item.kind}>
          <div className="activity-when" role="cell"><time dateTime={item.at}>{timeLabel(item.at)}</time><span className="activity-clock"><Clock3 size={11} aria-hidden="true" /> {item.clock === "simulation" ? "Simulation" : "Recorded"}</span></div>
          <div className="activity-source" role="cell"><span className={`activity-source-icon kind-${item.kind}`}><Icon size={15} strokeWidth={1.8} aria-hidden="true" /></span><span>{item.source}</span></div>
          <div className="activity-event" role="cell"><strong>{item.title}</strong><span>{item.detail}</span></div>
          <div role="cell"><span className={`activity-status tone-${statusTone(item.status)}`}><i aria-hidden="true" />{statusLabel(item.status)}</span></div>
          <div className="activity-link-cell" role="cell">{item.href ? <Link href={withRun(item.href)} aria-label={`Open ${item.title}`} title="Open record"><ArrowUpRight size={17} aria-hidden="true" /></Link> : null}</div>
        </div>;
      })}</div></div> : <div className="activity-empty">No activity matches these filters.</div>}
      <div className="activity-table-foot"><span>{visible.length} matching entries{group === "business" || group === "all" ? " · business events are grouped by type" : ""}</span>{visible.length > shown ? <button type="button" onClick={() => setShown((count) => count + 80)}>Show more activity</button> : null}</div>
    </>}
  </section>;
}
