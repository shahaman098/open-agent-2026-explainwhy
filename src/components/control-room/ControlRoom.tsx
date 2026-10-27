"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CATEGORY_LABEL, fixed, money, moneyCompact, num, pct, shortDate, shortTime, virtualDate } from "@/lib/format";
import { Chart } from "@/components/control-room/charts";
import { NormalLogo } from "@/components/normal/NormalLogo";
import { PageSkeleton } from "@/components/normal/PageSkeleton";
import type { Breakdown, LedgerEvent, RunsResponse, StateResponse } from "@/components/control-room/types";

const SCENARIOS = ["healthy", "ad_fatigue", "delivery_delays", "viral_demand", "negative_reviews", "promo_checkout_failure"] as const;
const SCENARIO_LABEL: Record<string, string> = {
  healthy: "Healthy baseline", ad_fatigue: "Ad fatigue", delivery_delays: "Delivery delays", viral_demand: "Viral demand",
  negative_reviews: "Negative reviews", promo_checkout_failure: "Promo checkout failure",
};
const EVENT_TYPES = ["", "order.completed", "web.session_started", "ad.metrics_observed", "delivery.status_changed", "review.created", "checkout.failed", "inventory.level_changed", "social.mention_observed", "order.refunded", "campaign.budget_updated", "customer.message_sent", "storefront.banner_published"];

interface Data { state: StateResponse; breakdown: Breakdown; events: LedgerEvent[] }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message ?? `Request failed (${res.status})`;
    throw Object.assign(new Error(message), { status: res.status, code: body?.error?.code });
  }
  return body as T;
}

export function ControlRoom() {
  const [runs, setRuns] = useState<RunsResponse | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [eventType, setEventType] = useState("");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [seed, setSeed] = useState("42");
  const [newRunId, setNewRunId] = useState("");
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number]>("ad_fatigue");
  const [severity, setSeverity] = useState(0.8);

  const loadRuns = useCallback(async () => {
    try {
      const r = await api<RunsResponse>("/api/dev/simulator/runs");
      setRuns(r);
      setUnavailable(false);
      return r;
    } catch (e) {
      if ((e as { status?: number }).status === 404) setUnavailable(true);
      else setError((e as Error).message);
      return null;
    }
  }, []);

  const refresh = useCallback(async (id: string | null, type = eventType, windowDays = days) => {
    if (!id) { setData(null); return; }
    try {
      const q = `simulationRunId=${encodeURIComponent(id)}`;
      const [state, breakdown, events] = await Promise.all([
        api<StateResponse>(`/api/dev/simulator/state?${q}`),
        api<Breakdown>(`/api/metrics/breakdown?${q}&days=${windowDays}`),
        api<{ events: LedgerEvent[] }>(`/api/dev/simulator/events?${q}&limit=60${type ? `&type=${type}` : ""}`),
      ]);
      setData({ state, breakdown, events: events.events });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [eventType, days]);

  useEffect(() => {
    void (async () => {
      const r = await loadRuns();
      const id = r?.activeSimulationRunId ?? r?.runs[0]?.simulationRunId ?? null;
      setRunId(id);
      await refresh(id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setError(null); setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const start = () => act("start", async () => {
    const body: Record<string, unknown> = { seed: Number(seed) || 0, reset: true, makeActive: true };
    if (newRunId.trim()) body.simulationRunId = newRunId.trim();
    const summary = await api<{ run: { simulationRunId: string } }>("/api/dev/simulator/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setNotice(`Run ${summary.run.simulationRunId} created from seed ${seed}.`);
    await loadRuns();
    setRunId(summary.run.simulationRunId);
    await refresh(summary.run.simulationRunId);
  });

  // Canonical SimulatorTickRequest allows at most 60 ticks per request; longer jumps are issued as sequential requests.
  const MAX_TICKS_PER_REQUEST = 60;
  const tick = (ticks: number) => act(`tick-${ticks}`, async () => {
    if (!runId) return;
    let remaining = ticks, events = 0, virtualTime = "";
    while (remaining > 0) {
      const chunk = Math.min(remaining, MAX_TICKS_PER_REQUEST);
      const key = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${remaining}`;
      const res = await api<{ generatedEventsCount: number; virtualTime: string }>("/api/dev/simulator/tick", {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify({ simulationRunId: runId, ticks: chunk }),
      });
      events += res.generatedEventsCount; virtualTime = res.virtualTime; remaining -= chunk;
    }
    setNotice(`Advanced ${ticks}h · ${num(events)} canonical events ingested · now ${virtualDate(virtualTime)}.`);
    await refresh(runId);
  });

  const inject = () => act("inject", async () => {
    if (!runId) return;
    await api("/api/dev/simulator/inject", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ simulationRunId: runId, scenario, severity }) });
    setNotice(`${SCENARIO_LABEL[scenario]} active at severity ${severity.toFixed(2)}. Advance time to see its consequences.`);
    await refresh(runId);
  });

  const selectRun = async (id: string) => { setRunId(id); await refresh(id); };

  const total = data?.breakdown.total ?? null;
  const dailyPoints = useMemo(() => (data?.breakdown.daily ?? []).map((s) => ({ x: s.window.startAt, label: shortDate(s.window.startAt), value: s.counters.revenueMinor })), [data]);
  const ctrPoints = useMemo(() => (data?.breakdown.hourly ?? []).map((s) => ({ x: s.window.startAt, label: `${shortDate(s.window.startAt)} ${shortTime(s.window.startAt)}`, value: s.rates.ctr === null ? null : s.rates.ctr * 100 })), [data]);
  const latePoints = useMemo(() => (data?.breakdown.daily ?? []).map((s) => ({ x: s.window.startAt, label: shortDate(s.window.startAt), value: s.rates.lateDeliveryRate === null ? null : s.rates.lateDeliveryRate * 100 })), [data]);
  const ordersPoints = useMemo(() => (data?.breakdown.daily ?? []).map((s) => ({ x: s.window.startAt, label: shortDate(s.window.startAt), value: s.counters.orders })), [data]);
  const avgRating = useMemo(() => {
    const r = data?.state.recentReviews ?? [];
    return r.length ? r.reduce((a, x) => a + x.rating, 0) / r.length : null;
  }, [data]);
  const campaignNames = useMemo(() => new Map((data?.state.campaigns ?? []).map((c) => [c.campaignId, c])), [data]);
  const run = data?.state.run;

  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <Link href="/" className="brand normal-legacy-brand"><NormalLogo /><small>· Business control room</small></Link>
          <div className="row">
            <Link href="/dev/monitor" className="btn sm">Anomaly monitor</Link>
            <Link href="/demo-store" className="btn sm">Open demo store</Link>
          </div>
        </div>
      </header>

      <main className="shell cr">
        <div className="cr-head">
          <div>
            <h1>Nike digital twin</h1>
            <div className="muted">businessId <code>nike_demo</code>{run ? <> · run <code>{run.simulationRunId}</code> · seed {run.seed}</> : null}</div>
          </div>
          {run ? (
            <div className="row">
              <span className="pill" data-testid="virtual-time">Virtual time · {virtualDate(run.virtualTime)}</span>
              <span className={`pill ${run.activeScenario === "healthy" ? "ok" : "warn"}`} data-testid="scenario-pill">{SCENARIO_LABEL[run.activeScenario] ?? run.activeScenario}{run.activeScenario !== "healthy" ? ` · ${run.scenarioSeverity.toFixed(2)}` : ""}</span>
              <span className="pill">tick {data?.state.tickIndex}</span>
            </div>
          ) : null}
        </div>

        {unavailable ? <div className="alert error">Simulator controls are only available in development or a configured demo mode. The storefront still works against the persisted state.</div> : null}
        {error ? <div className="alert error" data-testid="error">{error}</div> : null}
        {notice ? <div className="alert ok" data-testid="notice">{notice}</div> : null}

        <div className="grid cr-grid">
          <aside className="card controls">
            <div className="group">
              <h4>Run</h4>
              <label className="field">Select run
                <select className="select" value={runId ?? ""} onChange={(e) => void selectRun(e.target.value)} disabled={!runs?.runs.length}>
                  {!runs?.runs.length ? <option value="">No runs yet</option> : null}
                  {runs?.runs.map((r) => <option key={r.simulationRunId} value={r.simulationRunId}>{r.simulationRunId}{runs.activeSimulationRunId === r.simulationRunId ? " (storefront)" : ""}</option>)}
                </select>
              </label>
              <div className="row">
                <label className="field" style={{ flex: 1 }}>Seed<input aria-label="Seed" className="input" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" data-testid="seed-input" /></label>
                <label className="field" style={{ flex: 2 }}>Run id (optional)<input aria-label="Run id (optional)" className="input" value={newRunId} onChange={(e) => setNewRunId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="run_nike_s42" data-testid="runid-input" /></label>
              </div>
              <button className="btn primary" onClick={start} disabled={busy !== null || unavailable} data-testid="start-run">{busy === "start" ? <><span className="spinner" /> Creating…</> : "Start / reset run"}</button>
              <span className="muted small">Resetting wipes only the records of this run and makes it the active run for the storefront.</span>
            </div>
            <div className="group">
              <h4>Advance virtual time</h4>
              <div className="row">
                {[1, 6, 24, 72].map((h) => (
                  <button key={h} className="btn" onClick={() => tick(h)} disabled={!runId || busy !== null || unavailable} data-testid={`tick-${h}`}>
                    {busy === `tick-${h}` ? <span className="spinner" /> : `+${h}h`}
                  </button>
                ))}
              </div>
              <span className="muted small">One tick is one virtual hour. Each tick generates sessions, orders, ad observations, deliveries and reviews, then ingests them.</span>
            </div>
            <div className="group">
              <h4>Inject incident</h4>
              <label className="field">Scenario
                <select aria-label="Scenario" className="select" value={scenario} onChange={(e) => setScenario(e.target.value as (typeof SCENARIOS)[number])} data-testid="scenario-select">
                  {SCENARIOS.map((s) => <option key={s} value={s}>{SCENARIO_LABEL[s]}</option>)}
                </select>
              </label>
              <label className="field">Severity · {severity.toFixed(2)}
                <input aria-label="Severity" type="range" min={0} max={1} step={0.05} value={severity} onChange={(e) => setSeverity(Number(e.target.value))} className="range" data-testid="severity-range" />
              </label>
              <button className="btn accent" onClick={inject} disabled={!runId || busy !== null || unavailable} data-testid="inject">{busy === "inject" ? <><span className="spinner" /> Injecting…</> : "Inject scenario"}</button>
              <span className="muted small">Scenarios change hidden mechanics (hazards, probabilities), never the displayed numbers.</span>
            </div>
            <div className="group">
              <h4>Metrics window</h4>
              <div className="row">
                {[1, 3, 7, 14, 30].map((d) => <button key={d} className={`chip ${days === d ? "active" : ""}`} onClick={() => { setDays(d); void refresh(runId, eventType, d); }}>{d}d</button>)}
              </div>
            </div>
          </aside>

          <section style={{ display: "grid", gap: 16, minWidth: 0 }}>
            {!data ? runs && runs.runs.length === 0 ? <div className="card"><div className="empty">No simulation yet. Start a run with a seed to create the Nike digital twin.</div></div> : error ? null : <PageSkeleton variant="section" label="Loading control room data" /> : (
              <>
                <div className="grid kpis" data-testid="kpis">
                  <Kpi label="Revenue (net)" value={moneyCompact(total?.counters.revenueMinor)} sub={`${num(total?.counters.orders)} orders · refunds ${moneyCompact(total?.counters.refundMinor)}`} />
                  <Kpi label="Sessions" value={num(total?.counters.sessions)} sub={`conversion ${pct(total?.rates.conversionRate, 2)}`} />
                  <Kpi label="Ad spend" value={moneyCompact(total?.counters.adSpendMinor)} sub={`CTR ${pct(total?.rates.ctr, 2)} · ${num(total?.counters.impressions)} impressions`} />
                  <Kpi label="Cost per acquisition" value={money(total?.rates.costPerAcquisitionMinor)} sub={`${num(total?.counters.attributedOrders)} attributed orders`} />
                  <Kpi label="Late deliveries" value={pct(total?.rates.lateDeliveryRate)} sub={`${num(total?.counters.delayedShipments)} of ${num(total?.counters.shipments)} shipped`} />
                  <Kpi label="Reviews" value={total?.counters.reviews ? `${fixed(avgRating, 1)}★ recent` : "—"} sub={`${num(total?.counters.reviews)} reviews · ${pct(total?.rates.lowRatingRate)} low`} />
                </div>

                <div className="grid two">
                  <Chart title="Net revenue by virtual day" subtitle={`${shortDate(data.breakdown.window.startAt)} – ${shortDate(data.breakdown.window.endAt)}`} points={dailyPoints} format={(v) => moneyCompact(v)} kind="bar" testId="revenue-chart" />
                  <Chart title="Orders by virtual day" points={ordersPoints} format={(v) => num(v)} kind="bar" />
                  <Chart title="Ad click-through rate, hourly (last 72h)" points={ctrPoints} format={(v) => (v === null ? "—" : `${v.toFixed(2)}%`)} kind="line" testId="ctr-chart" />
                  <Chart title="Late delivery rate by virtual day" points={latePoints} format={(v) => (v === null ? "—" : `${v.toFixed(0)}%`)} kind="line" />
                </div>

                <div className="card">
                  <div className="card-head"><h3>Campaigns</h3><span>deduplicated ad.metrics_observed windows · {days}d</span></div>
                  <div className="card-body scroll-x">
                    <table data-testid="campaigns-table">
                      <thead><tr><th>Campaign</th><th className="num">Daily budget</th><th className="num">Spend</th><th className="num">Impr.</th><th className="num">Clicks</th><th className="num">CTR</th><th className="num">Freq.</th><th className="num">Attr. orders</th><th className="num">CPA</th><th className="num">ROAS</th></tr></thead>
                      <tbody>
                        {data.breakdown.campaigns.map((c) => {
                          const meta = campaignNames.get(c.campaignId);
                          return (
                            <tr key={c.campaignId}>
                              <td><div style={{ fontWeight: 600 }}>{meta?.name ?? c.campaignId}</div><div className="muted small">{c.campaignId} · {meta?.status ?? ""}</div></td>
                              <td className="num">{money(meta?.dailyBudgetMinor)}</td>
                              <td className="num">{money(c.spendMinor)}</td>
                              <td className="num">{num(c.impressions)}</td>
                              <td className="num">{num(c.clicks)}</td>
                              <td className="num">{pct(c.ctr, 2)}</td>
                              <td className="num">{fixed(c.averageFrequency, 2)}</td>
                              <td className="num">{num(c.attributedOrders)}</td>
                              <td className="num">{money(c.costPerAcquisitionMinor)}</td>
                              <td className="num">{c.roas === null ? "—" : `${c.roas.toFixed(2)}×`}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid two">
                  <div className="card">
                    <div className="card-head"><h3>Inventory & product revenue</h3><span>{days}d</span></div>
                    <div className="card-body scroll-x">
                      <table data-testid="inventory-table">
                        <thead><tr><th>Product</th><th className="num">Price</th><th className="num">Sold</th><th className="num">Revenue</th><th className="num">In stock</th></tr></thead>
                        <tbody>
                          {data.breakdown.products.map((p) => (
                            <tr key={p.productId}>
                              <td><div style={{ fontWeight: 600 }}>{p.name}</div><div className="muted small">{CATEGORY_LABEL[p.category]}</div></td>
                              <td className="num">{money(p.priceMinor)}</td>
                              <td className="num">{num(p.unitsSold)}</td>
                              <td className="num">{money(p.revenueMinor)}</td>
                              <td className="num"><span className={`stock ${p.availableUnits <= 0 ? "out" : p.availableUnits <= 10 ? "low" : "ok"}`}>{num(p.availableUnits)}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 16 }}>
                    <div className="card">
                      <div className="card-head"><h3>Shipping activity</h3><span>all time</span></div>
                      <div className="card-body">
                        <div className="row" style={{ marginBottom: 12 }}>
                          {["pending", "shipped", "delayed", "delivered", "lost"].map((s) => (
                            <span key={s} className={`pill ${s === "delayed" || s === "lost" ? "warn" : s === "delivered" ? "ok" : ""}`}>{s} {num(data.state.shipments[s] ?? 0)}</span>
                          ))}
                        </div>
                        <table>
                          <thead><tr><th>Order</th><th>Status</th><th>Promised</th><th className="num">Delay</th></tr></thead>
                          <tbody>
                            {data.state.recentShipments.map((s) => (
                              <tr key={s.shipmentId}><td className="mono">{s.orderId.replace(/^ord_[^_]+(?:_[^_]+)*?_/, "…")}</td><td>{s.status}</td><td>{shortDate(s.promisedAt)}</td><td className="num">{s.delayMinutes ? `${(s.delayMinutes / 60).toFixed(0)}h` : "—"}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div className="card">
                      <div className="card-head"><h3>Recent reviews</h3><span>synthetic</span></div>
                      <div className="card-body" style={{ display: "grid", gap: 8 }}>
                        {data.state.recentReviews.length === 0 ? <div className="muted small">No reviews yet; they follow deliveries by one to three virtual days.</div> : null}
                        {data.state.recentReviews.map((r) => (
                          <div key={r.reviewId} style={{ fontSize: 13 }}>
                            <span className={`pill ${r.rating <= 2 ? "danger" : r.rating >= 4 ? "ok" : ""}`}>{r.rating}★</span> <span className="muted small">{shortDate(r.createdAt)}</span>
                            <div>{r.text}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-head">
                    <h3>Canonical event ledger</h3>
                    <select className="select" style={{ width: "auto", height: 32 }} value={eventType} onChange={(e) => { setEventType(e.target.value); void refresh(runId, e.target.value); }} aria-label="Filter events by type">
                      {EVENT_TYPES.map((t) => <option key={t} value={t}>{t || "All types"}</option>)}
                    </select>
                  </div>
                  <div className="legend"><span>{num(data.state.totals.events)} events total · showing latest {data.events.length} · stored in business_events</span></div>
                  <div className="events" data-testid="events-log">
                    {data.events.map((e) => (
                      <div key={e.eventId} className="event">
                        <span>{shortDate(e.occurredAt)} {shortTime(e.occurredAt)}</span>
                        <span className="t">{e.type}{e.provenance.ingestMethod === "action_callback" ? " ↩" : ""}</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summarisePayload(e)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card kpi">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub ? <span className="sub">{sub}</span> : null}
    </div>
  );
}

function summarisePayload(e: LedgerEvent): string {
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case "order.completed": return `${p.orderId} · ${money(p.netRevenueMinor as number)} · ${(p.productIds as string[]).join(", ")}${p.campaignId ? ` · via ${p.campaignId}` : ""}`;
    case "web.session_started": return `${p.sessionId} · ${p.channel} · ${p.device}${p.campaignId ? ` · ${p.campaignId}` : ""}`;
    case "ad.metrics_observed": return `${p.campaignId} · ${num(p.impressions as number)} impr · ${num(p.clicks as number)} clicks · ${money(p.spendMinor as number)} · freq ${fixed(p.frequency as number, 2)}`;
    case "delivery.status_changed": return `${p.orderId} → ${p.status}${p.delayMinutes ? ` (+${Math.round((p.delayMinutes as number) / 60)}h)` : ""}`;
    case "review.created": return `${p.rating}★ ${p.productId} · ${String(p.text).slice(0, 60)}`;
    case "checkout.failed": return `${p.failureCode}${p.couponCode ? ` · ${p.couponCode}` : ""} · ${p.sessionId}`;
    case "inventory.level_changed": return `${p.productId} · ${p.availableUnits} available`;
    case "social.mention_observed": return `${p.platform} · ${num(p.views as number)} views · ${String(p.content).slice(0, 50)}`;
    case "order.refunded": return `${p.orderId} · ${money(p.refundMinor as number)} · ${p.reason ?? ""}`;
    case "campaign.budget_updated": return `${p.campaignId} · ${money(p.previousDailyBudgetMinor as number)} → ${money(p.newDailyBudgetMinor as number)} · ${p.actionId}`;
    default: return JSON.stringify(p).slice(0, 90);
  }
}
