import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { getDb, getMongoClient, describeDbError } from "../src/lib/mongodb";
import { COLLECTIONS } from "../src/lib/collections";
import { startRun, tickRun, injectScenario } from "../src/simulator/runtime";
import { resolveSources } from "../src/intelligence/evidence/verification";
import type { CollectionSummary } from "../src/intelligence/evidence/orchestrator";
import type { EvidenceList, Trace, MonitorStatus } from "../src/components/normal/api";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const baseUrl = process.argv[2] ?? "http://localhost:3000";
const businessId = "nike_demo";
const simulationRunId = `demo_stage4_${Date.now()}`;
const scope = { businessId, simulationRunId };
const query = new URLSearchParams(scope).toString();

async function api<T>(path: string, data?: unknown): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.NORMAL_DEMO_KEY) headers["x-normal-demo-key"] = process.env.NORMAL_DEMO_KEY;
  const response = await fetch(`${baseUrl}${path}`, { headers, ...(data === undefined ? {} : { method: "POST", body: JSON.stringify(data) }) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function main() {
  const db = await getDb();
  const activeBefore = (await db.collection(COLLECTIONS.businesses).findOne({ businessId }))?.activeSimulationRunId;
  const worker = await api<MonitorStatus>(`/api/dev/monitor/run?${query}`);
  assert(worker.worker?.connected, "Start npm run monitor:watch first; this demonstration requires the standalone worker");
  await startRun({ businessId, simulationRunId, seed: 42, reset: false, makeActive: false });
  console.log(`Created isolated run ${simulationRunId}; active storefront selection is preserved.`);
  // Direct service calls deliberately bypass Next.js after(): the Change Stream worker must process these windows.
  for (const ticks of [36, 36]) await tickRun({ simulationRunId, ticks }, { businessId });
  await injectScenario({ simulationRunId, scenario: "ad_fatigue", severity: 0.8 }, businessId);
  await tickRun({ simulationRunId, ticks: 24 }, { businessId });
  const deadline = Date.now() + 180_000;
  let investigationId: string | undefined;
  let completedMonitoringJobs = 0;
  while (Date.now() < deadline) {
    const pending = await db.collection(COLLECTIONS.monitoringJobs).countDocuments({ ...scope, status: { $ne: "completed" } });
    const completed = await db.collection(COLLECTIONS.monitoringJobs).countDocuments({ ...scope, status: "completed" });
    const expectedWindows = await db.collection(COLLECTIONS.monitoringWindows).countDocuments(scope);
    const investigation = await db.collection(COLLECTIONS.investigations).findOne(scope);
    if (expectedWindows > 0 && pending === 0 && completed === expectedWindows && investigation) {
      investigationId = investigation.investigationId as string;
      completedMonitoringJobs = completed;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert(investigationId, "The standalone worker did not finish every persisted window and open an investigation within 180 seconds");
  const path = `/api/investigations/${investigationId}`;
  const collect = (collectionMode: "initial" | "refresh") => api<CollectionSummary>(`/api/dev/investigations/${investigationId}/collect-evidence`, { ...scope, collectionMode });
  const first = await collect("initial");
  assert.equal(first.status, "completed");
  assert(first.selectedTools.some((t) => t.tool === "advertising_analysis" && t.role === "primary"));
  const reused = await collect("initial");
  assert.equal(reused.reused, true);
  const refreshed = await collect("refresh");
  assert.equal(refreshed.status, "completed");
  assert.equal(refreshed.collectionId, first.collectionId);
  assert.deepEqual([...refreshed.evidenceIds].sort(), [...first.evidenceIds].sort());
  const evidence = await api<EvidenceList>(`${path}/evidence?${query}&limit=100`);
  const trace = await api<Trace>(`${path}/evidence-trace?${query}`);
  assert.equal(evidence.total, first.evidenceIds.length);
  assert.equal(trace.collections.length, 1);
  assert.equal(trace.toolRuns.length, first.selectedTools.length);
  assert(evidence.items.every((i) => i.verification?.passed));
  const refs = evidence.items.flatMap((i) => i.evidence.sourceRecords);
  const resolved = await resolveSources(db, scope, refs);
  assert.deepEqual(resolved.unresolved, []);
  const blob = JSON.stringify({ evidence, trace });
  for (const forbidden of ["plannedOutcome", "qualityScore", "activeScenario", "scenarioSeverity", "ad_fatigue", "delivery_delays", "promo_checkout_failure"]) assert(!blob.includes(forbidden), `Hidden simulator data leaked: ${forbidden}`);
  assert.equal((await db.collection(COLLECTIONS.businesses).findOne({ businessId }))?.activeSimulationRunId, activeBefore);
  console.log(JSON.stringify({ ...scope, investigationId, events: await db.collection(COLLECTIONS.businessEvents).countDocuments(scope),
    completedMonitoringJobs, evidence: evidence.total, toolRuns: trace.toolRuns.length, resolvedSources: resolved.resolved,
    collectionId: first.collectionId, refreshAttempt: trace.collections[0]?.attempt,
    dashboard: `${baseUrl}/dashboard?run=${simulationRunId}`, workspace: `${baseUrl}/dashboard/investigations/${investigationId}?run=${simulationRunId}` }, null, 2));
}

main().catch((error: unknown) => { console.error(describeDbError(error)); process.exitCode = 1; })
  .finally(async () => { if (globalThis._normalMongoClientPromise) await (await getMongoClient()).close(); });
