"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { money, moneyCompact, num, virtualDate } from "@/lib/format";
import { api, q, type AnomalyRow, type IncidentRow, type InvestigationRow, type MonitorStatus } from "./api";
import { useRun } from "./run-context";
import { PageSkeleton } from "./PageSkeleton";

interface Campaign {
  campaignId: string; name: string; platform: string;
  status: string; targetCategory: string; dailyBudgetMinor: number;
  totals: { impressions: number; clicks: number; spendMinor: number; sessions: number; attributedOrders: number; attributedRevenueMinor: number };
}
interface RunState {
  run: { simulationRunId: string; seed: number; status: string; virtualTime: string; activeScenario: string; scenarioSeverity: number };
  tickIndex: number; totals?: Record<string, number>; locked: boolean; isActiveRun: boolean; campaigns: Campaign[];
}
interface Snapshot {
  window: { startAt: string; endAt: string };
  counters: { revenueMinor: number; orders: number; sessions: number; adSpendMinor: number; delayedShipments: number; shipments: number; reviews: number; lowRatingReviews: number };
  rates: { conversionRate: number | null; ctr: number | null; lateDeliveryRate: number | null; lowRatingRate: number | null; costPerAcquisitionMinor: number | null };
}
interface CampaignMetric { campaignId: string; impressions: number; clicks: number; spendMinor: number; attributedOrders: number; attributedRevenueMinor: number; ctr: number | null; costPerAcquisitionMinor: number | null; roas: number | null; averageFrequency: number | null }
interface Breakdown { window: { startAt: string; endAt: string }; total: Snapshot | null; daily: Snapshot[]; campaigns: CampaignMetric[] }
interface Data { state: RunState; breakdown: Breakdown; monitor: MonitorStatus; incidents: IncidentRow[]; anomalies: { total: number; items: AnomalyRow[] }; investigations: { total: number; items: InvestigationRow[] } }
interface Signal { id: string; title: string; detail: string; level: "high" | "medium"; evidence: string; href?: string; testId?: string }

function Trend({ direction, color = "green", size = 16 }: { direction: "up" | "down" | "flat"; color?: "green" | "red"; size?: number }) {
  if (direction === "flat") return null;
  const file = color === "green" ? "be5fa.svg" : "eb6cd.svg";
  return <Image className={`trend${direction === "down" ? " down" : ""}`} style={{ width: size, height: size }} src={`/assets/${file}`} width={size} height={size} alt="" />;
}

function Gauge({ score }: { score: number | null }) {
  const angle = score === null ? -90 : (Math.max(0, Math.min(100, score)) / 100) * 180 - 90;
  return (
    <div className={`gauge${score === null ? " empty" : ""}`}>
      <svg viewBox="0 0 419 225" role="img" aria-label={score === null ? "No active incident risk score" : `Highest active incident severity ${score} out of 100`}>
        <path d="M12 209.5C5.37258 209.5 -0.0358813 204.123 0.337603 197.506C3.66601 138.538 31.3821 86.0897 73.5604 50.0875C110.15 18.8557 157.623 0 209.5 0C261.377 0 308.85 18.8557 345.44 50.0875C387.618 86.0897 415.334 138.538 418.662 197.506C419.036 204.123 413.627 209.5 407 209.5H209.5H12Z" fill="#60CA27" />
        <path d="M407 209.5H209.5L73.5604 50.0875C110.15 18.8557 157.623 0 209.5 0C261.377 0 308.85 18.8557 345.44 50.0875C387.618 86.0897 415.334 138.538 418.662 197.506C419.036 204.123 413.627 209.5 407 209.5Z" fill="#FFC44D" />
        <path d="M407 209.5H209.5L345.44 50.0874C387.618 86.0897 415.334 138.538 418.662 197.506C419.036 204.123 413.627 209.5 407 209.5Z" fill="#EF4545" />
        <g transform={`rotate(${angle} 209.5 201.85)`}><path d="M 199 201.85 L 207 131 C 207.8 127.5 211.2 127.5 212 131 L 220 201.85 Z" fill="#000" stroke="#000" strokeWidth="1" strokeLinejoin="round" strokeLinecap="round" /></g>
        <circle cx="209.5" cy="201.85" r="22.95" fill="#000" />
      </svg>
      <strong>{score ?? "—"}</strong>
    </div>
  );
}

function SignalRow({ signal, withRun, direction }: { signal: Signal; withRun: (href: string) => string; direction: "next" | "previous" }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`signal-item signal-carousel-enter-${direction}`} data-testid={signal.testId}>
      <div className="signal-row">
        <Trend direction="down" color={signal.level === "high" ? "red" : "green"} size={20} />
        <div className="signal-text"><span className="signal-title">{signal.title}</span><span className="signal-detail">{signal.detail}</span></div>
        {signal.href ? <Link className="investigate" href={withRun(signal.href)}>View investigation</Link> : <span className="signal-observation">Observed</span>}
        <button className="help" aria-expanded={open} aria-controls={`signal-evidence-${signal.id}`} aria-label={`${open ? "Hide" : "Show"} details for ${signal.title}`} onClick={() => setOpen((value) => !value)}>?</button>
      </div>
      {open ? <p className="evidence" id={`signal-evidence-${signal.id}`} role="note">{signal.evidence}</p> : null}
    </li>
  );
}

function SignalCarousel({ signals, withRun }: { signals: Signal[]; withRun: (href: string) => string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState<"next" | "previous">("next");
  const [slideRevision, setSlideRevision] = useState(0);
  if (signals.length === 0) return <p className="panel-note">No incident or anomaly signals are recorded for this run.</p>;

  const index = activeIndex % signals.length;
  const changeSignal = (step: -1 | 1) => {
    setDirection(step > 0 ? "next" : "previous");
    setActiveIndex((current) => (Math.min(current, signals.length - 1) + step + signals.length) % signals.length);
    setSlideRevision((current) => current + 1);
  };

  return (
    <div className="signal-carousel" role="group" aria-roledescription="carousel" aria-label="Recent signals">
      <button className="signal-carousel-arrow" type="button" onClick={() => changeSignal(-1)} disabled={signals.length < 2} aria-label="Previous signal">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4.5-5 5.5 5 5.5" /></svg>
      </button>
      <div className="signal-carousel-content">
        <ul className="signal-carousel-stage" aria-live="polite">
          <SignalRow key={`${signals[index].id}-${slideRevision}`} signal={signals[index]} withRun={withRun} direction={direction} />
        </ul>
        <span className="signal-carousel-count">{index + 1} / {signals.length}</span>
      </div>
      <button className="signal-carousel-arrow" type="button" onClick={() => changeSignal(1)} disabled={signals.length < 2} aria-label="Next signal">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.5 5 5.5-5 5.5" /></svg>
      </button>
    </div>
  );
}

function CampaignCarousel({ campaigns, metrics, withRun }: { campaigns: Campaign[]; metrics: CampaignMetric[]; withRun: (href: string) => string }) {
  const [activeCampaign, setActiveCampaign] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  if (campaigns.length === 0) return <article className="card campaign-card" data-testid="campaign-carousel"><div className="campaign-head"><h2>Current Campaigns</h2></div><div className="campaign-empty">No campaign records exist in this run.</div></article>;
  const index = Math.min(activeCampaign, campaigns.length - 1);
  const changeCampaign = (step: number) => {
    const next = (index + step + campaigns.length) % campaigns.length;
    setActiveCampaign(next);
    trackRef.current?.children.item(next)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const images = ["nike-run-city.jpg", "nike-run-motion.jpg", "nike-run-street.jpg"];
  return (
    <article className="card campaign-card" aria-roledescription="carousel" aria-label="Current Campaigns" data-testid="campaign-carousel">
      <div className="campaign-head"><h2>Current Campaigns</h2><span className="campaign-run-count">{campaigns.filter((campaign) => campaign.status === "active").length} active · {campaigns.filter((campaign) => campaign.status !== "active").length} paused</span>
        <div className="campaign-controls"><span>{index + 1} / {campaigns.length}</span><button onClick={() => changeCampaign(-1)} aria-label="Previous campaign"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4.5-5 5.5 5 5.5" /></svg></button><button onClick={() => changeCampaign(1)} aria-label="Next campaign"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.5 5 5.5-5 5.5" /></svg></button></div>
      </div>
      <div className="campaign-track" ref={trackRef} role="region" aria-label="Campaign list" tabIndex={0}>{campaigns.map((campaign, campaignIndex) => {
        const metric = metrics.find((item) => item.campaignId === campaign.campaignId);
        const targetCategory = campaign.targetCategory || "All categories";
        const platformLabel = campaign.platform === "meta_ads" ? "Meta" : campaign.platform === "google_ads" ? "Google" : "Ads";
        return <Link className={`campaign-slide${campaignIndex === index ? " active" : ""}`} key={campaign.campaignId} href={withRun(`/dashboard/campaigns/${encodeURIComponent(campaign.campaignId)}`)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${campaign.name || campaign.campaignId} in Meta Ads Manager in a new tab`} onMouseEnter={() => setActiveCampaign(campaignIndex)}>
          <Image src={`/assets/${images[campaignIndex % images.length]}`} alt="" fill sizes="(max-width: 650px) 82vw, (max-width: 880px) 35vw, (max-width: 1600px) 25vw, 440px" />
          <span className="campaign-shade" />
          <span className="campaign-status">{campaign.status === "active" ? "Live" : "Paused"}</span>
          <span className="campaign-copy"><small>{platformLabel} · {targetCategory}</small><strong>{campaign.name || campaign.campaignId}</strong><span className="campaign-facts"><span>Budget {money(campaign.dailyBudgetMinor)}/day</span>{metric ? <><span>30d spend {money(metric.spendMinor)}</span><span>{num(metric.attributedOrders)} attributed orders</span></> : <span>No delivery data yet</span>}</span></span>
          <span className="campaign-open-label">Open campaign →</span>
        </Link>;
      })}</div>
    </article>
  );
}

function RevenueTrend({ daily, total }: { daily: Snapshot[]; total: Snapshot | null }) {
  const [period, setPeriod] = useState<"Days" | "Week" | "Month">("Month");
  const sorted = [...daily].sort((a, b) => a.window.startAt.localeCompare(b.window.startAt));
  const count = period === "Days" ? 1 : period === "Week" ? 7 : 30;
  const series = sorted.slice(-count);
  const revenue = series.length ? series.reduce((sum, item) => sum + item.counters.revenueMinor, 0) : total?.counters.revenueMinor ?? 0;
  const previousSeries = sorted.slice(-count * 2, -count);
  const previous = previousSeries.reduce((sum, item) => sum + item.counters.revenueMinor, 0);
  const change = previousSeries.length === count && previous > 0 ? ((revenue - previous) / previous) * 100 : null;
  const max = Math.max(0, ...series.map((item) => item.counters.revenueMinor));
  const rawStep = max > 0 ? max / 4 : 100;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalizedStep = rawStep / magnitude;
  const niceFactor = normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 2.5 ? 2.5 : normalizedStep <= 5 ? 5 : 10;
  const step = niceFactor * magnitude;
  const axisMax = Math.max(step, Math.ceil(max / step) * step);
  const axisTicks = [4, 3, 2, 1, 0].map((part) => axisMax * part / 4);
  return (
    <article className="card revenue-card" data-testid="revenue-trend">
      <div className="card-heading"><h2>Revenue Trend</h2><div className="periods">{(["Days", "Week", "Month"] as const).map((item) => <button key={item} className={period === item ? "selected" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
      <div className="revenue-total"><small className="eyebrow">Revenue · Selected period</small><div className="revenue-line"><strong>{money(revenue)}</strong>{change !== null ? <span>{change >= 0 ? "+" : ""}{change.toFixed(1)}% <Trend direction={change >= 0 ? "up" : "down"} /></span> : null}</div><p>{change !== null ? "Compared with the previous full period" : `${series.length} persisted daily snapshots · previous full period unavailable`}</p></div>
      {series.length ? <div className="chart" role="img" aria-label={`${period} revenue from persisted daily snapshots, vertical scale from zero to ${money(axisMax)}`}><div className="axis">{axisTicks.map((tick) => <span key={tick}>{moneyCompact(tick)}</span>)}</div><div className="bars">{series.map((item, index) => <div className="bar-slot" key={item.window.startAt} title={`${virtualDate(item.window.startAt)}: ${money(item.counters.revenueMinor)}`}><div className="bar-plot"><div className="bar" style={{ height: `${item.counters.revenueMinor > 0 ? Math.max(1, item.counters.revenueMinor / axisMax * 100) : 0}%`, background: ["#5b8a42", "#84c263", "#668356", "#a5df86"][index % 4] }} /></div><span>{new Date(item.window.startAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></div>)}</div></div> : <div className="campaign-empty">No daily metric snapshots are available for this run yet.</div>}
    </article>
  );
}

export function OperationsOverview() {
  const { runId, withRun, loaded } = useRun();
  const [riskOpen, setRiskOpen] = useState(false);
  const [result, setResult] = useState<{ runId: string; data: Data | null; error: string | null } | null>(null);
  const selected = useRef<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async (id: string) => {
    const sequence = ++requestSequence.current;
    try {
      const run = q({ simulationRunId: id });
      const [state, breakdown, monitor, incidents, anomalies, investigations] = await Promise.all([
        api<RunState>(`/api/dev/simulator/state?${run}`), api<Breakdown>(`/api/metrics/breakdown?${run}&days=30`), api<MonitorStatus>(`/api/dev/monitor/run?${run}`),
        api<{ items: IncidentRow[] }>(`/api/incidents?${run}&limit=10`), api<{ total: number; items: AnomalyRow[] }>(`/api/anomalies?${run}&limit=8`),
        api<{ total: number; items: InvestigationRow[] }>(`/api/investigations?${run}&limit=8`),
      ]);
      if (selected.current !== id || requestSequence.current !== sequence) return;
      setResult({ runId: id, data: { state, breakdown, monitor, incidents: incidents.items, anomalies, investigations }, error: null });
    } catch (e) { if (selected.current === id && requestSequence.current === sequence) setResult({ runId: id, data: null, error: (e as Error).message }); }
  }, []);
  useLayoutEffect(() => { selected.current = runId; requestSequence.current++; }, [runId]);
  useEffect(() => { if (!runId) return; void (async () => { await load(runId); })(); }, [runId, load]);
  useEffect(() => { if (!runId) return; const timer = setInterval(() => void load(runId), 10_000); return () => clearInterval(timer); }, [runId, load]);

  if (loaded && !runId) return <div className="empty" data-testid="overview-empty">No simulation runs exist yet. Create one in the <Link href="/dev/simulator">control room</Link>.</div>;
  const current = result && result.runId === runId ? result : null;
  if (current?.error) return <div className="alert error" data-testid="overview-error">{current.error}</div>;
  if (!current?.data) return <PageSkeleton variant="overview" label="Loading operations overview" />;

  const { state, breakdown, monitor, incidents, anomalies, investigations } = current.data;
  const total = breakdown.total;
  const activeIncidents = incidents.filter((incident) => incident.status === "monitoring" || incident.status === "investigating");
  const riskScore = activeIncidents.length ? Math.max(...activeIncidents.map((incident) => incident.severity.score)) : null;
  const sortedDaily = [...(breakdown.daily ?? [])].sort((a, b) => a.window.startAt.localeCompare(b.window.startAt));
  const latest = sortedDaily.at(-1) ?? null;
  const previous = sortedDaily.at(-2) ?? null;
  const trendFor = (current: number | null | undefined, before: number | null | undefined): "up" | "down" | "flat" => current == null || before == null || before === 0 ? "flat" : current > before ? "up" : current < before ? "down" : "flat";
  const signalRows: Signal[] = [
    ...incidents.map((incident) => ({ id: incident.incidentId, title: incident.title, detail: `${incident.severity.level} impact · score ${incident.severity.score} · ${incident.status.replaceAll("_", " ")}`, level: incident.severity.level === "critical" || incident.severity.level === "high" ? "high" as const : "medium" as const, evidence: `${incident.summary} This incident is a persisted observation, not a diagnosis.`, ...(incident.investigationId ? { href: `/dashboard/investigations/${encodeURIComponent(incident.investigationId)}` } : {}), testId: "overview-incident" })),
    ...anomalies.items.map(({ anomaly, finding }) => ({ id: anomaly.anomalyId, title: finding?.label ?? anomaly.metric.replaceAll("_", " "), detail: `${anomaly.severity} · ${anomaly.changePercent > 0 ? "+" : ""}${anomaly.changePercent.toFixed(1)}% vs baseline`, level: anomaly.severity === "critical" || anomaly.severity === "high" ? "high" as const : "medium" as const, evidence: `Observed ${anomaly.actualValue.toFixed(2)} against baseline ${anomaly.baselineValue.toFixed(2)} in the detected window. This is an anomaly observation, not a diagnosis.`, testId: "overview-anomaly-signal" })),
  ];
  const activity = [
    { title: "Monitoring completed", detail: monitor.lastAsOf ? `Business metrics evaluated through ${virtualDate(monitor.lastAsOf)}` : "No completed monitoring scan recorded for this run." },
    { title: "Anomalies detected", detail: `${anomalies.total} signals grouped into ${incidents.length} persisted incidents` },
    { title: "Evidence available", detail: `${investigations.total} investigations · ${investigations.items.reduce((count, item) => count + item.investigation.evidenceIds.length, 0)} evidence links` },
    { title: "AI diagnosis", detail: investigations.items.some((item) => item.investigation.diagnosisId) ? `${investigations.items.filter((item) => item.investigation.diagnosisId).length} saved diagnoses in listed investigations · open an investigation to review` : "Open an investigation to start the Mubit investigator" },
  ];

  return (
    <div className="normal-overview" data-testid="normal-overview">
      <div className="layout normal-overview-grid">
        <section className="left-column top-column">
          <article className="card risk-card" data-testid="overview-run">
            <div className="risk-head"><h2>Operational Risk</h2><span className="period">Selected period: Month</span></div>
            <button className="gauge-btn" onClick={() => setRiskOpen(true)} aria-label={riskScore === null ? "Show risk details" : `Show why the risk score is ${riskScore}`}><Gauge score={riskScore} /></button>
            <div className="risk-labels"><span>Low</span><span>High</span></div>
            <p>Calculated from persisted business anomalies, not an arbitrary score.</p>
            {riskOpen ? <div className="risk-panel" role="dialog" aria-label="Risk score breakdown"><div className="risk-head"><h2>{riskScore === null ? "No active risk" : `Why ${riskScore}?`}</h2><button className="close" onClick={() => setRiskOpen(false)} aria-label="Close">×</button></div><p className="panel-note">The score reflects the highest active incident severity recorded for run {state.run.simulationRunId}.</p><ul>{activeIncidents.slice(0, 5).map((incident) => <li key={incident.incidentId}><span className={`dot ${incident.severity.level === "high" || incident.severity.level === "critical" ? "high" : "medium"}`} />{incident.title}<em>{incident.severity.level} impact</em></li>)}</ul><p className="panel-note">No active incident means no risk score is displayed.</p></div> : null}
          </article>
        </section>

        <section className="right-column top-column">
          <article className="card signals-card top-signals-card" data-testid="overview-signals">
            <div className="signals-head"><h2>Signals</h2><div className="signals-actions"><span className="attention">{anomalies.total} alerts</span><Link href={withRun("/dashboard/signals")} className="signals-more">View all</Link></div></div>
            <SignalCarousel signals={signalRows} withRun={withRun} />
          </article>
        </section>

        <section className="left-column bottom-column"><RevenueTrend daily={breakdown.daily ?? []} total={total} /></section>

        <section className="right-column bottom-column">
          <article className="card metric-card" data-testid="overview-kpis" id="metrics">
            {[
              { label: "Revenue", value: total ? moneyCompact(total.counters.revenueMinor) : "—", direction: trendFor(latest?.counters.revenueMinor, previous?.counters.revenueMinor) },
              { label: "Sessions", value: total ? num(total.counters.sessions) : "—", direction: trendFor(latest?.counters.sessions, previous?.counters.sessions) },
              { label: "Orders", value: total ? num(total.counters.orders) : "—", direction: trendFor(latest?.counters.orders, previous?.counters.orders) },
              { label: "AdSpend", value: total ? moneyCompact(total.counters.adSpendMinor) : "—", direction: trendFor(latest?.counters.adSpendMinor, previous?.counters.adSpendMinor) },
            ].map((item) => <div className="metric" key={item.label}><span>{item.label}</span><div><strong title={item.value}>{item.value}</strong><Trend direction={item.direction} color={item.direction === "down" ? "red" : "green"} size={15} /></div></div>)}
          </article>

          <article className="card activity-card" data-testid="overview-activity" id="activity">
            <div className="activity-head"><h2>Normal Activity</h2><span>{activity.length} updates</span></div>
            <ol aria-label="Recent activity" tabIndex={0}>{activity.map((item) => <li key={item.title}><strong>{item.title}</strong><span>{item.detail}</span></li>)}</ol>
            <div className="activity-logo"><Image className="activity-logo-icon" src="/assets/Icon.svg" alt="Normal" width={141} height={140} /></div>
          </article>
          <CampaignCarousel campaigns={state.campaigns ?? []} metrics={breakdown.campaigns ?? []} withRun={withRun} />
        </section>

      </div>
    </div>
  );
}
