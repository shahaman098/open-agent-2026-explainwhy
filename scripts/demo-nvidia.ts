import { mkdir, writeFile } from "node:fs/promises";
import { getDb, getMongoClient } from "../src/lib/mongodb";
import { COLLECTIONS } from "../src/lib/collections";
import { seedReferenceData } from "../src/reference/service";
import { startRun, getRunSummary, injectScenario, tickRun } from "../src/simulator/runtime";
import { runMonitor } from "../src/intelligence/monitor";
if (process.env.NODE_ENV === undefined) Object.assign(process.env, { NODE_ENV: "development" });
process.loadEnvFile(".env.local");
const businessId = "nvidia_demo", simulationRunId = "nvidia_channel_20261027", scope = { businessId, simulationRunId };
async function main() {
  const db = await getDb();
  await seedReferenceData(db, businessId);
  const existing = await db.collection(COLLECTIONS.simulatorState).findOne(scope);
  if (!existing) await startRun({ ...scope, seed: 61, makeActive: true, reset: false }, db);
  let summary = await getRunSummary(businessId, simulationRunId, db);
  while (summary.tickIndex < 72) { await tickRun({ simulationRunId, ticks: Math.min(36, 72 - summary.tickIndex) }, { businessId, db }); summary = await getRunSummary(businessId, simulationRunId, db); console.log("Baseline hours", summary.tickIndex); }
  if (summary.run.activeScenario === "healthy") { await runMonitor(scope, { db }); await injectScenario({ simulationRunId, scenario: "ad_fatigue", severity: .8 }, businessId, db); }
  summary = await getRunSummary(businessId, simulationRunId, db);
  while (summary.tickIndex < 108) { await tickRun({ simulationRunId, ticks: Math.min(36, 108 - summary.tickIndex) }, { businessId, db }); summary = await getRunSummary(businessId, simulationRunId, db); console.log("Synthetic operational hours", summary.tickIndex); }
  await runMonitor(scope, { db });
  const incidents = await db.collection(COLLECTIONS.incidents).find(scope).toArray();
  const target = incidents.find(incident => String(incident.title).includes("Advertising")) ?? incidents[0];
  const receipt = { ...scope, source: "Official NVIDIA financial disclosures plus independent synthetic UK GPU-channel operations", syntheticOperationalData: true, publicFinancials: "nvidia_q2_fy2027_results", ticks: summary.tickIndex, investigationId: target?.investigationId ?? null, dashboard: `/dashboard?businessId=${businessId}&run=${simulationRunId}`, counts: { events: await db.collection(COLLECTIONS.businessEvents).countDocuments(scope), orders: await db.collection(COLLECTIONS.simulatedOrders).countDocuments(scope), products: await db.collection(COLLECTIONS.simulatedProducts).countDocuments(scope), campaigns: await db.collection(COLLECTIONS.simulatedCampaigns).countDocuments(scope) } };
  await mkdir(".local/nvidia", { recursive: true }); await writeFile(".local/nvidia/dataset.json", JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (globalThis._explainwhyMongoClientPromise) await (await getMongoClient()).close(); });
