/** Read-only acceptance harness: real Mongo sources, a local UI report fixture, no model requests. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Diagnosis } from "@normal/contracts";
import { getDb, getMongoClient } from "../src/lib/mongodb";
import { COLLECTIONS } from "../src/lib/collections";
import { canonicalJson } from "../src/intelligence/evidence/provenance";
import { composeReport } from "../src/intelligence/investigator/reports";
import { Budget, ExternalSource, InvestigationState } from "../src/intelligence/investigator/schemas";

process.loadEnvFile(".env.local");
const output = (file: string) => process.env.E2E_ARTIFACT_DIR ? join(process.env.E2E_ARTIFACT_DIR, "docs/stage5-runs", file) : `docs/stage5-runs/${file}`;
const path = output("source-card-integration-fixture.json");
const scope = { businessId: "nike_eval", simulationRunId: "source_acceptance_1792885169199", investigationId: "official_source_check" };
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

async function main() {
  const db = await getDb();
  const preserved: Record<string, { count: number; hash: string }> = {};
  // Include every demo collection, the active business selection, original sources and the advertising report scope.
  for (const name of [...new Set(Object.values(COLLECTIONS))]) {
    for (const run of ["demo_nike", "stage5_1792885194280"]) {
      const filter = name === COLLECTIONS.simulatorGroundTruth ? { simulationRunId: run } : { businessId: "nike_demo", simulationRunId: run };
      const digest = createHash("sha256"); let count = 0;
      for await (const doc of db.collection(name).find(filter).sort({ _id: 1 })) { digest.update(canonicalJson(doc)); count++; }
      preserved[`${run}:${name}`] = { count, hash: digest.digest("hex") };
    }
  }
  const business = await db.collection(COLLECTIONS.businesses).findOne({ businessId: "nike_demo" });
  preserved.activeBusiness = { count: business ? 1 : 0, hash: hash(business) };
  const raw = await db.collection(COLLECTIONS.externalSources).find(scope, { projection: { _id: 0 } }).sort({ sourceId: 1 }).toArray();
  preserved.originalSources = { count: raw.length, hash: hash(raw) };
  if (process.argv.includes("--verify")) {
    const fixture = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(preserved, fixture.preserved, "Demo, active selection, advertising scope or original sources changed");
    const result = { passed: true, demoPreserved: true, activeSelection: business?.activeSimulationRunId, sourceRecordsUnchanged: true, advertisingScopeUnchanged: true, checkedAt: new Date().toISOString() };
    writeFileSync(output("source-card-preservation.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result)); return;
  }
  const sources = raw.map((doc) => ExternalSource.parse(doc));
  assert.equal(sources.length, 2, "Expected both genuine persisted claim assessments");
  const accepted = sources.find((source) => source.claimSupport === "supported")!;
  const rejected = sources.find((source) => source.claimSupport === "insufficient")!;
  assert(accepted?.status === "contextual" && accepted.httpStatus === 200 && accepted.excerptMatched && accepted.previewImageUrl);
  assert(rejected?.status === "insufficient_evidence" && rejected.duplicateOf === accepted.sourceId);
  const associations = {
    investigations: await db.collection(COLLECTIONS.investigations).countDocuments(scope),
    jobs: await db.collection(COLLECTIONS.investigationJobs).countDocuments(scope),
    reports: await db.collection(COLLECTIONS.investigationReports).countDocuments(scope),
  };
  const now = new Date().toISOString();
  const state = InvestigationState.parse({ schemaVersion: 1, ...scope, jobId: "source_card_ui_fixture_no_provider", status: "insufficient_evidence", stage: "isolated_source_card_fixture",
    createdAt: now, updatedAt: now, startedAt: null, completedAt: now, round: 0, toolCount: 0, researchCount: 0, sourceCount: 2, callCount: 0, reservedTokens: 0, actualTokens: 0, estimatedCostUsd: 0,
    budget: Budget.parse({ maxRounds: 1, maxTools: 1, maxResearchRounds: 0, maxSources: 2, maxCalls: 2, maxTokens: 5000, maxWallMs: 60000, maxCostUsd: null }),
    cutoff: accepted.retrievedAt, incidentWindow: accepted.eventWindow, baselineWindow: null, evidenceIds: [], sourceIds: sources.map((source) => source.sourceId), hypotheses: [], steps: [], error: null,
    stopReason: "Isolated UI integration fixture. Reuses real retrieved sources; no live investigator or provider call was made.", reportId: "report_source_card_ui_fixture_no_provider", attempts: 0 });
  const diagnosis = Diagnosis.parse({ schemaVersion: 1, ...{ businessId: scope.businessId, investigationId: scope.investigationId }, diagnosisId: "source_card_fixture_unknown", modelCallId: "fixture_no_provider_call", taskKey: "revenue_diagnosis_v1", createdAt: now,
    primaryCause: "unknown", summary: "Source-card integration fixture: review the retrieved Nike announcement and its claim assessments. No business incident or causal diagnosis is asserted; no live AI run occurred.",
    hypotheses: [{ cause: "unknown", strength: "weak", evidenceIds: [], counterEvidenceIds: [], explanation: "This fixture tests source attribution and claim links, not a business cause." }],
    missingEvidence: ["Spontaneous research delegation in a source-relevant live investigation remains unverified."], requiresReview: true });
  const report = composeReport(state, diagnosis, [], sources, []);
  const external = report.sections.find((section) => section.title === "External research")!;
  assert.deepEqual(external.evidenceIds, [accepted.sourceId]);
  assert(!external.text.includes(rejected.proposedClaim));
  assert.equal(report.claims.find((claim) => claim.claimId === rejected.claimId)?.support, "insufficient_evidence");
  const fixture = { mode: "read-only Mongo source records + local report fixture; browser read responses intercepted; no persisted AI report created", scope, associations, sources, state, report,
    originalResearchRequestId: "mreq_01a170489d8b7320a4f6e0cce4d9b774", originalAssessmentRequestId: "mreq_01a17048cae175c0b135a31cce2a17a3", newProviderCalls: 0, preserved };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(fixture, null, 2));
  console.log(JSON.stringify({ scope, associations, sourceIds: sources.map((source) => source.sourceId), fixture: path, newProviderCalls: 0 }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => { await (await getMongoClient()).close(); });
