/** EVALUATION HARNESS ONLY — scenario labels are confined to setup and scoring AFTER inference. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { getDb, getMongoClient } from "../src/lib/mongodb";
import { COLLECTIONS, ensureIndexes } from "../src/lib/collections";
import { simulate, harnessCatalogue } from "../src/intelligence/evaluation/harness";
import { EXPECTED_THEMES, SCENARIO_HOURS } from "../src/intelligence/evaluation/evaluate";
import { deleteRun } from "../src/simulator/persistence";
import type { ScenarioNameT } from "../src/simulator/scenarios";
import { ingestEvents } from "../src/ingestion/service";
import { snapshotTickWindows } from "../src/analytics/metrics";
import { publishWindow } from "../src/intelligence/monitoring/windows";
import { runMonitor } from "../src/intelligence/monitor";
import { readInvestigation, startInvestigation } from "../src/intelligence/investigator/store";
import { runNextInvestigation } from "../src/intelligence/investigator/controller";
import { loadVerifiedEvidence } from "../src/intelligence/investigator/validation";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const all: ScenarioNameT[] = ["healthy", "ad_fatigue", "delivery_delays", "viral_demand", "negative_reviews", "promo_checkout_failure"];
const expected: Record<ScenarioNameT, string[]> = { healthy: ["unknown"], ad_fatigue: ["ad_fatigue", "ad_inefficiency"], delivery_delays: ["delivery_delays"], viral_demand: ["viral_demand"], negative_reviews: ["negative_sentiment", "product_quality"], promo_checkout_failure: ["checkout_failure", "discount_failure"] };
const hours: Record<ScenarioNameT, number> = { healthy: 24, ...SCENARIO_HOURS };
const selected = process.argv.find((a) => a.startsWith("--scenario="))?.slice(11) as ScenarioNameT | undefined;
if (selected && !all.includes(selected)) throw new Error("Unknown scenario");
const scenarios = selected ? [selected] : process.argv.some((a) => ["--full", "--all"].includes(a)) ? all : ["ad_fatigue", "promo_checkout_failure"] as ScenarioNameT[];
const seeds = process.argv.includes("--full") ? [11, 808, 4242] : [11];
const stamp = Date.now();
async function main() {
  const db = await getDb(); await ensureIndexes(db); mkdirSync("docs/stage5-runs", { recursive: true });
  const results: Record<string, unknown>[] = [];
  for (const [caseIndex, scenario] of scenarios.entries()) for (const [seedIndex, seed] of seeds.entries()) {
    const started = Date.now(), simulationRunId = `s5eval_${stamp}_${caseIndex}_${seedIndex}`;
    const timeline = simulate({ seed, simulationRunId, healthyHours: 72, scenario, severity: 0.8, scenarioHours: hours[scenario] });
    const scope = { businessId: timeline.businessId, simulationRunId };
    console.log(JSON.stringify({ phase: "setup", caseIndex, seedIndex, simulationRunId }));
    const ingested = await ingestEvents(timeline.events, { businessId: scope.businessId, db });
    if (ingested.result.rejected) throw new Error("Evaluation event ingestion rejected records");
    await db.collection(COLLECTIONS.simulatedProducts).insertMany([...harnessCatalogue()].map(([productId, label]) => ({ ...scope, productId, ...label })));
    // Observe daily throughout the documented duration, as a recurring detector does.
    // A single scan at the end can miss investigation eligibility after an episode resolves.
    for (let cursor = Date.parse(timeline.startAt); cursor < Date.parse(timeline.endAt); cursor += 24 * 3600000) {
      const startAt = new Date(cursor).toISOString();
      const endAt = new Date(Math.min(cursor + 24 * 3600000, Date.parse(timeline.endAt))).toISOString();
      const snapshotIds = await snapshotTickWindows(scope.businessId, simulationRunId, [{ startAt, endAt }], endAt, db);
      await publishWindow(db, { ...scope, windowStart: startAt, windowEnd: endAt, snapshotIds });
      await runMonitor({ ...scope, asOf: endAt });
    }
    const incidents = await db.collection(COLLECTIONS.incidents).find(scope).toArray();
    const eligible = scenario === "healthy" ? incidents : incidents.filter((i) => i.themes?.some((theme: string) => EXPECTED_THEMES[scenario].includes(theme as typeof EXPECTED_THEMES[typeof scenario][number])));
    const incident = eligible.find((i) => i.investigationId);
    if (!incident?.investigationId) {
      const row = { ...scope, scenarioAfterInference: scenario, seed, detected: eligible.length > 0, investigationEligible: false, completion: eligible.length ? "not_investigation_eligible" : "no_incident", expectedHealthy: scenario === "healthy", detectedIncidentCount: incidents.length, matchingThemeIncidentCount: eligible.length, policies: eligible.map((i) => i.investigationPolicy), reason: eligible.length ? "No matching incident met investigation eligibility" : "No matching incident detected", latencyMs: Date.now() - started, modelCalls: 0, tokens: 0 };
      results.push(row); console.log(JSON.stringify(row));
    } else {
      const target = { ...scope, investigationId: incident.investigationId as string };
      await startInvestigation(db, target); await runNextInvestigation(db, target);
      const result = await readInvestigation(db, target);
      const packet = await loadVerifiedEvidence(db, target, result.state?.evidenceIds || [], result.state!.cutoff);
      const refs = result.report?.diagnosis.hypotheses.flatMap((h) => [...h.evidenceIds, ...h.counterEvidenceIds]) || [];
      const invalid = refs.filter((id) => !packet.evidence.some((e) => e.evidenceId === id));
      const row = { ...target, scenarioAfterInference: scenario, seed, detected: true, completion: result.state?.status, primaryCause: result.report?.diagnosis.primaryCause || null,
        mechanismInHypotheses: result.report?.diagnosis.hypotheses.some((h) => expected[scenario].includes(h.cause)) || false,
        leadingMechanismMatch: expected[scenario].includes(result.report?.diagnosis.primaryCause || ""), hypothesisRevisions: result.state?.hypotheses.length || 0,
        evidence: packet.evidence.length, citations: refs.length, invalidCitations: invalid.length, latencyMs: Date.now() - started, modelCalls: result.calls.filter((c) => c.metadata).length,
        tokens: result.state?.actualTokens, estimatedCostUsd: result.calls.some((c) => c.metadata?.estimatedCostUsd == null) ? null : result.state?.estimatedCostUsd,
        externalResearchRounds: result.state?.researchCount, externalCausalValidity: "not_established_by_synthetic_evaluation", requestIds: result.calls.flatMap((c) => c.metadata?.requestId ? [c.metadata.requestId] : []) };
      results.push(row);
      writeFileSync(`docs/stage5-runs/${simulationRunId}.json`, JSON.stringify({ metrics: row, result }, null, 2));
      console.log(JSON.stringify(row));
    }
    if (process.argv.includes("--cleanup")) { await deleteRun(db, scope.businessId, simulationRunId); results[results.length - 1].isolatedFixtureRemovedAfterVerification = true; }
    writeFileSync(`docs/stage5-runs/evaluation_${stamp}.json`, JSON.stringify({ caseCount: results.length, results, calibration: "Qualitative support only; no calibrated probabilities", costs: "Unknown unless configured provider rates are supplied", hiddenScenarioBoundary: "Setup and post-inference scoring only" }, null, 2));
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : "Evaluation failed"); process.exitCode = 1; }).finally(async () => { if (globalThis._normalMongoClientPromise) await (await getMongoClient()).close(); });
