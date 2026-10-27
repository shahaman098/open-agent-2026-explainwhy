import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getDb, getMongoClient } from "../src/lib/mongodb";
import { COLLECTIONS } from "../src/lib/collections";
import { ANALYSIS_COLLECTIONS, WORKER_ID, claimAnalysisWorker, ensureAnalysisIndexes, localAnalysisConfig, processNextAnalysis, reconcileAnalysis, renewRunningAnalysis, watchAnalysis, type AnalysisWatch } from "../src/intelligence/dashboard/store";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const token = randomUUID(); let stopped = false, inFlight: Promise<unknown> | null = null;
process.once("SIGINT", () => { stopped = true; }); process.once("SIGTERM", () => { stopped = true; });
async function main() {
  const config = localAnalysisConfig(), db = await getDb(); await ensureAnalysisIndexes(db);
  const business = process.argv.find(arg => arg.startsWith("--business="))?.slice(11);
  console.log(`[analysis] Watching database changes; local model ${config.investigatorModel}; poll 3s, debounce 3s`);
  do {
    if (await claimAnalysisWorker(db, token)) {
      await renewRunningAnalysis(db, token);
      const businesses = await db.collection(COLLECTIONS.businesses).find({ ...(business ? { businessId: business } : {}), activeSimulationRunId: { $type: "string" } }, { projection: { businessId: 1, activeSimulationRunId: 1 } }).toArray();
      for (const item of businesses) if (item.activeSimulationRunId) {
        const scope = { businessId: String(item.businessId), simulationRunId: String(item.activeSimulationRunId) };
        if (!await db.collection(ANALYSIS_COLLECTIONS.watches).findOne(scope)) await watchAnalysis(db, scope);
      }
      const watches = await db.collection<AnalysisWatch>(ANALYSIS_COLLECTIONS.watches).find({ enabled: true }).toArray();
      for (const watch of watches) {
        try { await reconcileAnalysis(db, { businessId: watch.businessId, simulationRunId: watch.simulationRunId }); }
        catch (error) { await db.collection(ANALYSIS_COLLECTIONS.watches).updateOne({ businessId: watch.businessId, simulationRunId: watch.simulationRunId }, { $set: { state: "failed", error: error instanceof Error ? error.message.slice(0, 220) : "Analysis snapshot failed" } }); }
      }
      if (!inFlight) inFlight = processNextAnalysis(db, token).catch(error => console.error("[analysis] worker cycle failed", error instanceof Error ? error.name : "error")).finally(() => { inFlight = null; });
    }
    if (process.argv.includes("--once")) { await inFlight; break; }
    await new Promise(resolve => setTimeout(resolve, 3000));
  } while (!stopped);
  await inFlight;
  await db.collection(ANALYSIS_COLLECTIONS.workers).updateOne({ workerId: WORKER_ID, token }, { $set: { leaseUntil: new Date().toISOString() } });
}
void main().catch(error => { console.error("[analysis] stopped:", error instanceof Error ? error.message : "Configuration or database failure"); process.exitCode = 1; }).finally(async () => { if (globalThis._explainwhyMongoClientPromise) await (await getMongoClient()).close(); });
