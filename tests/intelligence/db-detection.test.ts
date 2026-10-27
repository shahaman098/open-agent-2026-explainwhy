import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { Anomaly, Investigation, MetricSnapshot, type AnomalyT, type MetricSnapshotT } from "@normal/contracts";
import { GET as anomaliesRoute } from "@/app/api/anomalies/route";
import { GET as incidentsRoute } from "@/app/api/incidents/route";
import { GET as investigationRoute } from "@/app/api/investigations/[id]/route";
import { GET as investigationsRoute } from "@/app/api/investigations/route";
import { GET as monitorStatusRoute, POST as monitorRoute } from "@/app/api/dev/monitor/run/route";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { detect } from "@/intelligence/detection/engine";
import type { FindingDoc, IncidentDoc } from "@/intelligence/detection/persistence";
import { CATALOGUE_PROJECTION, runMonitor } from "@/intelligence/monitor";
import { getInvestigationBundle, listAnomalies, listIncidents, listInvestigations } from "@/intelligence/queries";
import { loadGroupedRows, loadHorizon } from "@/intelligence/signals/load";
import { groupEvents } from "@/intelligence/signals/rows";
import { SignalSeries } from "@/intelligence/signals/series";
import { injectScenario, startRun, tickRun } from "@/simulator/runtime";
import { TEST_BUSINESS, eventsForRun, resetTestRun } from "../helpers";

const RUN_A = "t_det_a";
const COUNTED = new Set(["sessions", "paid_sessions", "campaign_sessions", "channel_sessions", "orders", "paid_orders", "campaign_orders", "product_orders", "product_mentions", "social_mentions"]);
const RUN_B = "t_det_b";
const DEMO_KEY = "detector-demo-key";
const strip = <T extends Record<string, unknown>>(d: T) => { const { _id: _i, simulationRunId: _r, ...rest } = d; void _i; void _r; return rest; };
const req = (path: string, init: RequestInit & { json?: unknown; demo?: boolean } = {}) => {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  if (init.demo !== false) headers.set("x-normal-demo-key", DEMO_KEY);
  return new Request(`http://localhost/api${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined });
};
async function counts(db: Db, run: string) {
  const f = { businessId: TEST_BUSINESS, simulationRunId: run };
  const [a, i, fi, inc, ev] = await Promise.all([COLLECTIONS.anomalies, COLLECTIONS.investigations, COLLECTIONS.detectionFindings, COLLECTIONS.incidents, COLLECTIONS.businessEvents]
    .map((c) => db.collection(c).countDocuments(f)));
  return { anomalies: a, investigations: i, findings: fi, incidents: inc, events: ev };
}
function metricValue(s: MetricSnapshotT, metric: AnomalyT["metric"]): number | null {
  switch (metric) {
    case "revenue_minor": return s.counters.revenueMinor;
    case "orders": return s.counters.orders;
    case "ad_spend_minor": return s.counters.adSpendMinor;
    case "conversion_rate": return s.rates.conversionRate;
    case "ctr": return s.rates.ctr;
    case "late_delivery_rate": return s.rates.lateDeliveryRate;
    case "low_rating_rate": return s.rates.lowRatingRate;
    case "cac_minor": return s.rates.costPerAcquisitionMinor;
    case "checkout_failure_rate": return s.rates.checkoutFailureRate ?? null;
    case "coupon_failure_rate": return s.rates.couponFailureRate ?? null;
  }
}
function pooled(metric: AnomalyT["metric"], snaps: MetricSnapshotT[]): [number, number] {
  const sum = (fn: (s: MetricSnapshotT) => number) => snaps.reduce((a, s) => a + fn(s), 0);
  switch (metric) {
    case "ctr": return [sum((s) => s.counters.clicks), sum((s) => s.counters.impressions)];
    case "conversion_rate": return [sum((s) => s.counters.orders), sum((s) => s.counters.sessions)];
    case "late_delivery_rate": return [sum((s) => s.counters.delayedShipments), sum((s) => s.counters.shipments)];
    case "low_rating_rate": return [sum((s) => s.counters.lowRatingReviews), sum((s) => s.counters.reviews)];
    case "cac_minor": return [sum((s) => s.counters.adSpendMinor), sum((s) => s.counters.attributedOrders)];
    case "checkout_failure_rate": return [sum((s) => s.counters.checkoutFailures ?? 0), sum((s) => s.counters.orders + (s.counters.checkoutFailures ?? 0))];
    case "coupon_failure_rate": return [sum((s) => s.counters.couponFailures ?? 0), sum((s) => s.counters.orders + (s.counters.checkoutFailures ?? 0))];
    default: return [0, 0];
  }
}

describe("anomaly detection persistence and APIs (Milestone 4)", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getDb();
    await ensureIndexes(db);
    process.env.NORMAL_DEMO_MODE = "true"; process.env.NORMAL_DEMO_KEY = DEMO_KEY;
    for (const r of [RUN_A, RUN_B]) await resetTestRun(r);
    await startRun({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, seed: 42, makeActive: false });
    for (let i = 0; i < 2; i++) await tickRun({ simulationRunId: RUN_A, ticks: 36 }, { businessId: TEST_BUSINESS });
    await injectScenario({ simulationRunId: RUN_A, scenario: "ad_fatigue", severity: 0.8 }, TEST_BUSINESS);
    await tickRun({ simulationRunId: RUN_A, ticks: 30 }, { businessId: TEST_BUSINESS });
    await startRun({ businessId: TEST_BUSINESS, simulationRunId: RUN_B, seed: 7, makeActive: false });
    for (let i = 0; i < 2; i++) await tickRun({ simulationRunId: RUN_B, ticks: 42 }, { businessId: TEST_BUSINESS });
  }, 900_000);
  afterAll(async () => {
    for (const r of [RUN_A, RUN_B]) await resetTestRun(r);
    delete process.env.NORMAL_DEMO_MODE; delete process.env.NORMAL_DEMO_KEY;
  }, 120_000);

  it("the MongoDB aggregation and the in-memory grouping produce identical rows and identical detections", async () => {
    const horizon = (await loadHorizon(db, TEST_BUSINESS, RUN_A))!;
    expect(horizon.watermark).toBe("2026-10-05T06:00:00.000Z");
    const mongo = await loadGroupedRows(db, TEST_BUSINESS, RUN_A, horizon.historyStart, horizon.watermark);
    const mem = groupEvents(await eventsForRun(RUN_A), { startAt: horizon.historyStart, endAt: horizon.watermark });
    const norm = (rows: unknown[]) => [...rows].map((r) => JSON.stringify(r, Object.keys(r as object).sort())).sort();
    for (const k of Object.keys(mem) as Array<keyof typeof mem>) expect(norm(mongo[k]), k).toEqual(norm(mem[k]));
    const labels = new Map([["nk_air_force_1_07", { name: "x", category: "lifestyle" }]]);
    const a = detect(new SignalSeries(TEST_BUSINESS, RUN_A, horizon.historyStart, horizon.watermark, mongo, labels));
    const b = detect(new SignalSeries(TEST_BUSINESS, RUN_A, horizon.historyStart, horizon.watermark, mem, labels));
    expect(a.findings.map((f) => f.key)).toEqual(b.findings.map((f) => f.key));
  });

  it("persists validated canonical Anomaly and Investigation records plus findings and incidents", async () => {
    const before = await counts(db, RUN_A);
    const s = await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN_A });
    expect(s.asOf).toBe("2026-10-05T06:00:00.000Z");
    expect(s.metricsEvaluated.signals.length).toBeGreaterThanOrEqual(30);
    expect(s.persisted!.investigations.created).toHaveLength(1);
    expect(s.persisted!.anomalies.canonical).toBeGreaterThan(2);
    const after = await counts(db, RUN_A);
    expect(after.events).toBe(before.events);
    const anomalies = await db.collection(COLLECTIONS.anomalies).find({ businessId: TEST_BUSINESS, simulationRunId: RUN_A }).toArray();
    for (const a of anomalies) expect(Anomaly.safeParse(strip(a)).success).toBe(true);
    const investigations = await db.collection(COLLECTIONS.investigations).find({ businessId: TEST_BUSINESS, simulationRunId: RUN_A }).toArray();
    expect(investigations).toHaveLength(1);
    expect(Investigation.safeParse(strip(investigations[0])).success).toBe(true);
    expect(investigations[0].status).toBe("open");
    expect(investigations[0].evidenceIds).toEqual([]);
    const incident = (await db.collection<IncidentDoc>(COLLECTIONS.incidents).findOne({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, investigationId: investigations[0].investigationId }))!;
    expect(incident.primaryTheme).toBe("advertising");
    expect(incident.status).toBe("investigating");
    expect(incident.anomalyIds.sort()).toEqual([...investigations[0].anomalyIds].sort());
    for (const a of anomalies) expect(a.status).toBe("investigating");
  });

  it("anomaly values equal the MetricSnapshots they cite, and baselines are reproducible from those snapshots", async () => {
    const anomalies = (await db.collection(COLLECTIONS.anomalies).find({ businessId: TEST_BUSINESS, simulationRunId: RUN_A }).toArray()).map((d) => Anomaly.parse(strip(d)));
    for (const a of anomalies) {
      const snaps = await db.collection(COLLECTIONS.metricSnapshots).find({ businessId: TEST_BUSINESS, snapshotId: { $in: a.sourceSnapshotIds } }).toArray();
      expect(snaps).toHaveLength(a.sourceSnapshotIds.length);
      const byId = new Map(snaps.map((x) => [x.snapshotId as string, MetricSnapshot.parse(strip(x))]));
      const current = byId.get(a.sourceSnapshotIds[0])!;
      expect(current.window).toEqual(a.currentWindow);
      expect(metricValue(current, a.metric)!).toBeCloseTo(a.actualValue, 9);
      const baseline = a.sourceSnapshotIds.slice(1).map((id) => byId.get(id)!);
      const finding = (await db.collection<FindingDoc>(COLLECTIONS.detectionFindings).findOne({ businessId: TEST_BUSINESS, anomalyId: a.anomalyId }))!;
      expect(baseline).toHaveLength(finding.evaluation.baseline!.n);
      if (["ctr", "conversion_rate", "late_delivery_rate", "low_rating_rate", "checkout_failure_rate", "coupon_failure_rate"].includes(a.metric)) {
        const [num, den] = pooled(a.metric, baseline);
        expect(a.baselineValue).toBeCloseTo((num + 0.5) / (den + 1), 9);
      } else if (a.metric === "cac_minor") {
        const [num, den] = pooled(a.metric, baseline);
        expect(a.baselineValue).toBeCloseTo(num / den, 9);
      } else {
        const values = baseline.map((x) => metricValue(x, a.metric)!).sort((p, q) => p - q);
        const mid = Math.floor(values.length / 2);
        const med = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
        expect(a.baselineValue).toBeCloseTo(med > 0 ? med : values.reduce((p, q) => p + q, 0) / values.length, 9);
      }
    }
  });

  it("every finding's evidence references resolve to stored records", async () => {
    const findings = await db.collection<FindingDoc>(COLLECTIONS.detectionFindings).find({ businessId: TEST_BUSINESS, simulationRunId: RUN_A }).toArray();
    expect(findings.length).toBeGreaterThan(5);
    for (const f of findings) {
      for (const ref of f.evidence.sourceRecords) {
        const key = ref.collection === COLLECTIONS.metricSnapshots ? "snapshotId" : "eventId";
        expect(await db.collection(ref.collection).countDocuments({ businessId: TEST_BUSINESS, [key]: ref.recordId }), `${ref.collection}:${ref.recordId}`).toBe(1);
      }
      const n = await db.collection(COLLECTIONS.businessEvents).countDocuments(f.evidence.eventQuery.filter);
      // For count signals the evidence query must reproduce exactly the counted events.
      if (COUNTED.has(f.signalId)) expect(n, f.signalId).toBe(f.evaluation.currentNumerator);
      else expect(n).toBeGreaterThanOrEqual(0);
      expect(f.reason).toMatch(/observation, not a diagnosis/);
    }
  });

  it("repeating a scan for the same window is idempotent", async () => {
    const before = await counts(db, RUN_A);
    const s = await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN_A });
    expect(s.repeatScan).toBe(true);
    expect(s.persisted!.findings.created).toBe(0);
    expect(s.persisted!.anomalies.created).toBe(0);
    expect(s.persisted!.incidents.created).toBe(0);
    expect(s.persisted!.investigations.created).toEqual([]);
    expect(await counts(db, RUN_A)).toEqual(before);
    const scanLog = await db.collection(COLLECTIONS.monitorRuns).findOne({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, asOf: s.asOf });
    expect(scanLog!.repeats).toBe(2);
  });

  it("concurrent scans are serialised: exactly one runs, nothing is duplicated", async () => {
    const before = await counts(db, RUN_A);
    const results = await Promise.allSettled([1, 2, 3].map(() => runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN_A })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && (r.reason as { code: string }).code === "monitor_locked")).toHaveLength(2);
    expect(await counts(db, RUN_A)).toEqual(before);
  });

  it("rejects stale and incomplete windows; dry runs analyse history without persisting", async () => {
    await expect(runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, asOf: "2026-10-05T00:00:00.000Z" })).rejects.toMatchObject({ code: "stale_window" });
    await expect(runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, asOf: "2026-10-05T07:00:00.000Z" })).rejects.toMatchObject({ code: "window_not_complete" });
    await expect(runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, asOf: "2026-10-05T05:30:00.000Z" })).rejects.toMatchObject({ code: "invalid_as_of" });
    await expect(runMonitor({ businessId: TEST_BUSINESS, simulationRunId: "t_det_none" })).rejects.toMatchObject({ code: "no_observations" });
    const before = await counts(db, RUN_A);
    const dry = await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, asOf: "2026-10-04T12:00:00.000Z", dryRun: true });
    expect(dry.persisted).toBeNull();
    expect(dry.findings.active).toBeGreaterThan(0);
    expect(await counts(db, RUN_A)).toEqual(before);
  });

  it("keeps simulation runs isolated", async () => {
    const s = await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN_B });
    expect(s.persisted!.investigations.created).toEqual([]);
    const b = await listAnomalies({ businessId: TEST_BUSINESS, simulationRunId: RUN_B });
    expect(b.items).toEqual([]);
    const a = await listAnomalies({ businessId: TEST_BUSINESS, simulationRunId: RUN_A });
    expect(a.total).toBeGreaterThan(0);
    expect(a.items.every((i) => i.simulationRunId === RUN_A)).toBe(true);
    expect((await listInvestigations({ businessId: TEST_BUSINESS, simulationRunId: RUN_B })).items).toEqual([]);
    const other = await listAnomalies({ businessId: "someone_else" });
    expect(other.total).toBe(0);
  });

  it("filters, paginates and returns validated canonical records", async () => {
    const all = await listAnomalies({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, limit: 100 });
    for (const i of all.items) expect(Anomaly.safeParse(i.anomaly).success).toBe(true);
    const page = await listAnomalies({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, limit: 2, offset: 1 });
    expect(page.items).toHaveLength(Math.min(2, all.total - 1));
    expect(page.items[0].anomaly.anomalyId).toBe(all.items[1].anomaly.anomalyId);
    const ctr = await listAnomalies({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, metric: "ctr" });
    expect(ctr.items.every((i) => i.anomaly.metric === "ctr")).toBe(true);
    const campaignCtrs = ctr.items.filter((item) => item.finding?.segment.kind === "campaign");
    expect(campaignCtrs.length).toBeGreaterThan(0);
    const campaignIds = campaignCtrs.map((item) => item.finding!.segment.id!);
    const campaignNames = new Map((await db.collection(COLLECTIONS.simulatedCampaigns).find({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, campaignId: { $in: campaignIds } }, { projection: { _id: 0, campaignId: 1, name: 1 } }).toArray()).map((campaign) => [campaign.campaignId, campaign.name]));
    for (const item of campaignCtrs) {
      expect(item.signalFamilyId).toBe(item.finding!.signalId);
      expect(item.signalLabel).toBe(item.finding!.label);
      expect(item.entityName).toBe(campaignNames.get(item.finding!.segment.id!));
    }
    for (const item of ctr.items.filter((entry) => entry.finding?.segment.kind === "global")) expect(item.entityName).toBe(item.finding!.segmentLabel);
    const adv = await listAnomalies({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, category: "advertising" });
    expect(adv.total).toBe(all.items.filter((i) => i.finding?.theme === "advertising").length);
    const sev = all.items[0].anomaly.severity;
    expect((await listAnomalies({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, severity: sev })).items.every((i) => i.anomaly.severity === sev)).toBe(true);
    const none = await listAnomalies({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, to: "2026-10-01T00:00:00.000Z" });
    expect(none.total).toBe(0);
    await expect(listAnomalies({ businessId: TEST_BUSINESS, metric: "made_up" })).rejects.toThrow();
    const inc = await listIncidents({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, status: "investigating" });
    expect(inc.total).toBe(1);
  });

  it("the investigation bundle gives the next stage everything it needs, with no simulator internals", async () => {
    const inv = (await listInvestigations({ businessId: TEST_BUSINESS, simulationRunId: RUN_A })).items[0].investigation;
    const bundle = (await getInvestigationBundle(inv.investigationId, undefined, { businessId: TEST_BUSINESS, simulationRunId: RUN_A }))!;
    expect(bundle.anomalies.map((a) => a.anomalyId).sort()).toEqual([...inv.anomalyIds].sort());
    expect(bundle.metricSnapshots.length).toBeGreaterThan(0);
    for (const s of bundle.metricSnapshots) expect(MetricSnapshot.safeParse(s).success).toBe(true);
    expect(bundle.findings.length).toBeGreaterThan(bundle.anomalies.length);
    expect(bundle.affected.campaigns.length).toBe(5);
    expect(bundle.eventQueries.length).toBe(bundle.findings.length);
    const text = JSON.stringify(bundle);
    for (const w of ["ad_fatigue", "scenarioParams", "ctrFatigueStrength", "adAudienceShrink", "hiddenFaultParameters", "activeScenario"]) expect(text).not.toContain(w);
  });

  it("the detector reads only canonical events, metric snapshots, product labels and its own records (runtime spy)", async () => {
    const accessed = new Map<string, Array<{ op: string; projection?: unknown; lookups?: string[] }>>();
    const record = (name: string, entry: { op: string; projection?: unknown; lookups?: string[] }) => accessed.set(name, [...(accessed.get(name) ?? []), entry]);
    const spy = new Proxy(db, { get(target, prop, receiver) {
      if (prop !== "collection") return Reflect.get(target, prop, receiver);
      return (name: string) => {
        const col = target.collection(name);
        return new Proxy(col, { get(c, p, r) {
          const v = Reflect.get(c, p, r);
          if (typeof v !== "function") return v;
          return (...args: unknown[]) => {
            if (p === "find" || p === "findOne") record(name, { op: String(p), projection: (args[1] as { projection?: unknown } | undefined)?.projection });
            else if (p === "aggregate") record(name, { op: "aggregate", lookups: JSON.stringify(args[0]).match(/"from":"([a-z_]+)"/g)?.map((m) => m.slice(8, -1)) ?? [] });
            else record(name, { op: String(p) });
            return (v as (...a: unknown[]) => unknown).apply(c, args);
          };
        } });
      };
    } }) as Db;
    await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, dryRun: true }, { db: spy });
    await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN_A }, { db: spy });
    const allowed = new Set([COLLECTIONS.businessEvents, COLLECTIONS.simulatedProducts, COLLECTIONS.metricSnapshots, COLLECTIONS.anomalies, COLLECTIONS.investigations,
      COLLECTIONS.detectionFindings, COLLECTIONS.detectionObservations, COLLECTIONS.incidents, COLLECTIONS.monitorRuns, COLLECTIONS.monitorState, COLLECTIONS.monitoringWindows]);
    for (const name of accessed.keys()) expect(allowed.has(name as never), `unexpected collection ${name}`).toBe(true);
    for (const forbidden of [COLLECTIONS.simulatorState, COLLECTIONS.simulatorGroundTruth, COLLECTIONS.simulatedCustomers, COLLECTIONS.simulatedShipments, COLLECTIONS.simulatedReviews, COLLECTIONS.simulatedCampaigns]) {
      expect(accessed.has(forbidden)).toBe(false);
    }
    for (const e of accessed.get(COLLECTIONS.simulatedProducts) ?? []) expect(e.projection).toEqual(CATALOGUE_PROJECTION);
    const lookups = new Set([...accessed.values()].flat().flatMap((e) => e.lookups ?? []));
    for (const l of lookups) expect([COLLECTIONS.businessEvents, COLLECTIONS.simulatedOrders, COLLECTIONS.simulatedSessions]).toContain(l);
  });

  it("a crash during incident publication rolls back the graph and a retry preserves IDs", async () => {
    const before = await counts(db, RUN_A);
    const spy = new Proxy(db, { get(target, prop, receiver) {
      if (prop !== "collection") return Reflect.get(target, prop, receiver);
      return (name: string) => {
        const col = target.collection(name);
        return new Proxy(col, { get(c, p, r) {
          if (name === COLLECTIONS.anomalies && p === "bulkWrite") return async () => { throw new Error("injected publication crash"); };
          const value = Reflect.get(c, p, r);
          return typeof value === "function" ? value.bind(c) : value;
        } });
      };
    } }) as Db;
    await expect(runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN_A }, { db: spy })).rejects.toThrow("injected publication crash");
    expect(await counts(db, RUN_A)).toEqual(before);
    await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN_A }, { db });
    expect(await counts(db, RUN_A)).toEqual(before);
  });

  it("monitoring never mutates business state", async () => {
    const snap = async () => ({
      campaigns: await db.collection(COLLECTIONS.simulatedCampaigns).find({ businessId: TEST_BUSINESS, simulationRunId: RUN_A }, { projection: { _id: 0, campaignId: 1, dailyBudgetMinor: 1, status: 1 } }).sort({ campaignId: 1 }).toArray(),
      storefront: await db.collection(COLLECTIONS.simulatedStorefront).findOne({ businessId: TEST_BUSINESS, simulationRunId: RUN_A }, { projection: { _id: 0, banners: 1, promotions: 1 } }),
      messages: await db.collection(COLLECTIONS.simulatedMessages).countDocuments({ businessId: TEST_BUSINESS, simulationRunId: RUN_A }),
      events: await db.collection(COLLECTIONS.businessEvents).countDocuments({ businessId: TEST_BUSINESS, simulationRunId: RUN_A }),
      state: await db.collection(COLLECTIONS.simulatorState).findOne({ businessId: TEST_BUSINESS, simulationRunId: RUN_A }, { projection: { _id: 0, virtualTime: 1, tickIndex: 1, rng: 1 } }),
    });
    const before = await snap();
    await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN_A });
    expect(await snap()).toEqual(before);
  });

  it("routes are protected and return canonical shapes", async () => {
    process.env.NORMAL_DEMO_MODE = "false";
    expect((await monitorRoute(req("/dev/monitor/run", { method: "POST", json: { businessId: TEST_BUSINESS, simulationRunId: RUN_A }, demo: false }))).status).toBe(404);
    expect((await anomaliesRoute(req(`/anomalies?businessId=${TEST_BUSINESS}`, { demo: false }))).status).toBe(404);
    expect((await investigationsRoute(req(`/investigations?businessId=${TEST_BUSINESS}`, { demo: false }))).status).toBe(404);
    expect((await incidentsRoute(req(`/incidents?businessId=${TEST_BUSINESS}`, { demo: false }))).status).toBe(404);
    process.env.NORMAL_DEMO_MODE = "true";
    const run = await monitorRoute(req("/dev/monitor/run", { method: "POST", json: { businessId: TEST_BUSINESS, simulationRunId: RUN_A } }));
    expect(run.status).toBe(200);
    expect((await run.json()).repeatScan).toBe(true);
    expect((await monitorRoute(req("/dev/monitor/run", { method: "POST", json: { businessId: TEST_BUSINESS } }))).status).toBe(400);
    const status = await (await monitorStatusRoute(req(`/dev/monitor/run?businessId=${TEST_BUSINESS}&simulationRunId=${RUN_A}`))).json();
    expect(status.lastAsOf).toBe("2026-10-05T06:00:00.000Z");
    const list = await (await anomaliesRoute(req(`/anomalies?businessId=${TEST_BUSINESS}&simulationRunId=${RUN_A}&limit=3`))).json();
    expect(list.items).toHaveLength(3);
    for (const i of list.items) expect(Anomaly.safeParse(i.anomaly).success).toBe(true);
    expect((await anomaliesRoute(req(`/anomalies?businessId=${TEST_BUSINESS}&severity=extreme`))).status).toBe(400);
    const invs = await (await investigationsRoute(req(`/investigations?businessId=${TEST_BUSINESS}&simulationRunId=${RUN_A}`))).json();
    expect(invs.items).toHaveLength(1);
    const id = invs.items[0].investigation.investigationId;
    const one = await investigationRoute(req(`/investigations/${id}?businessId=${TEST_BUSINESS}&simulationRunId=${RUN_A}`), { params: Promise.resolve({ id }) });
    expect(one.status).toBe(200);
    expect(Investigation.safeParse((await one.json()).investigation).success).toBe(true);
    expect((await investigationRoute(req(`/investigations/${id}?businessId=other_business`), { params: Promise.resolve({ id }) })).status).toBe(404);
    expect((await investigationRoute(req(`/investigations/${id}?businessId=${TEST_BUSINESS}&simulationRunId=${RUN_B}`), { params: Promise.resolve({ id }) })).status).toBe(404);
    expect((await investigationRoute(req("/investigations/inv_missing"), { params: Promise.resolve({ id: "inv_missing" }) })).status).toBe(404);
    const incidents = await (await incidentsRoute(req(`/incidents?businessId=${TEST_BUSINESS}&simulationRunId=${RUN_A}`))).json();
    expect(incidents.items[0].investigationPolicy.qualifies).toBe(true);
  });
});
