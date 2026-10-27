import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { DocClient, type DocDb, poolConfigFromUrl } from "@/lib/docstore/client";
import { COLLECTIONS } from "@/lib/collections";
import { createInitialWorld } from "@/simulator/bootstrap";
import { TickEngine } from "@/simulator/engine";
import { NVIDIA_DEMO_CATALOGUE } from "@/reference/nvidia";
import { decisionSchema, validateAnalysis, renderDecision, type AnalysisOutputT, type AnalysisPacket } from "@/intelligence/dashboard/schema";
import { buildAnalysisPacket, packetFingerprint, sourceRevision } from "@/intelligence/dashboard/input";
import { ANALYSIS_COLLECTIONS as C, analysisView, claimAnalysisWorker, ensureAnalysisIndexes, localAnalysisConfig, processNextAnalysis, reconcileAnalysis, watchAnalysis } from "@/intelligence/dashboard/store";
import { POST } from "@/app/api/dev/dashboard-analysis/route";
import type { ModelResponse } from "@/intelligence/investigator/provider";
const output: AnalysisOutputT = { headline: "Revenue needs investigation", summary: "Review acquisition and checkout observations before choosing a response.", findings: [{ factId: "revenue", interpretation: "Inspect the recorded revenue comparison before attributing a cause." }], nextChecks: [{ topic: "checkout", reason: "Check conversion alongside acquisition before changing a campaign.", factIds: ["revenue", "conversion"] }] };
const sample = (): AnalysisPacket => ({ scope: { businessId: "nvidia_demo", simulationRunId: "sample" }, window: { startAt: "2026-10-01T00:00:00.000Z", endAt: "2026-10-02T00:00:00.000Z", baselineStartAt: null }, facts: [{ id: "revenue", label: "Revenue", current: "£12.34", previous: null, changePercent: null, source: "business_events", explanation: "Canonical events" }, { id: "conversion", label: "Conversion", current: "2.34%", previous: null, changePercent: null, source: "business_events", explanation: "Canonical events" }], investigations: [], limitations: [] });
const decision = { focus: "revenue" as const, findingIds: ["revenue"], nextChecks: [{ topic: "checkout" as const, factIds: ["revenue", "conversion"] }], note: "Review acquisition and checkout observations before choosing a response." };
const response = (): ModelResponse => ({ value: structuredClone(decision), toolCalls: [], metadata: { provider: "nvidia", route: "http://127.0.0.1:11434/v1/chat/completions", model: "fixture-nemotron", requestId: randomUUID(), providerRequestId: null, latencyMs: 10, inputTokens: 100, outputTokens: 100, totalTokens: 200, estimatedCostUsd: null } });
afterEach(() => vi.unstubAllEnvs());
const localEnv = () => { vi.stubEnv("NVIDIA_INFERENCE_MODE", "local"); vi.stubEnv("NVIDIA_BASE_URL", "http://127.0.0.1:11434/v1"); vi.stubEnv("NEMOTRON_INVESTIGATOR_MODEL", "fixture-nemotron"); };
describe("local analysis model boundary", () => {
  it("constrains citations in the model grammar and rejects invented references, numbers and causal certainty", () => {
    const packet = sample(); expect(validateAnalysis(output, packet)).toEqual(output);
    const invented = { ...output, findings: [{ factId: "other_business", interpretation: "Invented source claim" }] };
    expect(decisionSchema(packet).safeParse({ ...decision, findingIds: ["other_business"] }).success).toBe(false);
    expect(() => validateAnalysis(invented, packet)).toThrow(/unknown fact/);
    expect(() => validateAnalysis({ ...output, summary: "Revenue fell by 50 percent." }, packet)).toThrow(/numeric/);
    expect(() => validateAnalysis({ ...output, headline: "Revenue is caused by advertising" }, packet)).toThrow(/causal/);
  });
  it("deduplicates equivalent snapshots but separates tenants, changed facts, and model versions", () => {
    const packet = sample(), hash = packetFingerprint(packet, "fixture-nemotron");
    expect(packetFingerprint(structuredClone(packet), "fixture-nemotron")).toBe(hash);
    expect(packetFingerprint({ ...packet, scope: { ...packet.scope, businessId: "other" } }, "fixture-nemotron")).not.toBe(hash);
    packet.facts[0].current = "£56.78"; expect(packetFingerprint(packet, "fixture-nemotron")).not.toBe(hash);
    expect(packetFingerprint(sample(), "another-nemotron")).not.toBe(hash);
  });
  it("keeps numeric assertions from a model note out of the published summary", () => {
    const rendered = renderDecision({ ...decision, note: "Revenue fell by 999 percent because advertising failed." }, sample());
    expect(rendered.noteAccepted).toBe(false);
    expect(rendered.output.summary).not.toContain("999");
    expect(rendered.decision.note).toContain("999");
    expect(rendered.output.findings[0].factId).toBe("revenue");
  });
  it("refuses cloud inference and cross-origin mutations", async () => {
    vi.stubEnv("NVIDIA_INFERENCE_MODE", "cloud"); expect(() => localAnalysisConfig()).toThrow();
    vi.stubEnv("NODE_ENV", "development");
    const result = await POST(new Request("http://localhost/api/dev/dashboard-analysis?businessId=nvidia_demo&simulationRunId=sample", { method: "POST", headers: { origin: "https://unrelated.example" }, body: JSON.stringify({ action: "watch" }) }));
    expect(result.status).toBe(403);
  });
});

describe("database-driven automatic analysis", () => {
  const schema = `analysis_test_${randomUUID().replaceAll("-", "")}`;
  let client: DocClient, store: DocDb, db: Db;
  beforeAll(async () => { client = new DocClient(poolConfigFromUrl(process.env.DATABASE_URL!)); await client.connect(); store = client.db(schema); db = store as unknown as Db; await ensureAnalysisIndexes(db); });
  beforeEach(async () => { localEnv(); for (const name of Object.values(C)) await db.collection(name).deleteMany({}); });
  afterAll(async () => { try { await store?.dropDatabase(); } finally { await client?.close(); } });
  async function settle(scope: { businessId: string; simulationRunId: string }) {
    await db.collection(C.watches).updateOne(scope, { $set: { changedAt: new Date(Date.now() - 4000).toISOString() } });
    await reconcileAnalysis(db, scope);
  }
  async function fixture() {
    const scope = { businessId: "nvidia_demo", simulationRunId: `test_${randomUUID().replaceAll("-", "")}` };
    const { world, rng } = createInitialWorld({ ...scope, catalogue: NVIDIA_DEMO_CATALOGUE, seed: 61, createdAt: "2026-10-27T00:00:00.000Z" });
    const events = [], orders = [];
    for (let i = 0; i < 2; i++) { const tick = new TickEngine(world, rng, "2026-10-27T00:00:00.000Z").run(); events.push(...tick.events); orders.push(...tick.orders); }
    await db.collection(COLLECTIONS.simulatorState).insertOne(world.state);
    await db.collection(COLLECTIONS.businessEvents).insertMany(events);
    await db.collection(COLLECTIONS.simulatedProducts).insertMany([...world.products.values()]);
    await db.collection(COLLECTIONS.simulatedCampaigns).insertMany([...world.campaigns.values()]);
    if (orders.length) await db.collection(COLLECTIONS.simulatedOrders).insertMany(orders);
    await watchAnalysis(db, scope);
    await reconcileAnalysis(db, scope); await settle(scope);
    return scope;
  }
  it("runs once per snapshot, preserves exact facts and excludes private simulator parameters", async () => {
    const scope = await fixture(), token = randomUUID(), model = vi.fn(async () => response());
    const packet = await buildAnalysisPacket(db, scope);
    for (const forbidden of ["scenarioParams", "activeScenario", "qualityScore", "popularity", "scenarioSeverity"]) expect(JSON.stringify(packet)).not.toContain(forbidden);
    expect(await claimAnalysisWorker(db, token)).toBe(true);
    expect(await processNextAnalysis(db, token, model)).toBe(true);
    const first = await analysisView(db, scope); expect(first.state).toBe("complete"); expect(first.latest?.output).toEqual(renderDecision(decision, packet).output); expect(first.latest?.packet).toEqual(packet);
    await reconcileAnalysis(db, scope, Date.now() + 8000);
    expect(await processNextAnalysis(db, token, model)).toBe(false); expect(model).toHaveBeenCalledTimes(1);
    expect((await analysisView(db, { ...scope, businessId: "other" })).latest).toBeNull();
  });
  it("detects an existing row update without updatedAt and regenerates while keeping the old snapshot", async () => {
    const scope = await fixture(), token = randomUUID(), model = vi.fn(async () => response()); await claimAnalysisWorker(db, token); await processNextAnalysis(db, token, model);
    const before = await analysisView(db, scope), revision = await sourceRevision(db, scope);
    await db.collection(COLLECTIONS.simulatedCampaigns).updateOne({ ...scope, campaignId: "cmp_nv_gaming" }, { $inc: { dailyBudgetMinor: 1000 } });
    expect(await sourceRevision(db, scope)).not.toBe(revision);
    await reconcileAnalysis(db, scope); expect((await analysisView(db, scope)).stale).toBe(true);
    await settle(scope); await processNextAnalysis(db, token, model);
    const after = await analysisView(db, scope); expect(after.stale).toBe(false); expect(after.latest?.id).not.toBe(before.latest?.id); expect(model).toHaveBeenCalledTimes(2);
    expect(before.latest?.packet.facts.find(fact => fact.id === "budget")?.current).not.toBe(after.latest?.packet.facts.find(fact => fact.id === "budget")?.current);
    expect(await db.collection(C.jobs).countDocuments({ ...scope, status: "complete" })).toBe(2);
  });
  it("does not publish an answer for data that changed during inference", async () => {
    const scope = await fixture(), token = randomUUID(); await claimAnalysisWorker(db, token);
    let resolve!: (value: ModelResponse) => void;
    let started!: () => void; const reached = new Promise<void>(done => { started = done; });
    const pending = processNextAnalysis(db, token, async () => { started(); return new Promise<ModelResponse>(done => { resolve = done; }); });
    await reached;
    await db.collection(COLLECTIONS.simulatedCampaigns).updateOne({ ...scope, campaignId: "cmp_nv_gaming" }, { $inc: { dailyBudgetMinor: 2000 } });
    await reconcileAnalysis(db, scope); await settle(scope);
    resolve(response()); await pending;
    expect((await analysisView(db, scope)).latest).toBeNull();
    await processNextAnalysis(db, token, async () => response());
    expect((await analysisView(db, scope)).state).toBe("complete");
  });
  it("allows only one worker owner and never publishes an invalid model answer", async () => {
    const scope = await fixture(), tokens = [randomUUID(), randomUUID()];
    const claims = await Promise.all(tokens.map(token => claimAnalysisWorker(db, token))); expect(claims.filter(Boolean)).toHaveLength(1);
    const model = vi.fn(async () => ({ ...response(), value: { ...decision, findingIds: ["not_in_snapshot"] } }));
    await processNextAnalysis(db, tokens[claims.indexOf(true)], model);
    const result = await analysisView(db, scope); expect(result.state).toBe("failed"); expect(result.latest).toBeNull(); expect(model).toHaveBeenCalledTimes(2);
    expect(await db.collection(COLLECTIONS.actionExecutions).countDocuments({})).toBe(0);
  });
  it("notices source deletion and ignores its own reports as data changes", async () => {
    const scope = await fixture(), before = await sourceRevision(db, scope);
    await db.collection(C.jobs).updateMany(scope, { $set: { completedAt: new Date().toISOString() } });
    expect(await sourceRevision(db, scope)).toBe(before);
    await db.collection(COLLECTIONS.businessEvents).deleteOne({ ...scope, type: "ad.metrics_observed" });
    expect(await sourceRevision(db, scope)).not.toBe(before);
  });
});
