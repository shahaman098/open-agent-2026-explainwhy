import "server-only";
import type { Db } from "mongodb";
import { z } from "zod";
import { Evidence, type EvidenceT } from "@normal/contracts";
import { COLLECTIONS } from "@/lib/collections";
import { describeDbError, getDb } from "@/lib/mongodb";
import { loadInvestigationContext, type InvestigationContext } from "./context";
import { selectTools, type ToolSelection } from "./policies";
import { acquireCollection, completeCollection, linkEvidenceToInvestigation, recordToolRun, upsertEvidence, type CollectionMode, type EvidenceCollectionDoc, type ToolRunDoc } from "./persistence";
import { collectionId as makeCollectionId, evidenceId, toolRunId } from "./provenance";
import { getTool } from "./registry";
import type { EvidenceDraft, ToolContext, ToolName } from "./types";
import { verifyEvidence } from "./verification";

export class EvidenceError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); this.name = "EvidenceError"; }
}

const Scoped = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);
export const CollectRequest = z.object({
  investigationId: z.string().regex(/^[A-Za-z0-9_.-]{1,160}$/),
  businessId: Scoped.default("nike_demo"),
  simulationRunId: Scoped.optional(),
  collectionMode: z.enum(["initial", "refresh"]).default("initial"),
}).strict();
export type CollectRequestT = z.infer<typeof CollectRequest>;

export const LIMITS = { maxToolCalls: 8, concurrency: 4, toolTimeoutMs: 25_000 } as const;

export interface ToolOutcome { tool: ToolName; status: ToolRunDoc["status"]; durationMs: number; evidenceIds: string[]; resultCount: number; error: string | null; emptyResult: string | null; warnings: string[]; toolRunId: string }
export interface CollectionSummary {
  collectionId: string; investigationId: string; businessId: string; simulationRunId: string; mode: CollectionMode; cutoff: string;
  status: EvidenceCollectionDoc["status"]; reused: boolean; startedAt: string; completedAt: string | null;
  selectedTools: Array<Pick<ToolSelection, "tool" | "reason" | "role">>; outcomes: ToolOutcome[]; evidenceIds: string[]; warnings: string[];
  windows: EvidenceCollectionDoc["windows"];
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} exceeded ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Executes one registered tool for an investigation: strict input validation, scope enforcement, timeout, verification,
 * persistence of canonical Evidence + internal detail and a durable trace. Shared by the deterministic policy today and
 * by the future Mubit investigator (which will call it with its own selections).
 */
export async function executeTool(ctx: InvestigationContext, selection: ToolSelection, collection: string): Promise<ToolOutcome> {
  const tool = getTool(selection.tool);
  const started = new Date(), t0 = Date.now();
  const runId = toolRunId(collection, selection.tool, selection.input);
  const base: Omit<ToolRunDoc, "status" | "completedAt" | "durationMs" | "resultCount" | "evidenceIds" | "sourceRecordCount" | "warnings" | "error" | "emptyResult"> = {
    toolRunId: runId, collectionId: collection, businessId: ctx.businessId, simulationRunId: ctx.simulationRunId, investigationId: ctx.investigation.investigationId,
    tool: selection.tool, role: selection.role, reason: selection.reason, input: selection.input, startedAt: started, dataSources: tool.dataSources,
  };
  const finish = async (patch: Pick<ToolRunDoc, "status" | "resultCount" | "evidenceIds" | "sourceRecordCount" | "warnings" | "error" | "emptyResult">): Promise<ToolOutcome> => {
    const durationMs = Date.now() - t0;
    await recordToolRun(ctx.db, { ...base, ...patch, completedAt: new Date(), durationMs });
    return { tool: selection.tool, status: patch.status, durationMs, evidenceIds: patch.evidenceIds, resultCount: patch.resultCount, error: patch.error, emptyResult: patch.emptyResult, warnings: patch.warnings, toolRunId: runId };
  };
  try {
    const input = tool.input.parse(selection.input);
    if (input.businessId !== ctx.businessId || input.simulationRunId !== ctx.simulationRunId) throw new EvidenceError("Tool input scope differs from the investigation scope", "scope_violation", 400);
    const toolCtx: ToolContext = { db: ctx.db, businessId: ctx.businessId, simulationRunId: ctx.simulationRunId, investigationId: ctx.investigation.investigationId, cutoff: ctx.cutoff, catalogue: ctx.catalogue };
    const result = await withTimeout(tool.run(toolCtx, input), LIMITS.toolTimeoutMs, selection.tool);
    const retrievedAt = new Date().toISOString();
    const ids: string[] = []; let sources = 0; const warnings = [...result.warnings];
    for (const draft of result.evidence) {
      const id = evidenceId(ctx.investigation.investigationId, selection.tool, draft.key, input);
      const evidence = toCanonical(ctx, id, draft, retrievedAt);
      const verification = await verifyEvidence(ctx.db, { businessId: ctx.businessId, simulationRunId: ctx.simulationRunId, cutoff: ctx.cutoff }, draft, evidence);
      if (!verification.passed) { warnings.push(`${draft.key}: verification failed (${verification.checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}); evidence not persisted`); continue; }
      await upsertEvidence(ctx.db, evidence, ctx.simulationRunId, { businessId: ctx.businessId, simulationRunId: ctx.simulationRunId, investigationId: ctx.investigation.investigationId, evidenceId: id, collectionId: collection,
        toolRunId: runId, tool: selection.tool, input: input as Record<string, unknown>, dataOrigin: draft.dataOrigin, detail: draft.detail, warnings: draft.warnings, verification, retrievedAt });
      ids.push(id); sources += draft.sourceRecords.length;
    }
    if (result.evidence.length && ids.length === 0) return finish({ status: "failed", resultCount: result.resultCount, evidenceIds: [], sourceRecordCount: 0, warnings, error: "Every evidence item failed verification", emptyResult: null });
    if (!ids.length) return finish({ status: "empty", resultCount: result.resultCount, evidenceIds: [], sourceRecordCount: 0, warnings, error: null, emptyResult: result.emptyResult ?? "Tool returned no evidence" });
    return finish({ status: "completed", resultCount: result.resultCount, evidenceIds: ids, sourceRecordCount: sources, warnings, error: null, emptyResult: null });
  } catch (error) {
    return finish({ status: "failed", resultCount: 0, evidenceIds: [], sourceRecordCount: 0, warnings: [], error: describeDbError(error).slice(0, 1000), emptyResult: null });
  }
}

function toCanonical(ctx: InvestigationContext, id: string, draft: EvidenceDraft, retrievedAt: string): EvidenceT {
  return Evidence.parse({
    schemaVersion: 1, businessId: ctx.businessId, evidenceId: id, investigationId: ctx.investigation.investigationId, category: draft.category,
    title: draft.title, observation: draft.observation, ...(draft.window ? { window: draft.window } : {}),
    measurements: draft.measurements.map((m) => ({ metric: m.metric, value: m.value, unit: m.unit, ...(m.baseline !== undefined ? { baseline: m.baseline } : {}) })),
    sourceRecords: [...new Map(draft.sourceRecords.map((r) => [`${r.collection}:${r.recordId}`, r])).values()].map((r) => ({ collection: r.collection, recordId: r.recordId, ...(r.sourceUrl ? { sourceUrl: r.sourceUrl } : {}) })),
    retrievedAt,
  });
}

async function runBounded(ctx: InvestigationContext, selections: ToolSelection[], collection: string): Promise<ToolOutcome[]> {
  const outcomes: ToolOutcome[] = new Array(selections.length);
  let next = 0;
  const worker = async () => { while (next < selections.length) { const i = next++; outcomes[i] = await executeTool(ctx, selections[i]!, collection); } };
  await Promise.all(Array.from({ length: Math.min(LIMITS.concurrency, selections.length) }, worker));
  return outcomes;
}

/** Deterministic initial (or refreshed) evidence collection for one investigation. Idempotent per data cutoff. */
export async function collectInvestigationEvidence(input: unknown, options: { db?: Db } = {}): Promise<CollectionSummary> {
  const req = CollectRequest.parse(input);
  const db = options.db ?? (await getDb());
  const ctx = await loadInvestigationContext(db, req.investigationId, { businessId: req.businessId, ...(req.simulationRunId ? { simulationRunId: req.simulationRunId } : {}) });
  if (!ctx) throw new EvidenceError(`Investigation ${req.investigationId} not found in scope`, "investigation_not_found", 404);
  const selections = selectTools(ctx).slice(0, LIMITS.maxToolCalls);
  // Keep previously persisted IDs intact, but only reuse a collection in this exact scope.
  // Older IDs omitted the business, although investigation IDs can repeat across businesses.
  const prior = await db.collection<EvidenceCollectionDoc>(COLLECTIONS.evidenceCollections).findOne({
    businessId: ctx.businessId, simulationRunId: ctx.simulationRunId, investigationId: ctx.investigation.investigationId, cutoff: ctx.cutoff,
  }, { projection: { collectionId: 1 } });
  const id = prior?.collectionId ?? makeCollectionId(ctx.businessId, ctx.simulationRunId, ctx.investigation.investigationId, ctx.cutoff);
  const acquired = await acquireCollection(db, { collectionId: id, businessId: ctx.businessId, simulationRunId: ctx.simulationRunId, investigationId: ctx.investigation.investigationId,
    mode: req.collectionMode, cutoff: ctx.cutoff, selectedTools: selections.map(({ tool, reason, role }) => ({ tool, reason, role })), windows: { incident: ctx.incidentWindow, baseline: ctx.baselineWindow ?? null } });
  if (acquired.state === "in_progress") throw new EvidenceError("Evidence collection is already running for this investigation and cutoff", "evidence_collection_in_progress", 409);
  if (acquired.state === "existing") return summarise(db, acquired.doc, true);
  const outcomes = await runBounded(ctx, selections, id);
  const evidenceIds = [...new Set(outcomes.flatMap((o) => o.evidenceIds))];
  const failed = outcomes.filter((o) => o.status === "failed"), completed = outcomes.filter((o) => o.status === "completed"), empty = outcomes.filter((o) => o.status === "empty");
  const status: EvidenceCollectionDoc["status"] = completed.length === 0 ? "failed" : failed.length ? "partial" : "completed";
  const warnings = [...new Set(outcomes.flatMap((o) => o.warnings))].slice(0, 50);
  if (evidenceIds.length) await linkEvidenceToInvestigation(db, ctx.businessId, ctx.investigation.investigationId, evidenceIds, new Date().toISOString());
  await completeCollection(db, id, acquired.token, { status, completedTools: completed.map((o) => o.tool), failedTools: failed.map((o) => o.tool), emptyTools: empty.map((o) => o.tool), evidenceIds, warnings,
    error: status === "failed" ? failed.map((o) => `${o.tool}: ${o.error}`).join("; ").slice(0, 1000) : null });
  return summarise(db, (await db.collection<EvidenceCollectionDoc>(COLLECTIONS.evidenceCollections).findOne({ collectionId: id }, { projection: { _id: 0 } }))!, false, outcomes);
}

async function summarise(db: Db, doc: EvidenceCollectionDoc, reused: boolean, outcomes?: ToolOutcome[]): Promise<CollectionSummary> {
  const runs = outcomes ?? (await db.collection<ToolRunDoc>(COLLECTIONS.evidenceToolRuns).find({ collectionId: doc.collectionId }, { projection: { _id: 0 } }).sort({ startedAt: 1 }).toArray())
    .map((r) => ({ tool: r.tool, status: r.status, durationMs: r.durationMs, evidenceIds: r.evidenceIds, resultCount: r.resultCount, error: r.error, emptyResult: r.emptyResult, warnings: r.warnings, toolRunId: r.toolRunId }));
  return { collectionId: doc.collectionId, investigationId: doc.investigationId, businessId: doc.businessId, simulationRunId: doc.simulationRunId, mode: doc.mode, cutoff: doc.cutoff, status: doc.status, reused,
    startedAt: new Date(doc.startedAt).toISOString(), completedAt: doc.completedAt ? new Date(doc.completedAt).toISOString() : null, selectedTools: doc.selectedTools, outcomes: runs, evidenceIds: doc.evidenceIds, warnings: doc.warnings, windows: doc.windows };
}
