import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { getDb, getMongoClient } from "../src/lib/mongodb";
import { COLLECTIONS } from "../src/lib/collections";
import { startRun, tickRun, injectScenario } from "../src/simulator/runtime";
import { runMonitor } from "../src/intelligence/monitor";
import { startInvestigation, readInvestigation, digest } from "../src/intelligence/investigator/store";
import { runNextInvestigation } from "../src/intelligence/investigator/controller";
import { loadVerifiedEvidence } from "../src/intelligence/investigator/validation";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
// EVALUATION HARNESS ONLY: scenario is used for injection and AFTER inference, never passed into the controller.
const scenario = process.argv.includes("--checkout") ? "promo_checkout_failure" : "ad_fatigue";
const resume = process.argv.find((a) => a.startsWith("--run="))?.slice(6);
const businessId = "nike_demo", simulationRunId = resume || `stage5_${Date.now()}`;
const scope = { businessId, simulationRunId };
async function main() {
  const db = await getDb();
  const preserve = async () => {
    const counts = [];
    for (const name of Object.values(COLLECTIONS)) {
      const hash = createHash("sha256"); let count = 0;
      const filter = name === COLLECTIONS.simulatorGroundTruth ? { simulationRunId: "demo_nike" } : { businessId, simulationRunId: "demo_nike" };
      for await (const doc of db.collection(name).find(filter).sort({ _id: 1 })) { hash.update(digest(doc)); count++; }
      counts.push([name, count, hash.digest("hex")]);
    }
    const state = await db.collection(COLLECTIONS.simulatorState).findOne({ businessId, simulationRunId: "demo_nike" });
    const active = (await db.collection(COLLECTIONS.businesses).findOne({ businessId }))?.activeSimulationRunId;
    return { counts, stateHash: digest(state), active };
  };
  const preparationPath = `docs/stage5-runs/${simulationRunId}_prepared.json`;
  const before = resume && !process.argv.includes("--prepare") && existsSync(preparationPath) ? JSON.parse(readFileSync(preparationPath, "utf8")).preservedDemo : await preserve();
  console.log(JSON.stringify({ phase: "start", ...scope, resumed: Boolean(resume) }));
  if (!resume) {
    await startRun({ ...scope, seed: 42, reset: false, makeActive: false });
    for (const ticks of [36, 36]) { await tickRun({ simulationRunId, ticks }, { businessId }); console.log(`Advanced ${ticks} baseline hours`); }
    await runMonitor(scope);
    await injectScenario({ simulationRunId, scenario, severity: 0.85 }, businessId);
    for (const ticks of (scenario === "promo_checkout_failure" ? [36, 36, 24] : [36])) await tickRun({ simulationRunId, ticks }, { businessId });
    await runMonitor(scope);
  }
  const advance = Number(process.argv.find((a) => a.startsWith("--advance="))?.slice(10) || 0);
  if (advance > 0 && advance <= 168) { for (let remaining = advance; remaining > 0; remaining -= 36) await tickRun({ simulationRunId, ticks: Math.min(36, remaining) }, { businessId }); await runMonitor(scope); }
  const incidents = await db.collection(COLLECTIONS.incidents).find(scope).toArray();
  const incident = incidents.find((i) => i.themes?.includes(scenario === "ad_fatigue" ? "advertising" : "conversion")) || incidents[0];
  assert(incident?.investigationId, "No appropriate detected incident available");
  const target = { ...scope, investigationId: incident.investigationId as string };
  if (process.argv.includes("--prepare")) {
    assert.deepEqual(await preserve(), before, "demo_nike or active selection changed during preparation");
    mkdirSync("docs/stage5-runs", { recursive: true });
    writeFileSync(preparationPath, JSON.stringify({ ...target, preservedDemo: before, workspace: `/dashboard/investigations/${target.investigationId}?run=${simulationRunId}` }, null, 2));
    console.log(JSON.stringify({ phase: "prepared", ...target, preparationPath }));
    return;
  }
  const job = await startInvestigation(db, target);
  console.log(JSON.stringify({ phase: "queued", ...target, jobId: job.jobId }));
  await runNextInvestigation(db, target);
  const result = await readInvestigation(db, target);
  const after = await preserve();
  assert.deepEqual(after, before, "demo_nike or active selection changed");
  assert(result.report, `Report unavailable: ${result.state?.error}`);
  const verified = await loadVerifiedEvidence(db, target, result.state!.evidenceIds, result.state!.cutoff);
  const cited = new Set(result.report.diagnosis.hypotheses.flatMap((h) => [...h.evidenceIds, ...h.counterEvidenceIds]));
  assert([...cited].every((id) => verified.evidence.some((e) => e.evidenceId === id)), "Unresolved citation");
  const metrics = { ...target, jobId: job.jobId, status: result.state!.status, primaryCause: result.report.diagnosis.primaryCause, expectedScenarioAfterInference: scenario, canonicalEvidence: verified.evidence.length, citedEvidence: cited.size, unresolvedCitations: 0, modelCalls: result.calls.length, mubitRequestIds: result.calls.flatMap((c) => c.metadata?.requestId ? [c.metadata.requestId] : []), tokens: result.state!.actualTokens, estimatedCostUsd: result.calls.some((c) => c.metadata?.estimatedCostUsd == null) ? null : result.state!.estimatedCostUsd, demoPreserved: true, workspace: `/dashboard/investigations/${target.investigationId}?run=${simulationRunId}` };
  mkdirSync("docs/stage5-runs", { recursive: true });
  writeFileSync(`docs/stage5-runs/${simulationRunId}.json`, JSON.stringify({ metrics, result }, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : "Demo failed"); process.exitCode = 1; }).finally(async () => { if (globalThis._normalMongoClientPromise) await (await getMongoClient()).close(); });
