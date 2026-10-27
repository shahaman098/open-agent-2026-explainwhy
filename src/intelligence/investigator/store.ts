import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { COLLECTIONS } from "@/lib/collections";
import { loadInvestigationContext } from "../evidence/context";
import { canonicalJson } from "../evidence/provenance";
import { Budget, InvestigationState, Scope, type StateT, type ScopeT, type ReasoningT, type ReportT } from "./schemas";
import { providerConfig, type CallMetadata, type ModelResponse } from "./provider";
import type { ResearchResult } from "./research";

export const LEASE_MS = 120_000;
export interface JobDoc extends StateT { leaseToken: string | null; leaseUntil: Date | null; plan: ReasoningT | null; executedChoices: string[]; researchDone: boolean; affected: string[]; deadline: number | null }
export interface CallDoc extends ScopeT { callId: string; jobId: string; task: string; promptVersion: string; promptFingerprint?: string | null; checksum: string; status: "pending" | "completed" | "failed"; startedAt: string; completedAt: string | null; metadata: Partial<CallMetadata> | null; result: ModelResponse | ResearchResult | null; error: string | null; ambiguous: boolean; reservedTokens: number; outputDiagnosisId: string | null; validationStatus: string | null; correctionId: string | null; adapterVersion: null }
export const jobScope = (s: ScopeT): ScopeT => ({ businessId: s.businessId, simulationRunId: s.simulationRunId, investigationId: s.investigationId });
export const digest = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex");
export const stateView = (doc: JobDoc): StateT => InvestigationState.parse(Object.fromEntries(Object.keys(InvestigationState.shape).map((key) => [key, doc[key as keyof JobDoc]])));
export async function ensureInvestigatorIndexes(db: Db) {
  await Promise.all([
    db.collection(COLLECTIONS.investigationJobs).createIndex({ jobId: 1 }, { unique: true }),
    db.collection(COLLECTIONS.investigationJobs).createIndex({ businessId: 1, simulationRunId: 1, investigationId: 1 }, { unique: true }),
    db.collection(COLLECTIONS.investigationJobs).createIndex({ status: 1, leaseUntil: 1, createdAt: 1 }),
    db.collection(COLLECTIONS.investigationCalls).createIndex({ callId: 1 }, { unique: true }),
    db.collection(COLLECTIONS.investigationCalls).createIndex({ businessId: 1, simulationRunId: 1, investigationId: 1, startedAt: 1 }),
    db.collection(COLLECTIONS.investigationReports).createIndex({ reportId: 1 }, { unique: true }),
    db.collection(COLLECTIONS.externalSources).createIndex({ businessId: 1, simulationRunId: 1, investigationId: 1, sourceId: 1 }, { unique: true }),
  ]);
}
export function defaultBudget() {
  return Budget.parse({ maxRounds: Number(process.env.NORMAL_INVESTIGATION_MAX_ROUNDS || 5), maxTools: 12, maxResearchRounds: process.env.NORMAL_EXTERNAL_RESEARCH_ENABLED === "true" ? 2 : 0, maxSources: 8, maxCalls: 10,
    maxTokens: Number(process.env.NORMAL_INVESTIGATION_MAX_TOKENS || 180000), maxWallMs: Number(process.env.NORMAL_INVESTIGATION_TIMEOUT_MS || 600000), maxCostUsd: process.env.NORMAL_INVESTIGATION_MAX_COST_USD ? Number(process.env.NORMAL_INVESTIGATION_MAX_COST_USD) : null });
}
export async function startInvestigation(db: Db, input: unknown): Promise<JobDoc> {
  const scope = Scope.parse(input);
  const existing = await db.collection<JobDoc>(COLLECTIONS.investigationJobs).findOne(scope, { projection: { _id: 0 } });
  if (existing) return existing;
  providerConfig();
  const ctx = await loadInvestigationContext(db, scope.investigationId, scope);
  if (!ctx) throw new Error("investigation_not_found");
  if (["planned", "closed"].includes(ctx.investigation.status)) throw new Error("investigation_closed");
  const budget = defaultBudget();
  if (budget.maxCostUsd !== null && (!process.env.NORMAL_INPUT_USD_PER_MILLION || !process.env.NORMAL_OUTPUT_USD_PER_MILLION || budget.maxResearchRounds > 0)) throw new Error("cost_cap_requires_rates_and_research_disabled");
  await ensureInvestigatorIndexes(db);
  const now = new Date().toISOString();
  const seed: JobDoc = { schemaVersion: 1, jobId: `aij_${digest(scope).slice(0, 24)}`, ...scope, status: "queued", stage: "queued", createdAt: now, updatedAt: now, startedAt: null, completedAt: null, round: 0, toolCount: 0, researchCount: 0, sourceCount: 0, callCount: 0, reservedTokens: 0, actualTokens: 0, estimatedCostUsd: 0, budget, cutoff: ctx.cutoff, incidentWindow: ctx.incidentWindow, baselineWindow: ctx.baselineWindow || null, evidenceIds: [], sourceIds: [], hypotheses: [], steps: [], error: null, stopReason: null, reportId: null, attempts: 0, leaseToken: null, leaseUntil: null, plan: null, executedChoices: [], researchDone: false, affected: [...ctx.affected.campaigns, ...ctx.affected.products, ...ctx.affected.channels], deadline: null };
  stateView(seed);
  await db.collection<JobDoc>(COLLECTIONS.investigationJobs).updateOne(scope, { $setOnInsert: seed }, { upsert: true }).catch((e: { code?: number }) => { if (e.code !== 11000) throw e; });
  return (await db.collection<JobDoc>(COLLECTIONS.investigationJobs).findOne(scope, { projection: { _id: 0 } }))!;
}
export async function claimInvestigation(db: Db, scope?: ScopeT): Promise<JobDoc | null> {
  const now = new Date();
  await db.collection<JobDoc>(COLLECTIONS.investigationJobs).updateMany({ ...scope, status: "running", attempts: { $gte: 3 }, leaseUntil: { $lte: now } }, { $set: { status: "failed", error: "Worker lease expired on final attempt", stage: "failed", completedAt: now.toISOString(), updatedAt: now.toISOString(), leaseToken: null, leaseUntil: null } });
  return db.collection<JobDoc>(COLLECTIONS.investigationJobs).findOneAndUpdate({ ...scope, attempts: { $lt: 3 }, $or: [{ status: "queued" }, { status: "running", leaseUntil: { $lte: now } }] },
    { $set: { status: "running", leaseToken: randomUUID(), leaseUntil: new Date(now.getTime() + LEASE_MS), updatedAt: now.toISOString() }, $inc: { attempts: 1 } }, { returnDocument: "after", sort: { createdAt: 1 }, projection: { _id: 0 } });
}
export async function saveJob(db: Db, job: JobDoc): Promise<void> {
  stateView(job);
  job.updatedAt = new Date().toISOString();
  const { leaseUntil: _lease, ...patch } = job; void _lease;
  const r = await db.collection<JobDoc>(COLLECTIONS.investigationJobs).updateOne({ jobId: job.jobId, leaseToken: job.leaseToken, status: "running", leaseUntil: { $gt: new Date() } }, { $set: patch });
  if (r.matchedCount !== 1) throw new Error("lease_lost_or_cancelled");
}
export async function renewLease(db: Db, job: JobDoc): Promise<boolean> {
  const now = new Date();
  const result = await db.collection<JobDoc>(COLLECTIONS.investigationJobs).updateOne({ jobId: job.jobId, status: "running", leaseToken: job.leaseToken, leaseUntil: { $gt: now } }, { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS) } });
  return result.matchedCount === 1;
}
export async function cancelInvestigation(db: Db, scope: ScopeT) {
  const now = new Date().toISOString();
  return db.collection<JobDoc>(COLLECTIONS.investigationJobs).findOneAndUpdate({ ...scope, status: { $in: ["queued", "running"] } }, { $set: { status: "cancelled", stage: "cancelled", updatedAt: now, completedAt: now, leaseToken: null, leaseUntil: null } }, { returnDocument: "after", projection: { _id: 0 } });
}
export async function readInvestigation(db: Db, scope: ScopeT) {
  const job = await db.collection<JobDoc>(COLLECTIONS.investigationJobs).findOne(scope, { projection: { _id: 0 } });
  if (!job) return { state: null, report: null, sources: [], calls: [], researchTraces: [] };
  const [report, sources, rawCalls] = await Promise.all([
    job.reportId ? db.collection<{ reportId: string; report: ReportT }>(COLLECTIONS.investigationReports).findOne({ ...scope, reportId: job.reportId }, { projection: { _id: 0 } }) : null,
    db.collection(COLLECTIONS.externalSources).find(scope, { projection: { _id: 0 } }).toArray(),
    db.collection<CallDoc>(COLLECTIONS.investigationCalls).find({ ...scope, jobId: job.jobId }, { projection: { _id: 0 } }).sort({ startedAt: 1 }).toArray(),
  ]);
  const calls = rawCalls.map(({ result: _result, ...c }) => { void _result; return c; });
  const researchTraces = rawCalls.filter((c) => c.task === "external_research" && c.result && "queries" in c.result).map((c) => ({ callId: c.callId, ...(c.result as ResearchResult) }));
  return { state: stateView(job), report: report?.report || null, sources, calls, researchTraces };
}
