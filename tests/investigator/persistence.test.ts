import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { Anomaly, Investigation, RootCause } from "@normal/contracts";
import anomalyFixture from "../../packages/contracts/examples/anomaly.json";
import { getDb } from "@/lib/mongodb";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { startInvestigation, claimInvestigation, cancelInvestigation, readInvestigation, saveJob, type JobDoc } from "@/intelligence/investigator/store";
import { processInvestigation } from "@/intelligence/investigator/controller";
import { loadVerifiedEvidence } from "@/intelligence/investigator/validation";
import { ProviderError, type ModelResponse } from "@/intelligence/investigator/provider";
import { verifyExternalSource } from "@/intelligence/investigator/research";
const scope = { businessId: "nike_test", simulationRunId: `t_stage5_${Date.now()}` };
const window = { startAt: "2026-10-02T00:00:00.000Z", endAt: "2026-10-03T00:00:00.000Z" };
const metadata: ModelResponse["metadata"] = { provider: "mubit", model: "test_fixture", requestId: "test_mock_request", providerRequestId: null, route: "test_mock", latencyMs: 1, inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCostUsd: null };
const hypothesis = (cause: typeof RootCause.options[number]) => ({ cause, explanation: "A plausible alternative", mechanism: "A possible mechanism", support: "insufficient_evidence", evidenceIds: [], counterEvidenceIds: [], expectedObservations: ["A matching change"], missingEvidence: ["More observations"], falsificationTests: ["Compare an unaffected cohort"], chronology: "Unknown", confounders: ["Changing mix"], controlComparison: "Unavailable" });
const decision = { hypotheses: [hypothesis(RootCause.options[0]), hypothesis(RootCause.options[1])], decisionSummary: "More evidence is needed", nextTools: [{ tool: "checkout_analysis", question: "Are failures elevated?", campaignIds: [], productIds: [] }], research: null, stop: false, stopReason: "Need internal evidence" };
const diagnosis = { primaryCause: "unknown", hypotheses: [{ cause: "unknown", strength: "weak", evidenceIds: [], counterEvidenceIds: [], explanation: "No reliable explanation is supported." }], summary: "Evidence is insufficient to select a reliable cause.", missingEvidence: ["A complete operational window"], requiresReview: true };
let db: Db;
async function seed(name: string) {
  const investigationId = `${scope.simulationRunId}_${name}`;
  const a = Anomaly.parse({ ...anomalyFixture, businessId: scope.businessId, anomalyId: `${investigationId}_a`, currentWindow: window, baselineWindow: { startAt: "2026-10-01T00:00:00.000Z", endAt: window.startAt } });
  await db.collection(COLLECTIONS.anomalies).insertOne({ ...a, simulationRunId: scope.simulationRunId });
  const inv = Investigation.parse({ schemaVersion: 1, businessId: scope.businessId, investigationId, anomalyIds: [a.anomalyId], status: "open", title: "Controlled ambiguous observation", evidenceIds: [], startedAt: window.startAt, updatedAt: window.endAt });
  await db.collection(COLLECTIONS.investigations).insertOne({ ...inv, simulationRunId: scope.simulationRunId });
  return { ...scope, investigationId };
}
beforeAll(async () => {
  vi.stubEnv("MUBIT_API_KEY", "test_mock_key"); vi.stubEnv("NORMAL_EXTERNAL_RESEARCH_ENABLED", "false");
  db = await getDb(); await ensureIndexes(db);
  await db.collection(COLLECTIONS.businessEvents).insertOne({ ...scope, eventId: `${scope.simulationRunId}_event`, type: "ad.metrics_observed", occurredAt: window.startAt, provenance: { connectorId: "stage5_test", sourceRecordId: scope.simulationRunId }, payload: { window } });
  await db.collection(COLLECTIONS.monitoringWindows).insertOne({ ...scope, windowKey: `${scope.simulationRunId}_window`, windowEnd: window.endAt, status: "ready" });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  for (const name of [COLLECTIONS.businessEvents, COLLECTIONS.monitoringWindows, COLLECTIONS.anomalies, COLLECTIONS.investigations, COLLECTIONS.investigationJobs, COLLECTIONS.investigationCalls, COLLECTIONS.investigationReports, COLLECTIONS.externalSources, COLLECTIONS.evidence, COLLECTIONS.evidenceDetails, COLLECTIONS.evidenceToolRuns, COLLECTIONS.diagnoses]) await db?.collection(name).deleteMany(scope);
});
describe("durable investigation persistence (MongoDB; model responses are fixtures)", () => {
  it("repairs invalid structured decisions once, preserving task fingerprints and rejection lineage", async () => {
    const target = await seed("repair"); await startInvestigation(db, target);
    const job = (await claimInvestigation(db, target))!;
    const model = vi.fn().mockRejectedValueOnce(new ProviderError("invalid_structured_output", false, false, metadata))
      .mockResolvedValueOnce({ value: { ...decision, nextTools: [] }, metadata, toolCalls: [] })
      .mockResolvedValueOnce({ value: diagnosis, metadata, toolCalls: [] });
    await processInvestigation(db, job, { model, research: vi.fn(), verifySource: vi.fn() });
    const result = await readInvestigation(db, target);
    const rejected = result.calls.find((c) => c.callId.endsWith("reasoning_0"))!;
    const repaired = result.calls.find((c) => c.callId.endsWith("reasoning_0_repair"))!;
    expect(rejected.validationStatus).toBe("rejected"); expect(rejected.correctionId).toBe(repaired.callId);
    expect(rejected.promptFingerprint).toHaveLength(64); expect(rejected.promptFingerprint).toBe(repaired.promptFingerprint);
    expect(rejected.checksum).not.toBe(repaired.checksum);
    expect(model).toHaveBeenCalledTimes(3); expect(result.state?.status).toBe("insufficient_evidence");
  });
  it("fences publication when cancelled while a provider response is in flight", async () => {
    const target = await seed("active_cancel"); await startInvestigation(db, target);
    const job = (await claimInvestigation(db, target))!;
    const model = vi.fn().mockImplementation(async () => {
      await cancelInvestigation(db, target);
      return { value: decision, metadata, toolCalls: [] };
    });
    await processInvestigation(db, job, { model, research: vi.fn(), verifySource: vi.fn() });
    const result = await readInvestigation(db, target);
    expect(result.state?.status).toBe("cancelled"); expect(result.report).toBeNull();
    expect(model).toHaveBeenCalledTimes(1); expect(result.calls[0].metadata?.requestId).toBe(metadata.requestId);
    expect(await db.collection(COLLECTIONS.diagnoses).countDocuments(target)).toBe(0);
  });
  it("persists research provenance and contradictory claim status without treating grounding as verification", async () => {
    const target = await seed("research"); await startInvestigation(db, target);
    const job = (await claimInvestigation(db, target))!; job.budget.maxResearchRounds = 1;
    const delegation = { topic: "advertising_platform_disruption", geography: "UK", question: "Was there a platform disruption?", rationale: "Check the alternative", hypotheses: ["unknown"], sourceTypes: ["official_status"] };
    const model = vi.fn().mockImplementation(async (request) => ({ metadata, toolCalls: [], value:
      request.schemaName === "source_support" ? { assessments: request.input.map((s: { sourceId: string }) => ({ sourceId: s.sourceId, relation: "contradictory", rationale: "The passage describes normal service." })) } :
      request.schemaName === "root_cause_diagnosis" ? diagnosis : { ...decision, nextTools: [], research: delegation, stop: true } }));
    const research = vi.fn().mockResolvedValue({ candidates: [{ url: "https://example.com/status", claim: "An outage was reported", excerpt: "All services are operating normally" }], metadata, groundingPresent: true, queries: ["official service status"], limitations: ["Grounding is discovery only"] });
    await processInvestigation(db, job, { model, research, verifySource: (candidate, scope, period, cutoff) => verifyExternalSource(candidate, scope, period, cutoff,
      async () => ({ url: candidate.url, status: 200, headers: {}, body: '<title>Service status</title><meta property="article:published_time" content="2026-10-01T00:00:00Z"><p>All services are operating normally</p>' })) });
    const result = await readInvestigation(db, target);
    expect(result.sources[0]).toMatchObject({ status: "contradictory", publisher: "example.com", semanticAssessment: "model_only", excerptMatched: true });
    expect(result.researchTraces[0].groundingPresent).toBe(true);
    expect(result.calls.find((c) => c.task === "external_research")?.promptFingerprint).toHaveLength(64);
    expect(result.report?.claims.find((c) => c.kind === "external_context")).toMatchObject({ support: "contradicted", sourceIds: [result.sources[0].sourceId], evidenceIds: [] });
    expect(result.report?.diagnosis.primaryCause).toBe("unknown"); expect(result.report?.handoff.ready).toBe(false);
  });
  it("deduplicates concurrent starts and grants only one lease", async () => {
    const target = await seed("concurrency");
    const starts = await Promise.all([1, 2, 3].map(() => startInvestigation(db, target)));
    expect(new Set(starts.map((s) => s.jobId)).size).toBe(1);
    const claims = await Promise.all([1, 2, 3].map(() => claimInvestigation(db, target)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    await cancelInvestigation(db, target);
  });
  it("resumes an expired lease and fences the original worker", async () => {
    const target = await seed("recovery"); await startInvestigation(db, target);
    const first = (await claimInvestigation(db, target))!;
    await db.collection(COLLECTIONS.investigationJobs).updateOne(target, { $set: { leaseUntil: new Date(0) } });
    const second = (await claimInvestigation(db, target))!;
    expect(second.leaseToken).not.toBe(first.leaseToken); expect(second.attempts).toBe(2);
    await expect(saveJob(db, first)).rejects.toThrow("lease_lost");
    await cancelInvestigation(db, target); await expect(saveJob(db, second)).rejects.toThrow("cancelled");
  });
  it("persists a consistent insufficient-evidence report and reuses it on refresh/start", async () => {
    const target = await seed("report"); await startInvestigation(db, target);
    const job = (await claimInvestigation(db, target))!;
    const model = vi.fn().mockResolvedValueOnce({ value: decision, metadata, toolCalls: [] }).mockResolvedValueOnce({ value: { ...decision, stop: true, nextTools: [] }, metadata, toolCalls: [] }).mockResolvedValueOnce({ value: diagnosis, metadata, toolCalls: [] });
    await processInvestigation(db, job, { model, research: vi.fn(), verifySource: vi.fn() });
    const result = await readInvestigation(db, target);
    expect(result.state?.status).toBe("insufficient_evidence"); expect(result.report?.diagnosis.primaryCause).toBe("unknown");
    expect(result.report?.executiveBrief.explanation).toBe(result.report?.diagnosis.summary);
    expect(result.report?.handoff.diagnosisId).toBe(result.report?.diagnosisId); expect(result.report?.handoff.executable).toBe(false);
    expect(result.report?.timeline.some((s) => s.type === "tool" && s.identifier === "checkout_analysis")).toBe(true);
    expect(result.calls.filter((c) => c.status === "completed")).toHaveLength(3);
    expect((await startInvestigation(db, target)).reportId).toBe(result.state?.reportId);
    expect(await claimInvestigation(db, target)).toBeNull(); expect(model).toHaveBeenCalledTimes(3);
    expect(await db.collection(COLLECTIONS.diagnoses).countDocuments(target)).toBe(1);
    expect(await db.collection(COLLECTIONS.investigationReports).countDocuments(target)).toBe(1);
  });
  it("does not replay a request whose outcome is unknown after a crash", async () => {
    const target = await seed("unknown_call"); const initial = await startInvestigation(db, target);
    await db.collection(COLLECTIONS.investigationCalls).insertOne({ ...target, callId: `${initial.jobId}_reasoning_0`, jobId: initial.jobId, status: "pending", result: null, metadata: null });
    const job = (await claimInvestigation(db, target))!;
    const model = vi.fn().mockResolvedValue({ value: diagnosis, metadata, toolCalls: [] });
    await processInvestigation(db, job, { model, research: vi.fn(), verifySource: vi.fn() });
    expect(model).toHaveBeenCalledTimes(1); // Only the distinct final diagnosis; the pending reasoning call was not replayed.
    expect((await readInvestigation(db, target)).state?.stopReason).toContain("outcome_unknown");
  });
  it("finishes honestly when the provider is unavailable without making repeated calls", async () => {
    const target = await seed("outage"); await startInvestigation(db, target);
    const job = (await claimInvestigation(db, target))!;
    const model = vi.fn().mockRejectedValue(new ProviderError("transport_or_timeout", false, true));
    await processInvestigation(db, job, { model, research: vi.fn(), verifySource: vi.fn() });
    const result = await readInvestigation(db, target);
    expect(result.state?.status).toBe("failed"); expect(result.state?.error).toContain("transport_or_timeout");
    expect(result.report?.diagnosis.primaryCause).toBe("unknown"); expect(result.report?.handoff.ready).toBe(false); expect(model).toHaveBeenCalledTimes(2);
    expect(result.report?.timeline.find((s) => s.type === "diagnosis")?.error).toContain("deterministic");
    expect(result.calls.find((c) => c.task === "normal.root_cause_diagnosis.v1")?.validationStatus).toBe("provider_failed");
  });
  it("persists a 503 as provider failure with a provisional report and never retries the same request", async () => {
    const target = await seed("gateway_503"); await startInvestigation(db, target);
    const job = (await claimInvestigation(db, target))!;
    const model = vi.fn().mockResolvedValueOnce({ value: { ...decision, nextTools: [], stop: true }, metadata, toolCalls: [] })
      .mockRejectedValueOnce(new ProviderError("http_503", true, true, { ...metadata, requestId: "mreq_503" }, 3000));
    await processInvestigation(db, job, { model, research: vi.fn(), verifySource: vi.fn() });
    const result = await readInvestigation(db, target);
    expect(result.state).toMatchObject({ status: "failed", stage: "failed", reportId: `report_${job.jobId}`, error: expect.stringContaining("http_503") });
    expect(result.report).toMatchObject({ diagnosis: { primaryCause: "unknown" }, handoff: { ready: false }, validation: { passed: true } });
    const call = result.calls.find((c) => c.error?.includes("http_503"));
    expect(call).toMatchObject({ status: "failed", ambiguous: true, validationStatus: "provider_failed", correctionId: null, metadata: { requestId: "mreq_503" } });
    expect(model).toHaveBeenCalledTimes(2);
    expect(await claimInvestigation(db, target)).toBeNull();
    expect((await startInvestigation(db, target)).status).toBe("failed");
  });
  it("does not call a reasoning outage an evidence gap when the final model returns unknown", async () => {
    const target = await seed("reasoning_503"); await startInvestigation(db, target);
    const job = (await claimInvestigation(db, target))!;
    const model = vi.fn().mockRejectedValueOnce(new ProviderError("http_503", true, true, { ...metadata, requestId: "mreq_reasoning_503" }))
      .mockResolvedValueOnce({ value: diagnosis, metadata, toolCalls: [] });
    await processInvestigation(db, job, { model, research: vi.fn(), verifySource: vi.fn() });
    const result = await readInvestigation(db, target);
    expect(result.state?.status).toBe("failed");
    expect(result.state?.error).toContain("http_503");
    expect(result.report?.diagnosis.primaryCause).toBe("unknown");
    expect(model).toHaveBeenCalledTimes(2);
    expect(result.calls.filter((c) => c.callId.endsWith("reasoning_0"))).toMatchObject([{ validationStatus: "provider_failed", correctionId: null }]);
  });
  it("honours token budgets and cancellation without model calls", async () => {
    const target = await seed("budget"); await startInvestigation(db, target);
    const job = (await claimInvestigation(db, target))!; job.budget.maxTokens = 5000;
    const model = vi.fn(); await processInvestigation(db, job, { model, research: vi.fn(), verifySource: vi.fn() });
    expect(model).not.toHaveBeenCalled(); expect((await readInvestigation(db, target)).state?.status).toBe("insufficient_evidence");
    const cancelled = await seed("cancel"); await startInvestigation(db, cancelled); await cancelInvestigation(db, cancelled);
    expect(await claimInvestigation(db, cancelled)).toBeNull();
  });
  it("rejects evidence from another investigation even within the same run", async () => {
    const a = await seed("scope_a"), b = await seed("scope_b");
    const id = `${scope.simulationRunId}_foreign`;
    await db.collection(COLLECTIONS.evidence).insertOne({ ...a, evidenceId: id });
    const packet = await loadVerifiedEvidence(db, b, [id], window.endAt);
    expect(packet.evidence).toEqual([]); expect(packet.limitations[0]).toContain("outside investigation scope");
  });
  it("a final exhausted worker crash becomes failed", async () => {
    const target = await seed("last_crash"); await startInvestigation(db, target);
    await db.collection<JobDoc>(COLLECTIONS.investigationJobs).updateOne(target, { $set: { status: "running", attempts: 3, leaseUntil: new Date(0) } });
    expect(await claimInvestigation(db, target)).toBeNull(); expect((await readInvestigation(db, target)).state?.status).toBe("failed");
  });
});
