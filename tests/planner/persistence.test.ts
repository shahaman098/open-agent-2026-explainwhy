import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { PlanHandoff } from "@normal/contracts";
import { getDb } from "@/lib/mongodb";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { InvestigationState, type ScopeT } from "@/intelligence/investigator/schemas";
import { composeReport } from "@/intelligence/investigator/reports";
import { ProviderError, type ModelResponse } from "@/intelligence/investigator/provider";
import { startPlanning, claimPlanning, processPlanning, readPlanning, runNextPlanning, selectStrategy, submitPlan, plannerHandoff, repairPlanning, refreshPlanning } from "@/planner/service";
import { contextFixture, outputFixture } from "./fixtures";

const scopeBase = { businessId: "nike_test", simulationRunId: `t_stage6_${Date.now()}` };
const meta: ModelResponse["metadata"] = { provider: "mubit", model: "fixture_model", requestId: "fixture_request_not_live", providerRequestId: null, route: "fixture", latencyMs: 1, inputTokens: 5, outputTokens: 5, totalTokens: 10, estimatedCostUsd: null };
let db: Db;
const model = () => vi.fn().mockResolvedValue({ value: outputFixture(), toolCalls: [], metadata: meta });
async function seed(name: string): Promise<ScopeT> {
  const scope = { ...scopeBase, investigationId: `${scopeBase.simulationRunId}_${name}` }, fixture = contextFixture();
  const evidence = { ...fixture.evidence[0], businessId: scope.businessId, investigationId: scope.investigationId, evidenceId: `${scope.investigationId}_e`, sourceRecords: [{ collection: COLLECTIONS.businessEvents, recordId: `${scope.investigationId}_event` }] };
  const diagnosis = { ...fixture.diagnosis, businessId: scope.businessId, investigationId: scope.investigationId, diagnosisId: `${scope.investigationId}_diag`, hypotheses: fixture.diagnosis.hypotheses.map((hypothesis) => ({ ...hypothesis, evidenceIds: [evidence.evidenceId] })) };
  const state = InvestigationState.parse({ schemaVersion: 1, ...scope, jobId: `${scope.investigationId}_job`, status: "completed", stage: "completed", createdAt: fixture.cutoff, updatedAt: fixture.cutoff, startedAt: fixture.cutoff, completedAt: fixture.cutoff,
    round: 1, toolCount: 1, researchCount: 0, sourceCount: 0, callCount: 1, reservedTokens: 100, actualTokens: 100, estimatedCostUsd: 0, budget: { maxRounds: 1, maxTools: 1, maxResearchRounds: 0, maxSources: 0, maxCalls: 2, maxTokens: 5000, maxWallMs: 60000, maxCostUsd: null }, cutoff: fixture.cutoff, incidentWindow: evidence.window, baselineWindow: null, evidenceIds: [evidence.evidenceId], sourceIds: [], hypotheses: [], steps: [], error: null, stopReason: null, reportId: `report_${scope.investigationId}_job`, attempts: 1 });
  const report = composeReport(state, diagnosis, [evidence], [], ["campaign_A"]);
  await Promise.all([
    db.collection(COLLECTIONS.investigations).insertOne({ ...scope, status: "awaiting_review" }),
    db.collection(COLLECTIONS.investigationJobs).insertOne({ ...state, affected: ["campaign_A"] }),
    db.collection(COLLECTIONS.investigationReports).insertOne({ ...scope, reportId: report.reportId, report }),
    db.collection(COLLECTIONS.diagnoses).insertOne({ ...diagnosis, simulationRunId: scope.simulationRunId }),
    db.collection(COLLECTIONS.evidence).insertOne({ ...evidence, simulationRunId: scope.simulationRunId }),
    db.collection(COLLECTIONS.evidenceDetails).insertOne({ ...scope, ...fixture.evidenceDetails![0], evidenceId: evidence.evidenceId, verification: { passed: true } }),
    db.collection(COLLECTIONS.businessEvents).insertOne({ ...scopeBase, eventId: evidence.sourceRecords[0].recordId, provenance: { connectorId: "planner_test", sourceRecordId: evidence.sourceRecords[0].recordId } }),
  ]);
  return scope;
}
async function fixtureModel(scope: ScopeT) {
  const job = await db.collection(COLLECTIONS.investigationJobs).findOne(scope);
  const output = outputFixture();
  for (const strategy of output.strategies) { strategy.evidenceIds = job!.evidenceIds; for (const action of strategy.actions) action.evidenceIds = job!.evidenceIds; }
  return vi.fn().mockResolvedValue({ value: output, toolCalls: [], metadata: meta });
}
beforeAll(async () => {
  vi.stubEnv("MUBIT_API_KEY", "test_fixture_key"); db = await getDb(); await ensureIndexes(db);
  const fixture = contextFixture();
  await Promise.all([
    db.collection(COLLECTIONS.simulatorState).insertOne({ ...scopeBase, virtualTime: fixture.storefront.virtualTime, updatedAt: fixture.storefront.updatedAt }),
    db.collection(COLLECTIONS.simulatedCampaigns).insertOne({ ...fixture.campaigns[0], ...scopeBase }),
    db.collection(COLLECTIONS.simulatedStorefront).insertOne({ ...scopeBase, banners: [], promotions: [], updatedAt: fixture.storefront.updatedAt }),
  ]);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  for (const collection of [COLLECTIONS.planningJobs, COLLECTIONS.plans, COLLECTIONS.investigationCalls, COLLECTIONS.investigationJobs, COLLECTIONS.investigationReports, COLLECTIONS.investigations, COLLECTIONS.diagnoses, COLLECTIONS.evidence, COLLECTIONS.evidenceDetails, COLLECTIONS.businessEvents, COLLECTIONS.simulatorState, COLLECTIONS.simulatedCampaigns, COLLECTIONS.simulatedStorefront]) await db?.collection(collection).deleteMany(scopeBase);
});
describe("durable planner MongoDB persistence; model output is an explicit test fixture", () => {
  it("queues idempotently, permits one worker, persists canonical versions and prepares approval without executing", async () => {
    const scope = await seed("persist");
    const starts = await Promise.all([startPlanning(db, scope), startPlanning(db, scope), startPlanning(db, scope)]);
    expect(new Set(starts.map((job) => job.jobId)).size).toBe(1);
    const claims = await Promise.all([claimPlanning(db, scope), claimPlanning(db, scope)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const invoke = await fixtureModel(scope); await processPlanning(db, claims.find(Boolean)!, invoke);
    expect(invoke).toHaveBeenCalledTimes(1);
    const selected = await selectStrategy(db, scope, "bounded");
    expect(selected.plan?.planVersion).toBe(1);
    expect((await selectStrategy(db, scope, "bounded")).plan).toEqual(selected.plan);
    const submitted = await submitPlan(db, scope); expect(submitted.plan?.status).toBe("awaiting_approval");
    const doc = await db.collection(COLLECTIONS.plans).findOne({ ...scope, planVersion: 1 }, { projection: { _id: 0 } });
    expect(PlanHandoff.safeParse(await plannerHandoff(db, doc!)).success).toBe(true);
    await expect(plannerHandoff(db, { ...doc!, actions: [{ ...doc!.actions[0], params: { ...doc!.actions[0].params, newDailyBudgetMinor: 9000 } }] })).rejects.toThrow("immutable selected strategy");
    await selectStrategy(db, scope, "observe");
    expect((await readPlanning(db, scope)).plan).toBeNull();
    expect(await db.collection(COLLECTIONS.plans).findOne({ ...scope, planVersion: 1 }, { projection: { _id: 0 } })).toEqual(doc);
    expect((await selectStrategy(db, scope, "bounded")).plan?.planVersion).toBe(3);
    expect(await db.collection(COLLECTIONS.actionReceipts).countDocuments(scopeBase)).toBe(0);
    expect(await db.collection(COLLECTIONS.simulatedMessages).countDocuments(scopeBase)).toBe(0);
    expect((await db.collection(COLLECTIONS.simulatedCampaigns).findOne(scopeBase))?.dailyBudgetMinor).toBe(10000);
    expect((await db.collection(COLLECTIONS.simulatedStorefront).findOne(scopeBase))?.banners).toEqual([]);
    const calls = (await readPlanning(db, scope)).calls;
    expect(calls[0].promptFingerprint).toHaveLength(64); expect(calls[0].checksum).toHaveLength(64);
  });
  it("blocks failed and provisional diagnoses and isolates unknown business/run scopes", async () => {
    const scope = await seed("blocked");
    await db.collection(COLLECTIONS.investigationJobs).updateOne(scope, { $set: { status: "failed", error: "provider failure" } });
    await expect(startPlanning(db, scope)).rejects.toThrow("non-provisional");
    await expect(startPlanning(db, { ...scope, simulationRunId: "foreign_run" })).rejects.toThrow("saved Stage 5 report");
    await expect(startPlanning(db, { ...scope, businessId: "foreign_business" })).rejects.toThrow("saved Stage 5 report");
    expect((await readPlanning(db, scope)).eligible).toBe(false);
    expect(await db.collection(COLLECTIONS.planningJobs).countDocuments(scope)).toBe(0);
  });
  it("records a provider 503 and refuses automatic replay or fabricated plans", async () => {
    const scope = await seed("provider"); await startPlanning(db, scope);
    const invoke = vi.fn().mockRejectedValue(new ProviderError("http_503", true, true, meta));
    await runNextPlanning(db, scope, invoke);
    expect(await runNextPlanning(db, scope, invoke)).toBe(false);
    const view = await readPlanning(db, scope); expect(view.job?.status).toBe("failed"); expect(view.plan).toBeNull();
    expect(view.calls[0].metadata?.requestId).toBe(meta.requestId); expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("never replays a recovered pending request with unknown billing outcome", async () => {
    const scope = await seed("ambiguous"), job = await startPlanning(db, scope);
    await db.collection(COLLECTIONS.investigationCalls).insertOne({ ...scope, callId: `${job.jobId}_strategy_0`, jobId: job.jobId, status: "pending" });
    const invoke = model(); await runNextPlanning(db, scope, invoke);
    expect(invoke).not.toHaveBeenCalled(); expect((await readPlanning(db, scope)).job?.error).toContain("automatic replay is disabled");
  });
  it("persists malformed output rejection without a plan", async () => {
    const scope = await seed("malformed"); await startPlanning(db, scope);
    await runNextPlanning(db, scope, vi.fn().mockResolvedValue({ value: { strategies: [] }, toolCalls: [], metadata: meta }));
    const view = await readPlanning(db, scope); expect(view.job?.status).toBe("failed"); expect(view.plan).toBeNull(); expect((view.calls[0] as { validationStatus?: string }).validationStatus).toBe("rejected");
  });
  it("records one semantic correction with a stable task fingerprint and separate input checksum", async () => {
    const scope = await seed("repair"); await startPlanning(db, scope);
    const original = await fixtureModel(scope), bad = await original(); bad.value.strategies[0].actions[0].budget.campaignId = "unknown";
    await runNextPlanning(db, scope, vi.fn().mockResolvedValue(bad));
    expect((await readPlanning(db, scope)).job?.checks.some((check) => !check.passed)).toBe(true);
    await repairPlanning(db, scope);
    await runNextPlanning(db, scope, await fixtureModel(scope));
    const view = await readPlanning(db, scope);
    expect(view.calls).toHaveLength(2);
    expect(view.calls[0].promptFingerprint).toBe(view.calls[1].promptFingerprint);
    expect(view.calls[0].checksum).not.toBe(view.calls[1].checksum);
    expect((view.calls[0] as { correctionId?: string }).correctionId).toBe(view.calls[1].callId);
    await expect(repairPlanning(db, scope)).rejects.toThrow("One correction");
  });
  it("rejects selection when the target changes after strategy generation", async () => {
    const scope = await seed("stale"); await startPlanning(db, scope); await runNextPlanning(db, scope, await fixtureModel(scope));
    await db.collection(COLLECTIONS.simulatedCampaigns).updateOne(scopeBase, { $set: { dailyBudgetMinor: 11000 } });
    await expect(selectStrategy(db, scope, "bounded")).rejects.toThrow("stale");
    expect(await db.collection(COLLECTIONS.plans).countDocuments(scope)).toBe(0);
    await refreshPlanning(db, scope);
    expect((await readPlanning(db, scope)).job).toMatchObject({ status: "queued", generation: 1, output: null });
    await db.collection(COLLECTIONS.simulatedCampaigns).updateOne(scopeBase, { $set: { dailyBudgetMinor: 10000 } });
  });
});
