"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, ExternalLink, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { money, num, pct, virtualDate } from "@/lib/format";
import { api, q } from "./api";
import { PageSkeleton } from "./PageSkeleton";
import { useRun } from "./run-context";

interface Observation {
  anomalyId: string; metric: string; direction: string; actualValue: number; baselineValue: number; changePercent: number;
  currentWindow: { startAt: string; endAt: string }; baselineWindow: { startAt: string; endAt: string };
  sourceSnapshotIds: string[]; entityKind: string | null; entityId: string | null; entityName: string; isBusinessAggregate: boolean;
}
interface Group {
  groupId: string; incidentId: string | null; incidentTitle: string | null; incidentSummary: string | null;
  investigationId: string | null; title: string; metric: string; metricLabel: string; theme: string | null; severity: string;
  severityRank: number; status: string; campaignCount: number; entityCount: number; affectedLabel: string;
  headline: Observation; timeRange: { startAt: string; endAt: string }; observations: Observation[];
}
interface SignalList { total: number; limit: number; offset: number; items: Group[] }
interface Snapshot { snapshotId: string; window: { startAt: string; endAt: string }; currency: string; counters: Record<string, number>; rates: Record<string, number | null> }
interface Detail { anomaly: Observation; snapshots: Snapshot[]; finding: { evidence: { sourceRecords: Array<{ collection: string; recordId: string; sourceUrl?: string }> } } | null }
interface InvestigationView {
  state: { status: string; stage: string } | null;
  report: { diagnosis: { summary: string }; executiveBrief: { certainty: string } } | null;
  sources: Array<{ sourceId: string; title: string; originalUrl: string; status: string }>;
}
interface EvidenceList { items: Array<{ evidence: { title: string; category: string; sourceRecords: Array<{ collection: string; recordId: string; sourceUrl?: string }> } }> }
interface IncidentView { id: string; groups: Group[]; lead: Group; observations: Observation[]; title: string; status: string; severity: string; investigationId: string | null; affectedLabel: string; period: { startAt: string; endAt: string } }

const LABELS: Record<string, string> = {
  revenue_minor: "Revenue", orders: "Orders", ctr: "Click-through rate", conversion_rate: "Conversion rate",
  cac_minor: "Cost per acquisition", late_delivery_rate: "Late delivery rate", low_rating_rate: "Low-rating share",
  checkout_failure_rate: "Checkout failure rate", coupon_failure_rate: "Promo-code failure rate", ad_spend_minor: "Ad spend",
};
const HIGHER_IS_BETTER = new Set(["revenue_minor", "orders", "ctr", "conversion_rate"]);
const LOWER_IS_BETTER = new Set(["cac_minor", "late_delivery_rate", "low_rating_rate", "checkout_failure_rate", "coupon_failure_rate"]);

function metricValue(metric: string, value: number | null | undefined, currency = "GBP") {
  if (value == null || !Number.isFinite(value)) return "—";
  if (metric.endsWith("_minor")) return money(value, currency);
  if (metric === "ctr" || metric === "conversion_rate" || metric.endsWith("_rate")) return pct(value, 2);
  return num(value);
}
function tone(metric: string, change: number): "negative" | "positive" | "neutral" {
  if (!Number.isFinite(change) || change === 0) return "neutral";
  if (HIGHER_IS_BETTER.has(metric)) return change < 0 ? "negative" : "positive";
  if (LOWER_IS_BETTER.has(metric)) return change > 0 ? "negative" : "positive";
  return "neutral";
}
function changeLabel(change: number) { return `${change > 0 ? "+" : ""}${change.toFixed(1)}%`; }
function titleFor(group: Group) { return (group.incidentTitle ?? group.title).replace(/\s+across\s+\d+\s+(?:campaigns?|entities|products?)$/i, ""); }
function overviewText(incident: IncidentView) {
  const observation = incident.lead.headline;
  const change = Math.abs(observation.changePercent).toFixed(1);
  const comparison = observation.changePercent < 0 ? "below" : "above";
  const affected = incident.affectedLabel === "Business-wide" ? "for the whole business" : `across ${incident.affectedLabel.toLowerCase()}`;
  return `${incident.lead.metricLabel} is ${change}% ${comparison} baseline ${affected}.`;
}
function eventHref(businessId: string, runId: string, eventId: string) {
  return `/api/dev/simulator/events?${q({ businessId, simulationRunId: runId, eventId })}`;
}
function mergeIncidents(groups: Group[]): IncidentView[] {
  const byId = new Map<string, Group[]>();
  for (const group of groups) {
    const id = group.incidentId ? `incident:${group.incidentId}` : `group:${group.groupId}`;
    byId.set(id, [...(byId.get(id) ?? []), group]);
  }
  return [...byId.entries()].map(([id, members]) => {
    const sorted = [...members].sort((a, b) => b.severityRank - a.severityRank || Math.abs(b.headline.changePercent) - Math.abs(a.headline.changePercent));
    const lead = sorted[0];
    const observations = [...new Map(members.flatMap((group) => group.observations).map((item) => [item.anomalyId, item])).values()];
    const campaigns = new Set(observations.filter((item) => item.entityKind === "campaign" && item.entityId).map((item) => item.entityId));
    const entities = new Set(observations.filter((item) => item.entityKind && item.entityKind !== "global" && item.entityId).map((item) => `${item.entityKind}:${item.entityId}`));
    const count = campaigns.size || entities.size;
    const kind = campaigns.size ? "campaign" : "entity";
    return {
      id, groups: members, lead, observations, title: titleFor(lead), status: lead.status, severity: lead.severity,
      investigationId: members.find((item) => item.investigationId)?.investigationId ?? null,
      affectedLabel: count ? `${count} affected ${kind}${count === 1 ? "" : "s"}` : "Business-wide",
      period: { startAt: members.map((item) => item.timeRange.startAt).sort()[0], endAt: members.map((item) => item.timeRange.endAt).sort().at(-1)! },
    };
  });
}
function snapshotValue(metric: string, snapshot: Snapshot): number | null {
  switch (metric) {
    case "revenue_minor": return snapshot.counters.revenueMinor ?? null;
    case "orders": return snapshot.counters.orders ?? null;
    case "cac_minor": return snapshot.rates.costPerAcquisitionMinor ?? null;
    case "ctr": return snapshot.rates.ctr ?? null;
    case "conversion_rate": return snapshot.rates.conversionRate ?? null;
    case "late_delivery_rate": return snapshot.rates.lateDeliveryRate ?? null;
    case "low_rating_rate": return snapshot.rates.lowRatingRate ?? null;
    case "checkout_failure_rate": return snapshot.rates.checkoutFailureRate ?? null;
    case "coupon_failure_rate": return snapshot.rates.couponFailureRate ?? null;
    case "ad_spend_minor": return snapshot.counters.adSpendMinor ?? null;
    default: return null;
  }
}
function MetricChart({ observation, snapshots }: { observation: Observation; snapshots: Snapshot[] }) {
  const points = snapshots.map((snapshot) => ({ at: Date.parse(snapshot.window.startAt), value: snapshotValue(observation.metric, snapshot), id: snapshot.snapshotId }))
    .filter((point): point is { at: number; value: number; id: string } => point.value !== null && Number.isFinite(point.at))
    .sort((a, b) => a.at - b.at);
  if (!points.length) return <p className="inbox-muted">No linked time-series snapshots are available.</p>;
  const values = [...points.map((point) => point.value), observation.baselineValue];
  const rawMin = Math.min(...values), rawMax = Math.max(...values);
  const padding = Math.max((rawMax - rawMin) * .16, Math.abs(rawMax) * .03, .001);
  const min = rawMin - padding, max = rawMax + padding;
  const first = points[0].at, last = points.at(-1)!.at, span = Math.max(last - first, 1);
  const x = (at: number) => 42 + (at - first) / span * 390;
  const y = (value: number) => 174 - (value - min) / (max - min) * 138;
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.at).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ");
  const observedTone = tone(observation.metric, observation.changePercent);
  return <div className={`inbox-chart inbox-tone-${observedTone}`}>
    <div className="inbox-chart-legend"><span><i className="inbox-legend-observed" />Observed</span><span><i className="inbox-legend-baseline" />Baseline {metricValue(observation.metric, observation.baselineValue)}</span></div>
    <svg viewBox="0 0 460 210" role="img" aria-label={`${LABELS[observation.metric] ?? observation.metric} over time, compared with baseline`}>
      {[0, 1, 2].map((line) => <line key={line} className="inbox-chart-grid" x1="42" x2="432" y1={36 + line * 69} y2={36 + line * 69} />)}
      <line className="inbox-chart-baseline" x1="42" x2="432" y1={y(observation.baselineValue)} y2={y(observation.baselineValue)} />
      <path className="inbox-chart-line" d={path} />
      {points.map((point) => <circle key={point.id} className="inbox-chart-point" cx={x(point.at)} cy={y(point.value)} r="3.5"><title>{virtualDate(new Date(point.at).toISOString())} · {metricValue(observation.metric, point.value)}</title></circle>)}
      <text x="42" y="202">{new Date(first).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</text>
      <text x="432" y="202" textAnchor="end">{new Date(last).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</text>
    </svg>
  </div>;
}

export function SignalsPage() {
  const { runId, businessId, loaded, withRun } = useRun();
  const [listState, setListState] = useState<{ key: string; data: SignalList | null; error: string | null } | null>(null);
  const [selection, setSelection] = useState<{ scope: string; id: string; observationId?: string } | null>(null);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [detailState, setDetailState] = useState<{ key: string; data: Detail | null; error: string | null } | null>(null);
  const [aiState, setAiState] = useState<{ key: string; data: InvestigationView | null } | null>(null);
  const [evidenceState, setEvidenceState] = useState<{ key: string; data: EvidenceList | null } | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scope = runId ? `${businessId}:${runId}` : "";

  useEffect(() => {
    if (!runId) return;
    let active = true;
    const load = async () => {
      const first = await api<SignalList>(`/api/signals?${q({ businessId, simulationRunId: runId, limit: 100 })}`);
      const items = [...first.items];
      while (items.length < first.total) {
        const next = await api<SignalList>(`/api/signals?${q({ businessId, simulationRunId: runId, limit: 100, offset: items.length })}`);
        if (!next.items.length) break;
        items.push(...next.items);
      }
      return { ...first, items };
    };
    void load()
      .then((data) => { if (active) setListState({ key: scope, data, error: null }); })
      .catch((error: unknown) => { if (active) setListState({ key: scope, data: null, error: error instanceof Error ? error.message : "Request failed" }); });
    return () => { active = false; };
  }, [businessId, runId, scope]);

  const list = listState?.key === scope ? listState.data : null;
  const incidents = useMemo(() => mergeIncidents(list?.items ?? []), [list]);
  const selectedId = selection?.scope === scope ? selection.id : null;
  const selected = incidents.find((item) => item.id === selectedId) ?? null;
  const focusedObservation = selected?.observations.find((item) => item.anomalyId === selection?.observationId) ?? selected?.lead.headline ?? null;
  const detailKey = selected && runId ? `${scope}:${focusedObservation!.anomalyId}` : "";
  const aiKey = selected?.investigationId && runId ? `${scope}:${selected.investigationId}` : "";

  useEffect(() => {
    if (!runId || !focusedObservation) return;
    let active = true;
    void api<Detail>(`/api/anomalies/${encodeURIComponent(focusedObservation.anomalyId)}?${q({ businessId, simulationRunId: runId })}`)
      .then((data) => { if (active) setDetailState({ key: detailKey, data, error: null }); })
      .catch((error: unknown) => { if (active) setDetailState({ key: detailKey, data: null, error: error instanceof Error ? error.message : "Request failed" }); });
    return () => { active = false; };
  }, [businessId, runId, focusedObservation, detailKey]);
  useEffect(() => {
    if (!runId || !selected?.investigationId) return;
    let active = true;
    void api<InvestigationView>(`/api/investigations/${encodeURIComponent(selected.investigationId)}/ai?${q({ businessId, simulationRunId: runId })}`)
      .then((data) => { if (active) setAiState({ key: aiKey, data }); })
      .catch(() => { if (active) setAiState({ key: aiKey, data: null }); });
    return () => { active = false; };
  }, [businessId, runId, selected?.investigationId, aiKey]);
  useEffect(() => {
    if (!runId || !selected?.investigationId) return;
    let active = true;
    void api<EvidenceList>(`/api/investigations/${encodeURIComponent(selected.investigationId)}/evidence?${q({ businessId, simulationRunId: runId, limit: 100 })}`)
      .then((data) => { if (active) setEvidenceState({ key: aiKey, data }); })
      .catch(() => { if (active) setEvidenceState({ key: aiKey, data: null }); });
    return () => { active = false; };
  }, [businessId, runId, selected?.investigationId, aiKey]);

  const close = useCallback(() => {
    setVisible(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => { setSelection(null); requestAnimationFrame(() => opener.current?.focus()); }, 260);
  }, []);
  const open = (id: string, observationId?: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setExpanded(false); setSelection({ scope, id, observationId });
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
  };
  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab" || !drawer.current) return;
      const focusable = [...drawer.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
      const first = focusable[0], last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKey); };
  }, [selected, close]);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  if (!list) return <div className="section-page">{listState?.key === scope && listState.error ? <div className="alert error">{listState.error}</div> : !loaded || runId ? <PageSkeleton variant="section" /> : <div className="section-empty">Select a simulation run to view its incidents.</div>}</div>;
  const detail = detailState?.key === detailKey ? detailState.data : null;
  const ai = aiState?.key === aiKey ? aiState.data : null;
  const evidence = evidenceState?.key === aiKey ? evidenceState.data : null;
  const relatedEvidence = evidence?.items.filter((item) => item.evidence.category === selected?.lead.theme) ?? [];
  const sourceRecords = [...relatedEvidence.flatMap((item) => item.evidence.sourceRecords.map((source) => ({ ...source, title: item.evidence.title }))),
    ...(detail?.finding?.evidence.sourceRecords ?? []).map((source) => ({ ...source, title: "Detector source" }))]
    .filter((source) => source.collection === "business_events" || Boolean(source.sourceUrl))
    .filter((source, index, rows) => rows.findIndex((row) => row.collection === source.collection && row.recordId === source.recordId) === index)
    .slice(0, 5);
  const externalSources = ai?.sources.filter((source) => source.originalUrl && /^https?:\/\//.test(source.originalUrl)) ?? [];
  const changeTone = focusedObservation ? tone(focusedObservation.metric, focusedObservation.changePercent) : "neutral";

  return <div className="section-page signal-inbox-page" data-testid="signals-page">
    <div className="inbox-content" inert={Boolean(selected)}>
      <div className="inbox-list" aria-label="Incidents">{incidents.map((incident) => {
        const headline = incident.lead.headline;
        const state = tone(headline.metric, headline.changePercent);
        const investigationHref = incident.investigationId ? withRun(`/dashboard/investigations/${encodeURIComponent(incident.investigationId)}`) : null;
        const impact = [...new Map(incident.observations.filter((item) => !item.isBusinessAggregate && item.metric === headline.metric && item.entityId)
          .map((item) => [`${item.entityKind}:${item.entityId}`, item])).values()]
          .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
        return <article className={`inbox-card inbox-tone-${state}`} key={incident.id} data-testid="signal-group">
          <div className="inbox-card-main"><div className="inbox-status"><span className="inbox-severity-icon" aria-hidden="true">{state === "positive" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}</span><span>{incident.severity} severity</span><span className="inbox-dot">·</span><span>{incident.status.replaceAll("_", " ")}</span></div>
            <h2>{incident.title}</h2><p className="inbox-affected">{incident.affectedLabel}</p></div>
          <dl className="inbox-metrics"><div><dt>Current</dt><dd>{metricValue(headline.metric, headline.actualValue)}</dd></div><div><dt>Baseline</dt><dd>{metricValue(headline.metric, headline.baselineValue)}</dd></div><div><dt>Change</dt><dd className={`inbox-change inbox-tone-${state}`}>{headline.changePercent < 0 ? <ArrowDownRight size={20} aria-hidden="true" /> : <ArrowUpRight size={20} aria-hidden="true" />}{changeLabel(headline.changePercent)}</dd></div></dl>
          {incidents.length <= 2 && impact.length >= 2 ? <section className="inbox-impact" aria-label={`${incident.lead.metricLabel} by affected entity`} data-testid="signal-impact">
            <div className="inbox-impact-head"><div><h3>{impact.every((item) => item.entityKind === "campaign") ? "Campaign impact" : "Entity impact"}</h3><p>{incident.lead.metricLabel} · largest change from baseline first</p></div><span>{impact.length} affected</span></div>
            <div className="inbox-impact-list">{impact.slice(0, 5).map((item, index) => <button className={`inbox-impact-row inbox-tone-${tone(item.metric, item.changePercent)}`} type="button" key={item.anomalyId} onClick={() => open(incident.id, item.anomalyId)} aria-label={`${item.entityName}, ${changeLabel(item.changePercent)} versus baseline. View details`} data-testid="signal-impact-row">
              <span className="inbox-impact-name">{item.entityName}</span><span className="inbox-impact-track" aria-hidden="true"><span className="inbox-impact-fill" style={{ width: `${Math.min(100, Math.abs(item.changePercent))}%`, animationDelay: `${index * 65}ms` }} /></span><strong>{changeLabel(item.changePercent)}</strong><ArrowRight size={15} aria-hidden="true" />
            </button>)}</div>
            {impact.length > 5 ? <button className="inbox-impact-more" type="button" onClick={() => open(incident.id)}>View all {impact.length} affected entities <ArrowRight size={14} /></button> : null}
          </section> : null}
          <div className="inbox-card-footer"><span><strong>{incident.lead.metricLabel}</strong><span className="inbox-footer-dot">·</span><time>{virtualDate(incident.period.startAt)} – {virtualDate(incident.period.endAt)}</time></span><div><button type="button" className="inbox-detail-button" onClick={() => open(incident.id)}>View details <ArrowRight size={15} /></button>{investigationHref ? <Link className="inbox-investigation-link signal-investigation-link" href={investigationHref} data-testid="signal-investigation-link">View investigation <ArrowUpRight size={15} /></Link> : null}</div></div>
        </article>;
      })}{incidents.length === 0 ? <div className="inbox-empty">No incidents detected for this run.</div> : null}</div>
      {list.total > list.items.length ? <p className="inbox-more">Showing {list.items.length} of {list.total} signal groups for this run.</p> : null}
    </div>
    {selected && focusedObservation ? createPortal(<div className={`normal-app inbox-overlay${visible ? " is-open" : ""}`} data-testid="signal-drawer-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="inbox-drawer" ref={drawer} role="dialog" aria-modal="true" aria-labelledby="inbox-drawer-title" data-testid="signal-drawer">
        <header className="inbox-drawer-head"><div><span className="inbox-eyebrow">INCIDENT DETAILS</span><h2 id="inbox-drawer-title">{selected.title}</h2></div><button ref={closeButton} className="inbox-close" type="button" onClick={close} aria-label="Close details"><X size={20} /></button></header>
        <div className="inbox-drawer-scroll">
          <div className={`inbox-drawer-status inbox-tone-${changeTone}`}><span className="inbox-severity-icon"><AlertCircle size={18} /></span><strong>{selected.severity} severity</strong><span>{selected.status.replaceAll("_", " ")}</span></div>
          <p className="inbox-summary">{overviewText(selected)}</p>
          <div className="inbox-drawer-period"><span>Detected period</span><strong>{virtualDate(selected.period.startAt)} – {virtualDate(selected.period.endAt)}</strong></div>
          <section className="inbox-drawer-section"><div className="inbox-section-heading"><h3>{LABELS[focusedObservation.metric] ?? selected.lead.metricLabel}</h3><span>{focusedObservation.isBusinessAggregate ? "Whole business" : focusedObservation.entityName}</span></div><dl className="inbox-drawer-metrics"><div><dt>Current</dt><dd>{metricValue(focusedObservation.metric, focusedObservation.actualValue)}</dd></div><div><dt>Baseline</dt><dd>{metricValue(focusedObservation.metric, focusedObservation.baselineValue)}</dd></div><div><dt>Change</dt><dd className={`inbox-tone-${changeTone}`}>{changeLabel(focusedObservation.changePercent)}</dd></div></dl></section>
          <section className="inbox-drawer-section"><div className="inbox-section-heading"><h3>Trend</h3><span>Linked source snapshots</span></div><div className="inbox-chart-frame">{detail ? <MetricChart observation={focusedObservation} snapshots={detail.snapshots} /> : detailState?.key === detailKey && detailState.error ? <p className="inbox-muted">{detailState.error}</p> : <p className="inbox-muted">Loading trend…</p>}</div></section>
          <section className="inbox-drawer-section"><div className="inbox-section-heading"><h3>Affected {selected.affectedLabel === "Business-wide" ? "scope" : "campaigns and entities"}</h3><span>{selected.affectedLabel}</span></div><div className="inbox-entity-list">{selected.observations.filter((item) => !item.isBusinessAggregate).slice(0, expanded ? undefined : 4).map((item) => <div className="inbox-entity" key={item.anomalyId} data-testid="signal-observation"><strong>{item.entityName}</strong><span>{LABELS[item.metric] ?? item.metric}</span><em className={`inbox-tone-${tone(item.metric, item.changePercent)}`}>{changeLabel(item.changePercent)}</em></div>)}{selected.observations.every((item) => item.isBusinessAggregate) ? <p className="inbox-muted">Whole business</p> : null}</div>{selected.observations.filter((item) => !item.isBusinessAggregate).length > 4 ? <button className="inbox-expand" type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "Show fewer" : `Show all ${selected.observations.filter((item) => !item.isBusinessAggregate).length} observations`}</button> : null}</section>
          <section className="inbox-drawer-section"><div className="inbox-section-heading"><h3>Evidence</h3><span>Linked to source records</span></div>{sourceRecords.length || externalSources.length ? <ul className="inbox-evidence">{sourceRecords.map((source) => {
            const entity = selected.observations.find((item) => item.entityId && source.recordId.includes(item.entityId));
            return <li key={`${source.collection}:${source.recordId}`}><span title={source.title}>{entity?.entityName ?? source.title}</span>{source.collection === "business_events" && runId ? <a href={eventHref(businessId, runId, source.recordId)} target="_blank" rel="noopener noreferrer">Open source <ExternalLink size={14} /></a> : source.sourceUrl && /^https?:\/\//.test(source.sourceUrl) ? <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">Open source <ExternalLink size={14} /></a> : <small>Linked record</small>}</li>;
          })}{externalSources.slice(0, 3).map((source) => <li key={source.sourceId}><span>{source.title}</span><a href={source.originalUrl} target="_blank" rel="noopener noreferrer">Open source <ExternalLink size={14} /></a></li>)}</ul> : <p className="inbox-muted">{evidence || detail ? "No source links are available for this incident yet." : "Loading linked evidence…"}</p>}</section>
          {ai?.report?.diagnosis.summary ? <section className="inbox-drawer-section"><div className="inbox-section-heading"><h3>Investigator summary</h3><span>Saved diagnosis</span></div><p className="inbox-diagnosis">{ai.report.diagnosis.summary}</p>{ai.report.executiveBrief.certainty ? <p className="inbox-certainty">{ai.report.executiveBrief.certainty}</p> : null}</section> : ai?.state ? <section className="inbox-drawer-section"><div className="inbox-section-heading"><h3>Investigation progress</h3><span>{ai.state.status.replaceAll("_", " ")}</span></div><p className="inbox-muted">{ai.state.stage.replaceAll("_", " ")}</p></section> : null}
        </div>
        {selected.investigationId ? <footer className="inbox-drawer-foot"><Link href={withRun(`/dashboard/investigations/${encodeURIComponent(selected.investigationId)}`)}>Open full investigation <ArrowUpRight size={17} /></Link></footer> : null}
      </section>
    </div>, document.body) : null}
  </div>;
}
