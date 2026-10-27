import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { Evidence, Investigation } from "@normal/contracts";
import { GET as evidenceRoute } from "@/app/api/investigations/[id]/evidence/route";
import { GET as traceRoute } from "@/app/api/investigations/[id]/evidence-trace/route";
import { POST as collectRoute } from "@/app/api/dev/investigations/[id]/collect-evidence/route";
import { GET as capabilitiesRoute } from "@/app/api/intelligence/capabilities/route";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { ingestEvents } from "@/ingestion/service";
import { snapshotTickWindows } from "@/analytics/metrics";
import { deleteRun } from "@/simulator/persistence";
import { harnessCatalogue, simulate } from "@/intelligence/evaluation/harness";
import { publishWindow } from "@/intelligence/monitoring/windows";
import { reconcileWindows } from "@/intelligence/monitoring/recovery";
import { drainJobs } from "@/intelligence/monitoring/process";
import { loadInvestigationContext } from "@/intelligence/evidence/context";
import { collectInvestigationEvidence, executeTool } from "@/intelligence/evidence/orchestrator";
import { selectTools } from "@/intelligence/evidence/policies";
import { getTool, listTools } from "@/intelligence/evidence/registry";
import { listInvestigationEvidence, getEvidenceTrace } from "@/intelligence/evidence/queries";
import { resolveSources } from "@/intelligence/evidence/verification";
import { TOOL_NAMES } from "@/intelligence/evidence/types";
import { RevenueInput } from "@/intelligence/evidence/tools/revenue";

const BUSINESS = "nike_eval";
const RUN = `t_evidence_${randomUUID().replaceAll("-", "")}`;
const OTHER_RUN = `${RUN}_other`;
const scope = { businessId: BUSINESS, simulationRunId: RUN };
const t = (h: number) => new Date(Date.parse("2026-10-01T00:00:00.000Z") + h * 3_600_000).toISOString();
const DEMO_KEY = "evidence-demo-key";
const req = (path: string, init: RequestInit & { json?: unknown; demo?: boolean } = {}) => {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  if (init.demo !== false) headers.set("x-normal-demo-key", DEMO_KEY);
  return new Request(`http://localhost/api${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined });
};
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const FORBIDDEN = ["plannedOutcome", "qualityScore", "popularity", "activeScenario", "scenarioSeverity", "drivers", "ad_fatigue", "delivery_delays", "viral_demand", "negative_reviews", "promo_checkout_failure"];

let db: Db;
let investigationId: string;
describe("autonomous evidence retrieval (Stage 4)", () => {
  beforeAll(async () => {
    db = await getDb(); await ensureIndexes(db);
    process.env.NORMAL_DEMO_MODE = "true"; process.env.NORMAL_DEMO_KEY = DEMO_KEY;
    // Real deterministic simulator events; only this harness sees the injection. The detector then opens the investigation itself.
    const timeline = simulate({ seed: 808, simulationRunId: RUN, healthyHours: 72, scenario: "ad_fatigue", severity: 0.8, scenarioHours: 24 });
    expect((await ingestEvents(timeline.events, { businessId: BUSINESS, db })).result.rejected).toBe(0);
    await db.collection(COLLECTIONS.simulatedProducts).insertMany([...harnessCatalogue()].map(([productId, label]) => ({ ...scope, productId, ...label })));
    for (const [a, b] of [[0, 72], [72, 96]] as const) {
      const snapshotIds = await snapshotTickWindows(BUSINESS, RUN, [{ startAt: t(a), endAt: t(b) }], t(b), db);
      await publishWindow(db, { ...scope, windowStart: t(a), windowEnd: t(b), snapshotIds });
    }
    // Process through the durable job queue (contention-safe if a watcher is also running), then wait for completion.
    await reconcileWindows(db, scope);
    for (let i = 0; i < 60; i++) {
      await drainJobs(db, scope);
      if ((await db.collection(COLLECTIONS.monitoringJobs).countDocuments({ ...scope, status: "completed" })) >= 2) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    const inv = await db.collection(COLLECTIONS.investigations).findOne(scope, { projection: { investigationId: 1 } });
    expect(inv).toBeTruthy(); investigationId = inv!.investigationId as string;
    // A second, unrelated run for isolation checks.
    const other = simulate({ seed: 11, simulationRunId: OTHER_RUN, healthyHours: 48, scenario: "healthy", severity: 0, scenarioHours: 0 });
    await ingestEvents(other.events, { businessId: BUSINESS, db });
    const otherIds = await snapshotTickWindows(BUSINESS, OTHER_RUN, [{ startAt: t(0), endAt: t(48) }], t(48), db);
    await publishWindow(db, { businessId: BUSINESS, simulationRunId: OTHER_RUN, windowStart: t(0), windowEnd: t(48), snapshotIds: otherIds });
  }, 240_000);
  afterAll(async () => {
    delete process.env.NORMAL_DEMO_MODE; delete process.env.NORMAL_DEMO_KEY;
    if (!db) return;
    for (const run of [RUN, OTHER_RUN]) {
      await deleteRun(db, BUSINESS, run);
      for (const c of [COLLECTIONS.evidence, COLLECTIONS.evidenceDetails, COLLECTIONS.evidenceCollections, COLLECTIONS.evidenceToolRuns]) await db.collection(c).deleteMany({ businessId: BUSINESS, simulationRunId: run });
    }
  }, 120_000);

  it("registers eight read-only tools with strict inputs that reject widened scope, long windows and unknown keys", () => {
    expect(listTools().map((x) => x.name).sort()).toEqual([...TOOL_NAMES].sort());
    const base = { ...scope, window: { startAt: t(72), endAt: t(96) } };
    expect(RevenueInput.safeParse(base).success).toBe(true);
    expect(RevenueInput.safeParse({ ...base, window: { startAt: t(0), endAt: t(15 * 24) } }).success).toBe(false);
    expect(RevenueInput.safeParse({ ...base, window: { startAt: t(96), endAt: t(72) } }).success).toBe(false);
    expect(RevenueInput.safeParse({ ...base, collection: "simulator_state" }).success).toBe(false);
    expect(RevenueInput.safeParse({ ...base, businessId: "nike demo" }).success).toBe(false);
    expect(RevenueInput.safeParse({ ...base, limit: 10_000 }).success).toBe(false);
    expect(getTool("advertising_analysis").input.safeParse({ ...base, campaignIds: Array.from({ length: 21 }, (_, i) => `c${i}`) }).success).toBe(false);
  });

  it("routes deterministically from observed signals: advertising, revenue and checkout first, alternatives next, context last", async () => {
    const ctx = (await loadInvestigationContext(db, investigationId, { businessId: BUSINESS }))!;
    expect(ctx.simulationRunId).toBe(RUN);
    expect(ctx.cutoff).toBe(t(96));
    expect(ctx.incidentWindow.endAt <= ctx.cutoff).toBe(true);
    expect(ctx.baselineWindow!.endAt).toBe(ctx.incidentWindow.startAt);
    const a = selectTools(ctx), b = selectTools(ctx);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(8);
    const primary = a.filter((s) => s.role === "primary").map((s) => s.tool);
    expect(primary).toEqual(expect.arrayContaining(["revenue_analysis", "advertising_analysis", "checkout_analysis"]));
    expect(a.filter((s) => s.role === "alternative_explanation").map((s) => s.tool)).toEqual(expect.arrayContaining(["inventory_analysis", "shipping_analysis"]));
    expect(a.map((s) => s.tool)).toEqual(expect.arrayContaining(["historical_incidents", "public_reference_context"]));
    const roles = a.map((s) => s.role);
    expect(roles.lastIndexOf("primary")).toBeLessThan(roles.indexOf("alternative_explanation"));
    for (const s of a) { expect(s.input).toMatchObject(scope); for (const token of FORBIDDEN) expect(JSON.stringify(s)).not.toContain(token); }
    const ads = a.find((s) => s.tool === "advertising_analysis")!;
    expect((ads.input.campaignIds as string[]).length).toBeGreaterThan(0);
  });

  it("collects verified canonical evidence, links it to the investigation and stores traces", async () => {
    const summary = await collectInvestigationEvidence({ investigationId, businessId: BUSINESS }, { db });
    expect(summary.reused).toBe(false);
    expect(["completed", "partial"]).toContain(summary.status);
    expect(summary.outcomes.filter((o) => o.status === "failed")).toEqual([]);
    expect(summary.outcomes.filter((o) => o.status === "completed").map((o) => o.tool)).toEqual(expect.arrayContaining(["revenue_analysis", "advertising_analysis", "checkout_analysis", "inventory_analysis"]));
    expect(summary.outcomes.find((o) => o.tool === "historical_incidents")!.status).toBe("empty");
    expect(summary.evidenceIds.length).toBeGreaterThanOrEqual(4);
    const docs = await db.collection(COLLECTIONS.evidence).find({ ...scope, investigationId }, { projection: { _id: 0, simulationRunId: 0 } }).toArray();
    expect(docs.map((d) => d.evidenceId).sort()).toEqual([...summary.evidenceIds].sort());
    for (const d of docs) expect(Evidence.safeParse(d).success, d.evidenceId).toBe(true);
    const inv = Investigation.parse(await db.collection(COLLECTIONS.investigations).findOne({ businessId: BUSINESS, investigationId }, { projection: { _id: 0, simulationRunId: 0 } }));
    expect(inv.status).toBe("collecting_evidence");
    expect(inv.evidenceIds).toEqual(expect.arrayContaining(summary.evidenceIds));
    const details = await db.collection(COLLECTIONS.evidenceDetails).find({ ...scope, investigationId }).toArray();
    expect(details).toHaveLength(docs.length);
    for (const d of details) { expect(d.verification.passed).toBe(true); expect(d.verification.checks.every((c: { passed: boolean }) => c.passed)).toBe(true); }
    const runs = await db.collection(COLLECTIONS.evidenceToolRuns).find({ collectionId: summary.collectionId }).toArray();
    expect(runs).toHaveLength(summary.selectedTools.length);
    for (const r of runs) { expect(r.durationMs).toBeGreaterThanOrEqual(0); expect(r.input).toMatchObject(scope); expect(r.dataSources.length).toBeGreaterThan(0); }
  });

  it("isolates collection identity when two businesses have the same investigation, run and cutoff", async () => {
    const foreign = { businessId: "nike_evidence_other", simulationRunId: RUN };
    const copied = [COLLECTIONS.businessEvents, COLLECTIONS.metricSnapshots, COLLECTIONS.investigations, COLLECTIONS.anomalies, COLLECTIONS.simulatedProducts];
    try {
      for (const name of copied) {
        const filter = name === COLLECTIONS.businessEvents ? { ...scope, type: "ad.metrics_observed" } : scope;
        const docs = await db.collection(name).find(filter, { projection: { _id: 0 } }).toArray();
        if (docs.length) await db.collection(name).insertMany(docs.map((d) => ({ ...d, businessId: foreign.businessId })));
      }
      const ready = await db.collection(COLLECTIONS.monitoringWindows).findOne(scope, { sort: { windowEnd: -1 }, projection: { _id: 0 } });
      await db.collection(COLLECTIONS.monitoringWindows).insertOne({ ...ready, ...foreign, windowKey: `foreign_${RUN}` });
      const original = await collectInvestigationEvidence({ ...scope, investigationId }, { db });
      const other = await collectInvestigationEvidence({ ...foreign, investigationId }, { db });
      expect(other.reused).toBe(false);
      expect(other.businessId).toBe(foreign.businessId);
      expect(other.collectionId).not.toBe(original.collectionId);
      expect(other.evidenceIds.length).toBeGreaterThan(0);
      const trace = (await getEvidenceTrace(investigationId, foreign, db))!;
      expect(trace.collections).toHaveLength(1);
      expect(trace.toolRuns.every((r) => r.businessId === foreign.businessId && r.input.businessId === foreign.businessId)).toBe(true);
      const again = await collectInvestigationEvidence({ ...scope, investigationId }, { db });
      expect(again.reused).toBe(true);
      expect(again.collectionId).toBe(original.collectionId);
      expect(again.businessId).toBe(BUSINESS);
    } finally {
      for (const name of [...copied, COLLECTIONS.monitoringWindows, COLLECTIONS.evidence, COLLECTIONS.evidenceDetails, COLLECTIONS.evidenceCollections, COLLECTIONS.evidenceToolRuns]) {
        await db.collection(name).deleteMany(foreign);
      }
    }
  });

  it("every source reference resolves in the correct scope and no hidden simulator field reaches the evidence", async () => {
    const docs = await db.collection(COLLECTIONS.evidence).find({ ...scope, investigationId }, { projection: { _id: 0 } }).toArray();
    const refs = docs.flatMap((d) => d.sourceRecords as Array<{ collection: string; recordId: string }>);
    expect(refs.length).toBeGreaterThan(50);
    const resolved = await resolveSources(db, scope, refs);
    expect(resolved.unresolved).toEqual([]);
    expect(resolved.resolved).toBe(new Set(refs.map((r) => `${r.collection}:${r.recordId}`)).size);
    // The same references do NOT resolve in another run: evidence is run-scoped.
    const foreign = await resolveSources(db, { businessId: BUSINESS, simulationRunId: OTHER_RUN }, refs.filter((r) => r.collection === COLLECTIONS.businessEvents).slice(0, 20));
    expect(foreign.resolved).toBe(0);
    const details = await db.collection(COLLECTIONS.evidenceDetails).find({ ...scope, investigationId }, { projection: { _id: 0 } }).toArray();
    const blob = JSON.stringify({ docs, details });
    for (const token of FORBIDDEN) expect(blob, token).not.toContain(token);
    for (const d of docs.filter((x) => details.find((y) => y.evidenceId === x.evidenceId)?.dataOrigin === "simulated")) expect(`${d.observation}`).toMatch(/simulat/i);
  });

  it("calculated values reconcile with the canonical records they cite", async () => {
    const details = await db.collection(COLLECTIONS.evidenceDetails).find({ ...scope, investigationId }, { projection: { _id: 0 } }).toArray();
    const evidence = new Map((await db.collection(COLLECTIONS.evidence).find({ ...scope, investigationId }, { projection: { _id: 0 } }).toArray()).map((d) => [d.evidenceId as string, d]));
    const revenue = details.find((d) => d.tool === "revenue_analysis")!;
    const ads = details.find((d) => d.tool === "advertising_analysis" && d.detail?.affected)!;
    const w = evidence.get(revenue.evidenceId)!.window as { startAt: string; endAt: string };
    const orders = await db.collection(COLLECTIONS.businessEvents).find({ ...scope, type: "order.completed", occurredAt: { $gte: w.startAt, $lt: w.endAt } }).toArray();
    const measure = (id: string, metric: string) => (evidence.get(id)!.measurements as Array<{ metric: string; value: number }>).find((m) => m.metric === metric)!.value;
    expect(measure(revenue.evidenceId, "orders")).toBe(orders.length);
    expect(measure(revenue.evidenceId, "net_revenue_minor")).toBe(orders.reduce((a, e) => a + (e.payload as { netRevenueMinor: number }).netRevenueMinor, 0));
    expect(measure(revenue.evidenceId, "sessions")).toBe(await db.collection(COLLECTIONS.businessEvents).countDocuments({ ...scope, type: "web.session_started", occurredAt: { $gte: w.startAt, $lt: w.endAt } }));
    const adW = evidence.get(ads.evidenceId)!.window as { startAt: string; endAt: string };
    const adRows = await db.collection(COLLECTIONS.businessEvents).aggregate<{ clicks: number; impressions: number }>([
      { $match: { ...scope, type: "ad.metrics_observed", "payload.window.startAt": { $gte: adW.startAt, $lt: adW.endAt } } },
      { $group: { _id: { c: "$payload.campaignId", s: "$payload.window.startAt" }, clicks: { $first: "$payload.clicks" }, impressions: { $first: "$payload.impressions" } } },
      { $group: { _id: null, clicks: { $sum: "$clicks" }, impressions: { $sum: "$impressions" } } },
    ]).toArray();
    expect(measure(ads.evidenceId, "clicks")).toBe(adRows[0]!.clicks);
    expect(measure(ads.evidenceId, "ctr")).toBeCloseTo(adRows[0]!.clicks / adRows[0]!.impressions, 4);
    // The affected campaigns' CTR fell versus baseline, which is what the detector observed.
    const ctr = (evidence.get(ads.evidenceId)!.measurements as Array<{ metric: string; value: number; baseline?: number }>).find((m) => m.metric === "ctr")!;
    expect(ctr.value).toBeLessThan(ctr.baseline! * 0.6);
  });

  it("re-running at the same cutoff reuses the collection; refresh re-executes in place without duplicates", async () => {
    const before = await db.collection(COLLECTIONS.evidence).countDocuments({ ...scope, investigationId });
    const again = await collectInvestigationEvidence({ investigationId, businessId: BUSINESS, simulationRunId: RUN }, { db });
    expect(again.reused).toBe(true);
    const refreshed = await collectInvestigationEvidence({ investigationId, businessId: BUSINESS, collectionMode: "refresh" }, { db });
    expect(refreshed.reused).toBe(false);
    expect(refreshed.collectionId).toBe(again.collectionId);
    expect([...refreshed.evidenceIds].sort()).toEqual([...again.evidenceIds].sort());
    expect(await db.collection(COLLECTIONS.evidence).countDocuments({ ...scope, investigationId })).toBe(before);
    expect(await db.collection(COLLECTIONS.evidenceCollections).countDocuments({ ...scope, investigationId })).toBe(1);
    expect(await db.collection(COLLECTIONS.evidenceToolRuns).countDocuments({ collectionId: again.collectionId })).toBe(refreshed.selectedTools.length);
    expect((await db.collection(COLLECTIONS.evidenceCollections).findOne({ collectionId: again.collectionId }))!.attempt).toBe(2);
  });

  it("concurrent refreshes never duplicate: at most one runs, the other is told it is in progress", async () => {
    const before = await db.collection(COLLECTIONS.evidence).countDocuments({ ...scope, investigationId });
    const results = await Promise.allSettled([
      collectInvestigationEvidence({ investigationId, businessId: BUSINESS, collectionMode: "refresh" }, { db }),
      collectInvestigationEvidence({ investigationId, businessId: BUSINESS, collectionMode: "refresh" }, { db }),
    ]);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    for (const r of rejected) expect((r.reason as { code: string }).code).toBe("evidence_collection_in_progress");
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(await db.collection(COLLECTIONS.evidence).countDocuments({ ...scope, investigationId })).toBe(before);
    expect(await db.collection(COLLECTIONS.evidenceCollections).countDocuments({ ...scope, investigationId })).toBe(1);
  });

  it("a failing or invalid tool call is recorded as a failure and leaves other evidence intact", async () => {
    const ctx = (await loadInvestigationContext(db, investigationId, { businessId: BUSINESS }))!;
    const bad = await executeTool(ctx, { tool: "revenue_analysis", role: "primary", reason: "test", input: { ...scope, window: { startAt: t(0), endAt: t(400) } } }, "evc_test_failure");
    expect(bad.status).toBe("failed");
    expect(bad.error).toMatch(/window may not exceed/);
    const widened = await executeTool(ctx, { tool: "revenue_analysis", role: "primary", reason: "test", input: { businessId: BUSINESS, simulationRunId: OTHER_RUN, window: { startAt: t(0), endAt: t(24) } } }, "evc_test_failure");
    expect(widened.status).toBe("failed");
    expect(widened.error).toMatch(/scope differs/);
    const runs = await db.collection(COLLECTIONS.evidenceToolRuns).find({ collectionId: "evc_test_failure" }).toArray();
    expect(runs.map((r) => r.status)).toEqual(["failed", "failed"]);
    await db.collection(COLLECTIONS.evidenceToolRuns).deleteMany({ collectionId: "evc_test_failure" });
    expect(await db.collection(COLLECTIONS.evidence).countDocuments({ ...scope, investigationId })).toBeGreaterThanOrEqual(4);
  });

  it("clamps windows to the data cutoff and reports empty data explicitly instead of zeros", async () => {
    const ctx = (await loadInvestigationContext(db, investigationId, { businessId: BUSINESS }))!;
    const beyond = await executeTool(ctx, { tool: "revenue_analysis", role: "primary", reason: "test", input: { ...scope, window: { startAt: t(90), endAt: t(120) } } }, "evc_test_clamp");
    expect(beyond.status).toBe("completed");
    const ev = await db.collection(COLLECTIONS.evidence).findOne({ businessId: BUSINESS, evidenceId: beyond.evidenceIds[0] });
    expect((ev!.window as { endAt: string }).endAt).toBe(t(96));
    const reviews = await executeTool(ctx, { tool: "customer_feedback_analysis", role: "primary", reason: "test", input: { ...scope, window: { startAt: t(0), endAt: t(1) }, productIds: [] } }, "evc_test_clamp");
    expect(reviews.status).toBe("empty");
    expect(reviews.emptyResult).toMatch(/No reviews/);
    const shipping = await executeTool(ctx, { tool: "shipping_analysis", role: "primary", reason: "test", input: { ...scope, window: { startAt: t(72), endAt: t(96) }, baselineWindow: { startAt: t(0), endAt: t(72) } } }, "evc_test_clamp");
    expect(shipping.status).toBe("completed");
    const ship = await db.collection(COLLECTIONS.evidence).findOne({ businessId: BUSINESS, evidenceId: shipping.evidenceIds[0] });
    const due = (ship!.measurements as Array<{ metric: string; value: number }>).find((m) => m.metric === "promises_due")!;
    // Only hourly global snapshots: the detector also persists multi-hour global snapshots as anomaly evidence.
    const cohort = await db.collection(COLLECTIONS.metricSnapshots).aggregate<{ due: number }>([
      { $match: { ...scope, dimension: {}, "window.startAt": { $gte: t(72), $lt: t(96) }, $expr: { $eq: [{ $dateDiff: { startDate: { $toDate: "$window.startAt" }, endDate: { $toDate: "$window.endAt" }, unit: "hour" } }, 1] } } },
      { $group: { _id: null, due: { $sum: "$counters.shipments" } } }]).toArray();
    expect(due.value).toBe(cohort[0]?.due ?? 0);
    for (const id of [...beyond.evidenceIds, ...shipping.evidenceIds]) { await db.collection(COLLECTIONS.evidence).deleteOne({ evidenceId: id }); await db.collection(COLLECTIONS.evidenceDetails).deleteOne({ evidenceId: id }); }
    await db.collection(COLLECTIONS.evidenceToolRuns).deleteMany({ collectionId: "evc_test_clamp" });
  });

  it("read APIs are scoped, filterable and paginated; the collect route is protected", async () => {
    const list = (await listInvestigationEvidence(investigationId, { businessId: BUSINESS, simulationRunId: RUN, limit: 2 }, db))!;
    expect(list.items).toHaveLength(2); expect(list.total).toBeGreaterThanOrEqual(4);
    expect((await listInvestigationEvidence(investigationId, { businessId: BUSINESS, simulationRunId: OTHER_RUN }, db))).toBeNull();
    expect((await listInvestigationEvidence(investigationId, { businessId: "nike_demo" }, db))).toBeNull();
    const ads = (await listInvestigationEvidence(investigationId, { businessId: BUSINESS, tool: "advertising_analysis" }, db))!;
    expect(ads.items.every((i) => i.tool === "advertising_analysis" && i.evidence.category === "advertising")).toBe(true);
    const trace = (await getEvidenceTrace(investigationId, { businessId: BUSINESS }, db))!;
    expect(trace.collections).toHaveLength(1); expect(trace.toolRuns.length).toBe(trace.collections[0]!.selectedTools.length);

    process.env.NORMAL_DEMO_MODE = "false";
    expect((await collectRoute(req(`/dev/investigations/${investigationId}/collect-evidence`, { method: "POST", json: {}, demo: false }), params(investigationId))).status).toBe(404);
    expect((await evidenceRoute(req(`/investigations/${investigationId}/evidence?businessId=${BUSINESS}`, { demo: false }), params(investigationId))).status).toBe(404);
    process.env.NORMAL_DEMO_MODE = "true";
    const res = await evidenceRoute(req(`/investigations/${investigationId}/evidence?businessId=${BUSINESS}&category=sales`), params(investigationId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.every((i: { evidence: { category: string } }) => i.evidence.category === "sales")).toBe(true);
    expect((await evidenceRoute(req(`/investigations/${investigationId}/evidence?businessId=${BUSINESS}&tool=drop_table`), params(investigationId))).status).toBe(400);
    expect((await evidenceRoute(req(`/investigations/${investigationId}/evidence?businessId=nike_demo`), params(investigationId))).status).toBe(404);
    expect((await traceRoute(req(`/investigations/${investigationId}/evidence-trace?businessId=${BUSINESS}`), params(investigationId))).status).toBe(200);
    const again = await collectRoute(req(`/dev/investigations/${investigationId}/collect-evidence`, { method: "POST", json: { businessId: BUSINESS } }), params(investigationId));
    expect(again.status).toBe(200); expect((await again.json()).reused).toBe(true);
    expect((await collectRoute(req(`/dev/investigations/${investigationId}/collect-evidence`, { method: "POST", json: { businessId: BUSINESS, collectionMode: "bogus" } }), params(investigationId))).status).toBe(400);
    expect((await collectRoute(req(`/dev/investigations/inv_missing/collect-evidence`, { method: "POST", json: { businessId: BUSINESS } }), params("inv_missing"))).status).toBe(404);
    const caps = await (await capabilitiesRoute(req(`/intelligence/capabilities?businessId=${BUSINESS}&simulationRunId=${RUN}`))).json();
    expect(caps.stages.map((s: { id: string }) => s.id)).toEqual(["observe", "detect", "retrieve", "investigate", "plan", "approve", "execute", "verify", "learn"]);
    expect(caps.stages.find((s: { id: string }) => s.id === "retrieve").status).toBe("operational");
    expect(caps.stages.filter((s: { implemented: boolean }) => !s.implemented).every((s: { status: string }) => ["not_implemented", "partner_pending"].includes(s.status))).toBe(true);
    expect(caps.tools).toHaveLength(8);
  });
});
