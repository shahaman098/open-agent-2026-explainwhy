import "server-only";

import type { Db } from "mongodb";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { loadState } from "@/simulator/persistence";
import { getActiveRunId } from "@/simulator/runtime";
import type { SimulatorStateDoc } from "@/simulator/state";
import { AdapterError, type ActionContext } from "@/adapters/types";

export interface ResolvedContext {
  db: Db;
  state: SimulatorStateDoc;
  runId: string;
}

export async function resolveContext(ctx: Pick<ActionContext, "businessId" | "simulationRunId" | "db">): Promise<ResolvedContext> {
  const db = ctx.db ?? (await getDb());
  await ensureIndexes(db);
  const runId = ctx.simulationRunId ?? (await getActiveRunId(ctx.businessId, db));
  if (!runId) throw new AdapterError("No active simulation run for this business", "no_active_run");
  const state = await loadState(db, ctx.businessId, runId);
  if (!state) throw new AdapterError(`Run ${runId} not found`, "run_not_found");
  return { db, state, runId };
}

export interface ActionReceipt<T = unknown> {
  businessId: string;
  simulationRunId: string;
  idempotencyKey: string;
  actionId: string;
  toolName: string;
  emittedEventIds: string[];
  affectedEntityIds: string[];
  verification: string;
  state: T;
  recordedAt: string;
}

const RECEIPTS = COLLECTIONS.actionReceipts;

export async function ensureReceiptIndex(db: Db): Promise<void> {
  await db.collection(RECEIPTS).createIndex({ businessId: 1, idempotencyKey: 1 }, { unique: true });
}

export async function findReceipt<T>(db: Db, businessId: string, idempotencyKey: string): Promise<ActionReceipt<T> | null> {
  return db.collection<ActionReceipt<T>>(RECEIPTS).findOne({ businessId, idempotencyKey }, { projection: { _id: 0 } });
}

export async function saveReceipt<T>(db: Db, receipt: ActionReceipt<T>): Promise<void> {
  await ensureReceiptIndex(db);
  await db.collection<ActionReceipt<T>>(RECEIPTS).updateOne(
    { businessId: receipt.businessId, idempotencyKey: receipt.idempotencyKey }, { $setOnInsert: receipt }, { upsert: true },
  );
}

export const RECEIPTS_COLLECTION = RECEIPTS;
export { COLLECTIONS };
