import "server-only";
import type { Db, Filter } from "mongodb";
import { z } from "zod";
import { Evidence, type EvidenceT } from "@normal/contracts";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import type { EvidenceCollectionDoc, EvidenceDetailDoc, ToolRunDoc } from "./persistence";
import { TOOL_NAMES } from "./types";

const BusinessId = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/).default("nike_demo");
const RunId = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);
export const EvidenceQuery = z.object({
  businessId: BusinessId, simulationRunId: RunId.optional(),
  tool: z.enum(TOOL_NAMES).optional(),
  category: z.enum(["sales", "advertising", "fulfillment", "reviews", "social", "technical", "inventory"]).optional(),
  dataOrigin: z.enum(["simulated", "public_reference", "normal_internal"]).optional(),
  from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();
export const TraceQuery = z.object({ businessId: BusinessId, simulationRunId: RunId.optional(), limit: z.coerce.number().int().min(1).max(20).default(5) }).strict();

type StoredEvidence = EvidenceT & { simulationRunId: string };
const canonical = (d: Record<string, unknown>): EvidenceT => { const { simulationRunId: _r, _id: _i, ...rest } = d; void _r; void _i; return Evidence.parse(rest); };

async function scopedInvestigation(db: Db, investigationId: string, q: { businessId: string; simulationRunId?: string }) {
  return db.collection(COLLECTIONS.investigations).findOne({ investigationId, ...q }, { projection: { _id: 0, investigationId: 1, businessId: 1, simulationRunId: 1, status: 1, evidenceIds: 1 } });
}

/** Canonical evidence for one investigation plus the internal detail/verification record for each item. */
export async function listInvestigationEvidence(investigationId: string, input: unknown, dbOverride?: Db) {
  const q = EvidenceQuery.parse(input);
  const db = dbOverride ?? (await getDb());
  const inv = await scopedInvestigation(db, investigationId, { businessId: q.businessId, ...(q.simulationRunId ? { simulationRunId: q.simulationRunId } : {}) });
  if (!inv) return null;
  const simulationRunId = inv.simulationRunId as string;
  const detailFilter: Filter<EvidenceDetailDoc> = { businessId: q.businessId, simulationRunId, investigationId };
  if (q.tool) detailFilter.tool = q.tool;
  if (q.dataOrigin) detailFilter.dataOrigin = q.dataOrigin;
  const details = await db.collection<EvidenceDetailDoc>(COLLECTIONS.evidenceDetails).find(detailFilter, { projection: { _id: 0 } }).limit(500).toArray();
  const byId = new Map(details.map((d) => [d.evidenceId, d]));
  const filter: Filter<StoredEvidence> = { businessId: q.businessId, simulationRunId, investigationId };
  if (q.tool || q.dataOrigin) filter.evidenceId = { $in: [...byId.keys()] };
  if (q.category) filter.category = q.category;
  if (q.from || q.to) filter["window.startAt"] = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lt: q.to } : {}) };
  const col = db.collection<StoredEvidence>(COLLECTIONS.evidence);
  const [total, docs, latest] = await Promise.all([
    col.countDocuments(filter),
    col.find(filter, { projection: { _id: 0 } }).sort({ retrievedAt: -1, evidenceId: 1 }).skip(q.offset).limit(q.limit).toArray(),
    db.collection<EvidenceCollectionDoc>(COLLECTIONS.evidenceCollections).findOne({ businessId: q.businessId, simulationRunId, investigationId }, { sort: { startedAt: -1 }, projection: { _id: 0, lock: 0 } }),
  ]);
  const items = docs.map((d) => {
    const detail = byId.get(d.evidenceId) ?? null;
    return { evidence: canonical(d), tool: detail?.tool ?? null, dataOrigin: detail?.dataOrigin ?? null, collectionId: detail?.collectionId ?? null, toolRunId: detail?.toolRunId ?? null,
      detail: detail?.detail ?? null, warnings: detail?.warnings ?? [], verification: detail?.verification ?? null, input: detail?.input ?? null,
      simulationRunId };
  });
  return { investigationId, businessId: q.businessId, simulationRunId, investigationStatus: inv.status, total, limit: q.limit, offset: q.offset, items, latestCollection: latest };
}

/** Collection history and every tool execution (parameters, status, duration, results, errors). */
export async function getEvidenceTrace(investigationId: string, input: unknown, dbOverride?: Db) {
  const q = TraceQuery.parse(input);
  const db = dbOverride ?? (await getDb());
  const inv = await scopedInvestigation(db, investigationId, { businessId: q.businessId, ...(q.simulationRunId ? { simulationRunId: q.simulationRunId } : {}) });
  if (!inv) return null;
  const simulationRunId = inv.simulationRunId as string;
  const collections = await db.collection<EvidenceCollectionDoc>(COLLECTIONS.evidenceCollections).find({ businessId: q.businessId, simulationRunId, investigationId }, { projection: { _id: 0, lock: 0 } }).sort({ startedAt: -1 }).limit(q.limit).toArray();
  const runs = collections.length ? await db.collection<ToolRunDoc>(COLLECTIONS.evidenceToolRuns).find({ businessId: q.businessId, investigationId, collectionId: { $in: collections.map((c) => c.collectionId) } }, { projection: { _id: 0 } }).sort({ startedAt: 1 }).limit(200).toArray() : [];
  return { investigationId, businessId: q.businessId, simulationRunId, investigationStatus: inv.status, evidenceIds: inv.evidenceIds ?? [], collections, toolRuns: runs };
}
