import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Anomaly, Investigation } from "@normal/contracts";
import { GET as investigationRoute } from "@/app/api/investigations/[id]/route";
import { computeSnapshots } from "@/analytics/metrics";
import { COLLECTIONS } from "@/lib/collections";
import { getDb, getMongoClient } from "@/lib/mongodb";
import type { IncidentDoc } from "@/intelligence/detection/persistence";
import { scheduleAutoMonitor } from "@/intelligence/auto";
import { runMonitor } from "@/intelligence/monitor";
import { listAnomalies, listIncidents, listInvestigations } from "@/intelligence/queries";
import { injectScenario, startRun, tickRun } from "@/simulator/runtime";
import { TEST_BUSINESS, resetTestRun } from "../helpers";

/** Milestone 6 — complete detector-to-investigation workflow on Atlas with a held-out seed. */
const RUN = "t_det_flow";
const RUN_B = "t_det_flow_b";
const SEED = 808;
const T = (h: number) => new Date(Date.parse("2026-10-01T00:00:00.000Z") + h * 3_600_000).toISOString();
const strip = (d: Record<string, unknown>) => { const { _id: _i, simulationRunId: _r, ...rest } = d; void _i; void _r; return rest; };
const DEMO_KEY = "workflow-demo-key";

async function snapshotCounts() {
  const db = await getDb();
  const f = { businessId: TEST_BUSINESS, simulationRunId: RUN };
  return {
    anomalies: await db.collection(COLLECTIONS.anomalies).countDocuments(f),
    investigations: await db.collection(COLLECTIONS.investigations).countDocuments(f),
    incidents: await db.collection(COLLECTIONS.incidents).countDocuments(f),
    findings: await db.collection(COLLECTIONS.detectionFindings).countDocuments(f),
  };
}

describe("end-to-end detection workflow (Milestone 6)", () => {
  beforeAll(async () => {
    process.env.NORMAL_DEMO_MODE = "true"; process.env.NORMAL_DEMO_KEY = DEMO_KEY;
    for (const r of [RUN, RUN_B]) await resetTestRun(r);
  }, 120_000);
  afterAll(async () => {
    for (const r of [RUN, RUN_B]) await resetTestRun(r);
    delete process.env.NORMAL_DEMO_MODE; delete process.env.NORMAL_DEMO_KEY;
  }, 120_000);

  let baselineCtr = 0;
  let investigationId = "";

  it("1-4. healthy history: monitoring records no investigation; baseline metrics are recorded", async () => {
    await startRun({ businessId: TEST_BUSINESS, simulationRunId: RUN, seed: SEED, makeActive: false });
    for (let i = 0; i < 2; i++) await tickRun({ simulationRunId: RUN, ticks: 36 }, { businessId: TEST_BUSINESS });
    const s = await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN });
    expect(s.asOf).toBe(T(72));
    expect(s.persisted!.investigations.created).toEqual([]);
    expect(s.skippedChecks.length).toBeGreaterThan(0); // 24h/72h signals lack history this early: reported, not guessed
    const [base] = await computeSnapshots({ businessId: TEST_BUSINESS, simulationRunId: RUN, startAt: T(48), endAt: T(72), bucket: "window", dimension: {}, virtualTime: T(72) });
    baselineCtr = base.rates.ctr!;
    expect(baselineCtr).toBeGreaterThan(0.01);
  }, 600_000);

  it("5-10. advertising fatigue is injected; monitoring finds the observed deterioration, persists canonical anomalies and opens an investigation", async () => {
    await injectScenario({ simulationRunId: RUN, scenario: "ad_fatigue", severity: 0.8 }, TEST_BUSINESS);
    await tickRun({ simulationRunId: RUN, ticks: 24 }, { businessId: TEST_BUSINESS });
    const [after] = await computeSnapshots({ businessId: TEST_BUSINESS, simulationRunId: RUN, startAt: T(72), endAt: T(96), bucket: "window", dimension: {}, virtualTime: T(96) });
    expect(after.rates.ctr!).toBeLessThan(baselineCtr * 0.6);
    const s = await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN });
    expect(s.asOf).toBe(T(96));
    expect(s.persisted!.investigations.created).toHaveLength(1);
    investigationId = s.persisted!.investigations.created[0];
    const anomalies = await listAnomalies({ businessId: TEST_BUSINESS, simulationRunId: RUN, limit: 100 });
    expect(anomalies.total).toBeGreaterThan(2);
    for (const a of anomalies.items) expect(Anomaly.safeParse(a.anomaly).success).toBe(true);
    expect(anomalies.items.some((a) => a.anomaly.metric === "ctr" && a.anomaly.direction === "decrease")).toBe(true);
    for (const a of anomalies.items) expect(Date.parse(a.anomaly.detectedAt)).toBeGreaterThanOrEqual(Date.parse(T(72)));
    const invs = await listInvestigations({ businessId: TEST_BUSINESS, simulationRunId: RUN });
    expect(invs.total).toBe(1);
    expect(invs.items[0].investigation.title).toMatch(/Advertising performance deterioration/);
  }, 600_000);

  it("11-12. repeating the scan creates no duplicates", async () => {
    const before = await snapshotCounts();
    const s = await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN });
    expect(s.repeatScan).toBe(true);
    expect(await snapshotCounts()).toEqual(before);
  });

  it("13-14. the investigation is retrievable through its API and its evidence references resolve", async () => {
    const res = await investigationRoute(new Request(`http://localhost/api/investigations/${investigationId}?businessId=${TEST_BUSINESS}&simulationRunId=${RUN}`, { headers: { "x-normal-demo-key": DEMO_KEY } }), { params: Promise.resolve({ id: investigationId }) });
    expect(res.status).toBe(200);
    const bundle = await res.json();
    expect(Investigation.safeParse(bundle.investigation).success).toBe(true);
    expect(bundle.anomalies.length).toBe(bundle.investigation.anomalyIds.length);
    const db = await getDb();
    for (const ref of bundle.sourceRecords as Array<{ collection: string; recordId: string }>) {
      const key = ref.collection === COLLECTIONS.metricSnapshots ? "snapshotId" : "eventId";
      expect(await db.collection(ref.collection).countDocuments({ businessId: TEST_BUSINESS, [key]: ref.recordId }), `${ref.collection}:${ref.recordId}`).toBe(1);
    }
    for (const q of bundle.eventQueries as Array<{ filter: Record<string, unknown> }>) expect(await db.collection(COLLECTIONS.businessEvents).countDocuments(q.filter)).toBeGreaterThanOrEqual(0);
  });

  it("15-16. after an application restart the anomaly and investigation history is intact and scans stay idempotent", async () => {
    const before = await snapshotCounts();
    const client = await getMongoClient();
    await client.close();
    globalThis._normalMongoClientPromise = undefined;
    expect(await snapshotCounts()).toEqual(before);
    const inv = await (await getDb()).collection(COLLECTIONS.investigations).findOne({ investigationId });
    expect(Investigation.safeParse(strip(inv!)).success).toBe(true);
    const s = await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN });
    expect(s.repeatScan).toBe(true);
    expect(await snapshotCounts()).toEqual(before);
  });

  it("a continuing incident is updated, never duplicated, as time advances", async () => {
    await tickRun({ simulationRunId: RUN, ticks: 24 }, { businessId: TEST_BUSINESS });
    const s = await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN });
    expect(s.persisted!.investigations.created).toEqual([]);
    expect(s.persisted!.incidents.created).toBe(0);
    expect((await listInvestigations({ businessId: TEST_BUSINESS, simulationRunId: RUN })).total).toBe(1);
    const incident = (await listIncidents({ businessId: TEST_BUSINESS, simulationRunId: RUN, status: "investigating" })).items[0] as IncidentDoc;
    expect(incident.investigationId).toBe(investigationId);
  }, 600_000);

  it("17. a separate simulation run stays isolated", async () => {
    await startRun({ businessId: TEST_BUSINESS, simulationRunId: RUN_B, seed: SEED, makeActive: false });
    for (let i = 0; i < 2; i++) await tickRun({ simulationRunId: RUN_B, ticks: 40 }, { businessId: TEST_BUSINESS });
    const s = await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN_B });
    expect(s.persisted!.investigations.created).toEqual([]);
    expect((await listAnomalies({ businessId: TEST_BUSINESS, simulationRunId: RUN_B })).total).toBe(0);
    expect((await listInvestigations({ businessId: TEST_BUSINESS, simulationRunId: RUN })).total).toBe(1);
  }, 600_000);

  it("recovery: after the business returns to normal the incident and its anomalies resolve; the investigation is left for review", async () => {
    await injectScenario({ simulationRunId: RUN, scenario: "healthy", severity: 0 }, TEST_BUSINESS);
    for (let i = 0; i < 2; i++) await tickRun({ simulationRunId: RUN, ticks: 30 }, { businessId: TEST_BUSINESS });
    const s = await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN });
    expect(s.persisted!.investigations.created).toEqual([]);
    const db = await getDb();
    const incident = (await db.collection<IncidentDoc>(COLLECTIONS.incidents).findOne({ businessId: TEST_BUSINESS, simulationRunId: RUN, investigationId }))!;
    expect(incident.status).toBe("resolved");
    expect(incident.resolvedAt).not.toBeNull();
    expect(incident.history.some((h) => h.status === "investigating")).toBe(true);
    expect(incident.history.at(-1)!.status).toBe("resolved");
    const open = await listAnomalies({ businessId: TEST_BUSINESS, simulationRunId: RUN, status: "investigating" });
    expect(open.total).toBe(0);
    const resolved = await listAnomalies({ businessId: TEST_BUSINESS, simulationRunId: RUN, status: "resolved" });
    expect(resolved.total).toBeGreaterThan(2);
    const inv = await db.collection(COLLECTIONS.investigations).findOne({ investigationId });
    expect(inv!.status).toBe("open");
  }, 600_000);

  it("auto-monitoring after ticks is opt-in outside development and never runs outside a request scope", () => {
    expect(scheduleAutoMonitor(TEST_BUSINESS, RUN)).toBe(false);
    process.env.NORMAL_AUTO_MONITOR = "true";
    expect(scheduleAutoMonitor(TEST_BUSINESS, RUN)).toBe(false); // no request scope in a unit test → safely skipped
    delete process.env.NORMAL_AUTO_MONITOR;
  });
});
