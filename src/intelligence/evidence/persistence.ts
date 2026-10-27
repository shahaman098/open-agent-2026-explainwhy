import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type { EvidenceT, InvestigationT } from "@normal/contracts";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import type { ToolSelection } from "./policies";
import type { DataOrigin, ToolName } from "./types";
import type { Verification } from "./verification";

export type CollectionMode = "initial" | "refresh";
export type CollectionStatus = "running" | "completed" | "partial" | "failed";

export interface EvidenceCollectionDoc {
  collectionId: string; businessId: string; simulationRunId: string; investigationId: string;
  mode: CollectionMode; cutoff: string; status: CollectionStatus;
  startedAt: Date; completedAt: Date | null; lock: { token: string; until: Date } | null;
  selectedTools: Array<Pick<ToolSelection, "tool" | "reason" | "role">>;
  completedTools: ToolName[]; failedTools: ToolName[]; emptyTools: ToolName[];
  evidenceIds: string[]; warnings: string[]; attempt: number;
  windows: { incident: { startAt: string; endAt: string }; baseline: { startAt: string; endAt: string } | null };
  error?: string | null;
}

export interface ToolRunDoc {
  toolRunId: string; collectionId: string; businessId: string; simulationRunId: string; investigationId: string;
  tool: ToolName; role: ToolSelection["role"]; reason: string; input: Record<string, unknown>;
  status: "completed" | "failed" | "empty"; startedAt: Date; completedAt: Date; durationMs: number;
  resultCount: number; evidenceIds: string[]; sourceRecordCount: number; warnings: string[]; error: string | null; emptyResult: string | null;
  dataSources: Array<{ collection?: string; externalSource?: string; description: string; origin: DataOrigin }>;
}

/** Internal detail record linked 1:1 to a canonical Evidence by evidenceId. Never part of the strict schema. */
export interface EvidenceDetailDoc {
  businessId: string; simulationRunId: string; investigationId: string; evidenceId: string; collectionId: string; toolRunId: string;
  tool: ToolName; input: Record<string, unknown>; dataOrigin: DataOrigin; detail: Record<string, unknown>; warnings: string[];
  verification: Verification; retrievedAt: string;
}

export const COLLECTION_LOCK_MS = 120_000;

export type Acquire =
  | { state: "acquired"; token: string; doc: EvidenceCollectionDoc }
  | { state: "in_progress"; doc: EvidenceCollectionDoc }
  | { state: "existing"; doc: EvidenceCollectionDoc };

/** One collection document per (investigation, cutoff). `initial` reuses a completed one; `refresh` re-executes in place. */
export async function acquireCollection(db: Db, seed: Omit<EvidenceCollectionDoc, "status" | "startedAt" | "completedAt" | "lock" | "completedTools" | "failedTools" | "emptyTools" | "evidenceIds" | "warnings" | "attempt">): Promise<Acquire> {
  await ensureIndexes(db);
  const col = db.collection<EvidenceCollectionDoc>(COLLECTIONS.evidenceCollections);
  const existing = await col.findOne({ collectionId: seed.collectionId }, { projection: { _id: 0 } });
  const now = new Date();
  if (existing) {
    if (existing.status === "running" && existing.lock && existing.lock.until > now) return { state: "in_progress", doc: existing };
    if (existing.status !== "running" && seed.mode === "initial") return { state: "existing", doc: existing };
  }
  const token = randomUUID();
  const res = await col.findOneAndUpdate(
    { collectionId: seed.collectionId, $or: [{ lock: null }, { lock: { $exists: false } }, { "lock.until": { $lte: now } }, { status: { $ne: "running" } }] },
    { $set: { ...seed, status: "running", startedAt: now, completedAt: null, lock: { token, until: new Date(now.getTime() + COLLECTION_LOCK_MS) }, completedTools: [], failedTools: [], emptyTools: [], evidenceIds: [], warnings: [], error: null },
      $inc: { attempt: 1 } },
    { upsert: true, returnDocument: "after", projection: { _id: 0 } },
  ).catch((e: { code?: number }) => { if (e.code === 11000) return null; throw e; });
  if (!res) { const doc = (await col.findOne({ collectionId: seed.collectionId }, { projection: { _id: 0 } }))!; return { state: "in_progress", doc }; }
  return { state: "acquired", token, doc: res };
}

export async function recordToolRun(db: Db, run: ToolRunDoc): Promise<void> {
  await db.collection<ToolRunDoc>(COLLECTIONS.evidenceToolRuns).replaceOne({ toolRunId: run.toolRunId }, run, { upsert: true });
}

export async function upsertEvidence(db: Db, evidence: EvidenceT, simulationRunId: string, detail: EvidenceDetailDoc): Promise<void> {
  await Promise.all([
    db.collection(COLLECTIONS.evidence).replaceOne({ businessId: evidence.businessId, evidenceId: evidence.evidenceId }, { ...evidence, simulationRunId }, { upsert: true }),
    db.collection<EvidenceDetailDoc>(COLLECTIONS.evidenceDetails).replaceOne({ businessId: detail.businessId, evidenceId: detail.evidenceId }, detail, { upsert: true }),
  ]);
}

export async function completeCollection(db: Db, collectionId: string, token: string, patch: Partial<EvidenceCollectionDoc>): Promise<void> {
  await db.collection<EvidenceCollectionDoc>(COLLECTIONS.evidenceCollections).updateOne({ collectionId, "lock.token": token }, { $set: { ...patch, lock: null, completedAt: new Date() } });
}

/** Links collected evidence to the canonical investigation (union) and moves `open` → `collecting_evidence`. Later statuses are never regressed. */
export async function linkEvidenceToInvestigation(db: Db, businessId: string, investigationId: string, evidenceIds: string[], updatedAt: string): Promise<void> {
  const col = db.collection<InvestigationT>(COLLECTIONS.investigations);
  await col.updateOne({ businessId, investigationId }, { $addToSet: { evidenceIds: { $each: evidenceIds } }, $set: { updatedAt } });
  await col.updateOne({ businessId, investigationId, status: "open" }, { $set: { status: "collecting_evidence" } });
}
