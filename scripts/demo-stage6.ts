/** Stage 6 acceptance: reuses saved diagnoses, records planning only, never executes actions. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDb, getMongoClient } from "../src/lib/mongodb";
import { COLLECTIONS } from "../src/lib/collections";
import { canonicalJson } from "../src/intelligence/evidence/provenance";
import { PLANNER_TASK, importAdvisoryArchive, plannerHandoff, readPlanning, runNextPlanning, selectStrategy } from "../src/planner/service";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const scope = { businessId: "nike_demo", simulationRunId: "stage5_1792885194280", investigationId: "inv_stage5_1792885194280_d07498fe5b17" };
const dir = process.env.E2E_ARTIFACT_DIR ? join(process.env.E2E_ARTIFACT_DIR, "docs/stage6-runs") : "docs/stage6-runs";
async function main() {
  const db = await getDb(); mkdirSync(dir, { recursive: true });
  const preserve = async () => {
    const records: Record<string, { count: number; hash: string }> = {};
    for (const collection of Object.values(COLLECTIONS)) {
      for (const run of ["demo_nike", scope.simulationRunId]) {
        if (run !== "demo_nike" && [COLLECTIONS.plans, COLLECTIONS.planningJobs].includes(collection as typeof COLLECTIONS.plans)) continue;
        const filter = collection === COLLECTIONS.simulatorGroundTruth ? { simulationRunId: run } : { businessId: "nike_demo", simulationRunId: run, ...(collection === COLLECTIONS.investigationCalls ? { task: { $ne: PLANNER_TASK } } : {}) };
        const hash = createHash("sha256"); let count = 0;
        for await (const doc of db.collection(collection).find(filter).sort({ _id: 1 })) { hash.update(canonicalJson(doc)); count++; }
        records[`${run}:${collection}`] = { count, hash: hash.digest("hex") };
      }
    }
    const business = await db.collection(COLLECTIONS.businesses).findOne({ businessId: "nike_demo" });
    return { records, active: business?.activeSimulationRunId, businessHash: createHash("sha256").update(canonicalJson(business)).digest("hex") };
  };
  if (process.argv.includes("--prepare")) {
    const before = await preserve();
    writeFileSync(`${dir}/preservation-before.json`, JSON.stringify(before, null, 2)); console.log(JSON.stringify({ scope, prepared: true, active: before.active })); return;
  }
  if (process.argv.includes("--checkout")) {
    const artifactPath = "docs/stage5-runs/s5eval_1792881375759_0_0.json";
    const raw = readFileSync(artifactPath, "utf8"), artifact = JSON.parse(raw), { state, report } = artifact.result;
    const checkout = { businessId: state.businessId, simulationRunId: state.simulationRunId, investigationId: state.investigationId };
    assert.equal(report.diagnosis.primaryCause, "discount_failure"); assert.equal(state.status, "completed");
    await importAdvisoryArchive(db, checkout, { state, report, evidence: [], artifactHash: createHash("sha256").update(raw).digest("hex") });
    await runNextPlanning(db, checkout);
    let result = await readPlanning(db, checkout);
    assert(result.job?.output, result.job?.error || "No checkout strategies");
    assert(result.job.output.strategies.every((strategy) => strategy.actions.length === 0), "Checkout repair must be advisory-only");
    result = await selectStrategy(db, checkout, result.job.output.recommendedKey);
    assert.equal(result.plan, null); assert.equal(result.job?.status, "advisory");
    writeFileSync(`${dir}/checkout-advisory.json`, JSON.stringify({ sourceArtifact: artifactPath, limitation: "Original run was cleaned after Stage 5. Saved validated report supports advice only; source references are archived, not freshly verified.", result }, null, 2));
    console.log(JSON.stringify({ checkout, status: result.job?.status, strategies: result.job?.output?.strategies.length, executablePlan: false, requests: result.calls.map((call) => call.metadata?.requestId) }));
  }
  const after = await preserve(), before = JSON.parse(readFileSync(`${dir}/preservation-before.json`, "utf8"));
  assert.deepEqual(after, before, "Business state, original investigator records or active selection changed");
  const result = await readPlanning(db, scope);
  let handoff = null;
  if (result.plan) {
    const doc = await db.collection(COLLECTIONS.plans).findOne({ ...scope, planId: result.plan.planId, planVersion: result.plan.planVersion }, { projection: { _id: 0 } });
    assert(doc); handoff = await plannerHandoff(db, doc);
  }
  writeFileSync(`${dir}/advertising-plan.json`, JSON.stringify({ scope, result, handoff }, null, 2));
  writeFileSync(`${dir}/preservation-after.json`, JSON.stringify({ passed: true, demoPreserved: true, businessStateUnchanged: true, stage5RecordsUnchanged: true, active: after.active, checkedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ status: result.job?.status, planId: result.plan?.planId, version: result.plan?.planVersion, requests: result.calls.map((call) => call.metadata?.requestId), handoffValid: Boolean(handoff), demoPreserved: true }));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(async () => { if (globalThis._normalMongoClientPromise) await (await getMongoClient()).close(); });
