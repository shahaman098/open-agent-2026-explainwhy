import "server-only";
import { randomUUID } from "node:crypto";
import type { ChangeStream, Db, Document, ResumeToken } from "mongodb";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { describeDbError } from "@/lib/mongodb";
import { parseReadyWindow } from "./windows";
import { scheduleWindow } from "./schedule";
import { reconcileWindows } from "./recovery";
import { drainJobs } from "./process";
import type { Scope } from "./jobs";

export const WATCHER_ID = "normal-monitor-watch";
const WATCH_LEASE_MS = 120_000;
const invalidResume = (e: unknown) => [260, 280, 286].includes((e as { code?: number }).code ?? 0);

/** Opens and actually polls a cursor; a replica-set hello alone does not prove permissions/support. */
export async function checkChangeStreams(db: Db): Promise<{ supported: true; topology: string }> {
  const hello = await db.command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") throw new Error("Change Streams require a replica set or sharded cluster");
  const stream = db.collection(COLLECTIONS.monitoringWindows).watch([{ $match: { operationType: "insert" } }], { maxAwaitTimeMS: 500 });
  try { await stream.tryNext(); } finally { await stream.close(); }
  return { supported: true, topology: hello.setName ? "replica set" : "sharded cluster" };
}

/** Exported so integration tests can fault the durable handoff independently of the cursor transport. */
export async function scheduleAndCheckpoint(db: Db, document: Document, resumeToken: ResumeToken, workerId: string, ownerToken: string): Promise<string> {
  const ready = parseReadyWindow(document);
  const key = await scheduleWindow(db, ready);
  const checkpoint = await db.collection(COLLECTIONS.monitoringWorkers).updateOne(
    { workerId, "lock.token": ownerToken, "lock.until": { $gt: new Date() } },
    { $set: { resumeToken, checkpointAt: new Date(), lastScheduledJobKey: key } }, { writeConcern: { w: "majority" } },
  );
  if (!checkpoint.matchedCount) throw new Error("Watcher lease lost before checkpoint");
  return key;
}

/**
 * A replayed insert whose window has since been deleted (run reset/cleanup) or is no longer a valid ready record can
 * never be scheduled. Retrying it with the same resume token would poison the stream forever, so it is skipped and the
 * checkpoint advances past it. A window that still exists and validates is a transient failure and must be retried.
 */
export async function isUnschedulableEvent(db: Db, document: Document | undefined): Promise<boolean> {
  const windowKey = document?.windowKey;
  if (typeof windowKey !== "string") return true;
  const durable = await db.collection(COLLECTIONS.monitoringWindows).findOne({ windowKey }, { projection: { _id: 0 } });
  if (!durable) return true;
  try { parseReadyWindow(durable); return false; } catch { return true; }
}

async function skipEvent(db: Db, change: { fullDocument?: Document; _id: ResumeToken }, workerId: string, ownerToken: string, error: unknown): Promise<void> {
  const checkpoint = await db.collection(COLLECTIONS.monitoringWorkers).updateOne(
    { workerId, "lock.token": ownerToken, "lock.until": { $gt: new Date() } },
    { $set: { resumeToken: change._id, checkpointAt: new Date(), lastSkippedWindowKey: change.fullDocument?.windowKey ?? null,
      lastError: `Skipped change event for a deleted or invalid window: ${describeDbError(error).slice(0, 500)}` } },
    { writeConcern: { w: "majority" } },
  );
  if (!checkpoint.matchedCount) throw new Error("Watcher lease lost before checkpoint");
}

interface WatchOptions {
  signal: AbortSignal;
  workerId?: string;
  reconcileMs?: number;
  maxJobsPerCycle?: number;
  /** Producer recovery is supplied by the entrypoint; the detector never imports producer internals. */
  recoverProducer?: () => Promise<void>;
  onConnected?: () => void;
  scope?: Scope;
}

export async function runWatcher(db: Db, options: WatchOptions): Promise<void> {
  await ensureIndexes(db);
  const workers = db.collection(COLLECTIONS.monitoringWorkers);
  const workerId = options.workerId ?? WATCHER_ID, token = randomUUID();
  const now = new Date();
  let state: Document | null;
  try {
    state = await workers.findOneAndUpdate({ workerId, $or: [{ lock: null }, { lock: { $exists: false } }, { "lock.until": { $lte: now } }] },
      { $set: { lock: { token, until: new Date(now.getTime() + WATCH_LEASE_MS) }, connected: false, startedAt: now } }, { upsert: true, returnDocument: "after" });
  } catch (e) { if ((e as { code?: number }).code === 11000) throw new Error("A watcher with this workerId is already running"); throw e; }
  const owned = { workerId, "lock.token": token };
  let stream: ChangeStream | null = null;
  let resumeToken = state?.resumeToken as ResumeToken | undefined;
  let lost = false, connected = false, lastPollAt = 0, nextConnectAt = 0, failures = 0, nextReconcileAt = 0;
  let heartbeatWork: Promise<unknown> = Promise.resolve();
  const heartbeat = setInterval(() => {
    heartbeatWork = heartbeatWork.then(async () => {
      const r = await workers.updateOne({ ...owned, "lock.until": { $gt: new Date() } }, { $set: {
        "lock.until": new Date(Date.now() + WATCH_LEASE_MS), lastHeartbeatAt: new Date(), connected: connected && Date.now() - lastPollAt < 45_000,
      } });
      if (!r.matchedCount) lost = true;
    }).catch(() => { lost = true; });
  }, 10_000);
  const closeOnAbort = () => { void stream?.close().catch(() => {}); };
  options.signal.addEventListener("abort", closeOnAbort, { once: true });
  try {
    while (!options.signal.aborted && !lost) {
      // Reconciliation and processing continue even when the stream transport is unavailable.
      if (Date.now() >= nextReconcileAt) {
        try {
          await options.recoverProducer?.();
          await reconcileWindows(db, options.scope);
          await workers.updateOne(owned, { $set: { lastReconciledAt: new Date() } });
        } catch (e) { await workers.updateOne(owned, { $set: { lastError: describeDbError(e).slice(0, 1000) } }); }
        nextReconcileAt = Date.now() + (options.reconcileMs ?? 30_000);
      }
      if (Date.now() >= nextConnectAt && !options.signal.aborted) {
        try {
          if (!stream) stream = db.collection(COLLECTIONS.monitoringWindows).watch([{ $match: { operationType: "insert", ...(options.scope ? {
            "fullDocument.businessId": options.scope.businessId, "fullDocument.simulationRunId": options.scope.simulationRunId,
          } : {}) } }], {
            ...(resumeToken ? { resumeAfter: resumeToken } : {}), maxAwaitTimeMS: 1_000,
          });
          const change = await stream.tryNext();
          lastPollAt = Date.now(); failures = 0;
          if (!connected) {
            connected = true;
            await workers.updateOne(owned, { $set: { connected: true, lastHeartbeatAt: new Date(), lastError: null } });
            options.onConnected?.();
          }
          if (change?.operationType === "insert") {
            try {
              await scheduleAndCheckpoint(db, change.fullDocument, change._id, workerId, token);
            } catch (e) {
              if (!(await isUnschedulableEvent(db, change.fullDocument))) throw e;
              await skipEvent(db, change, workerId, token, e);
            }
            resumeToken = change._id;
          }
        } catch (e) {
          connected = false;
          await stream?.close().catch(() => {}); stream = null;
          if (options.signal.aborted) break;
          if (invalidResume(e)) {
            resumeToken = undefined;
            await workers.updateOne(owned, { $unset: { resumeToken: "" } });
            nextReconcileAt = 0;
          }
          await workers.updateOne(owned, { $set: { connected: false, lastError: describeDbError(e).slice(0, 1000), lastHeartbeatAt: new Date() } });
          nextConnectAt = Date.now() + Math.min(30_000, 1_000 * 2 ** Math.min(5, failures++));
        }
      }
      if (!options.signal.aborted && !lost) await drainJobs(db, options.scope, options.maxJobsPerCycle ?? 4);
      if (!options.signal.aborted) await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); options.signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, 250);
        options.signal.addEventListener("abort", done, { once: true });
      });
    }
  } finally {
    clearInterval(heartbeat);
    options.signal.removeEventListener("abort", closeOnAbort);
    await stream?.close().catch(() => {});
    await heartbeatWork;
    await workers.updateOne(owned, { $set: { connected: false, stoppedAt: new Date(), lock: null } });
  }
}
