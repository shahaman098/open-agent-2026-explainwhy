import "server-only";

import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { DEFAULT_CONFIG, DETECTOR_VERSION, type DetectionConfig } from "@/intelligence/config";
import { correlate } from "@/intelligence/detection/correlation";
import { detect, type SkippedCheck } from "@/intelligence/detection/engine";
import { persistDetection, type FindingDoc, type PersistSummary } from "@/intelligence/detection/persistence";
import { HOUR_MS } from "@/intelligence/signals/rows";
import { loadGroupedRows, loadHorizon } from "@/intelligence/signals/load";
import { SignalSeries } from "@/intelligence/signals/series";
import type { CatalogueLabel } from "@/intelligence/types";

export const MonitorRunRequest = z.object({
  businessId: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/).default("nike_demo"),
  simulationRunId: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
  /** Analyse up to this hour boundary (defaults to the latest fully observed hour). */
  asOf: z.string().datetime({ offset: true }).optional(),
  /** Compute and return results without persisting anything. */
  dryRun: z.boolean().default(false),
}).strict();
export type MonitorRunRequestT = z.infer<typeof MonitorRunRequest>;

export class MonitorError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "MonitorError";
  }
}

export interface MonitorSummary {
  scanId: string;
  businessId: string;
  simulationRunId: string;
  detectorVersion: string;
  asOf: string;
  analysisWindow: { historyStart: string; replayFrom: string; asOf: string; watermark: string };
  repeatScan: boolean;
  dryRun: boolean;
  durationMs: number;
  metricsEvaluated: { signals: string[]; signalKeys: number };
  findings: { active: number; total: number; byTheme: Record<string, number> };
  persisted: PersistSummary | null;
  incidents: Array<{ title: string; severity: string; polarity: string; findings: number; active: boolean }>;
  skippedChecks: SkippedCheck[];
  pendingSignals: number;
}

const LOCK_MS = 120_000;

/** Observable catalogue labels only (name + category). Simulator latent parameters are never projected. */
export const CATALOGUE_PROJECTION = { _id: 0, productId: 1, name: 1, category: 1 } as const;

export async function loadCatalogue(db: Db, businessId: string, simulationRunId: string): Promise<Map<string, CatalogueLabel>> {
  const docs = await db.collection(COLLECTIONS.simulatedProducts).find({ businessId, simulationRunId }, { projection: CATALOGUE_PROJECTION }).toArray();
  return new Map(docs.map((d) => [d.productId as string, { name: d.name as string, category: d.category as string }]));
}

async function acquire(db: Db, businessId: string, simulationRunId: string): Promise<string | null> {
  const token = randomUUID();
  const now = new Date();
  try {
    const res = await db.collection(COLLECTIONS.monitorState).findOneAndUpdate(
      { businessId, simulationRunId, $or: [{ lock: null }, { lock: { $exists: false } }, { "lock.expiresAt": { $lt: now.toISOString() } }] },
      { $set: { lock: { token, expiresAt: new Date(now.getTime() + LOCK_MS).toISOString() } }, $setOnInsert: { businessId, simulationRunId, lastAsOf: null } },
      { upsert: true, returnDocument: "after" },
    );
    return res?.lock?.token === token ? token : null;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return null; // a concurrent first scan created the state doc
    throw error;
  }
}

async function release(db: Db, businessId: string, simulationRunId: string, token: string): Promise<void> {
  await db.collection(COLLECTIONS.monitorState).updateOne({ businessId, simulationRunId, "lock.token": token }, { $set: { lock: null } });
}

/**
 * Runs anomaly detection for one business + simulation run. Reads only `business_events` (via aggregation), product
 * labels and earlier detection records; never simulator state, scenario labels or ground truth. Never mutates
 * business state. Repeating a scan for the same `asOf` is idempotent.
 */
export async function runMonitor(input: unknown, options: { db?: Db; config?: DetectionConfig } = {}): Promise<MonitorSummary> {
  const req = MonitorRunRequest.parse(input);
  const db = options.db ?? (await getDb());
  const config = options.config ?? DEFAULT_CONFIG;
  await ensureIndexes(db);
  const started = Date.now();
  const { businessId, simulationRunId } = req;
  const horizon = await loadHorizon(db, businessId, simulationRunId);
  if (!horizon) throw new MonitorError(`No observations recorded for run ${simulationRunId}`, "no_observations", 404);
  const asOf = req.asOf ? new Date(req.asOf).toISOString() : horizon.watermark;
  if (Date.parse(asOf) % HOUR_MS !== 0) throw new MonitorError("asOf must fall on an hour boundary", "invalid_as_of", 400);
  if (Date.parse(asOf) > Date.parse(horizon.watermark)) throw new MonitorError(`asOf ${asOf} is after the latest fully observed hour ${horizon.watermark}`, "window_not_complete", 400);
  if (Date.parse(asOf) <= Date.parse(horizon.historyStart)) throw new MonitorError("asOf precedes the run's observable history", "invalid_as_of", 400);

  const token = req.dryRun ? null : await acquire(db, businessId, simulationRunId);
  if (!req.dryRun && !token) throw new MonitorError("A monitoring scan is already running for this run", "monitor_locked", 409);
  let leaseLost = false;
  const renew = async () => {
    if (!token) return;
    const r = await db.collection(COLLECTIONS.monitorState).updateOne(
      { businessId, simulationRunId, "lock.token": token, "lock.expiresAt": { $gt: new Date().toISOString() } },
      { $set: { "lock.expiresAt": new Date(Date.now() + LOCK_MS).toISOString() } },
    );
    if (!r.matchedCount) leaseLost = true;
  };
  const heartbeat = token ? setInterval(() => { void renew().catch(() => { leaseLost = true; }); }, LOCK_MS / 3) : null;
  try {
    const state = await db.collection(COLLECTIONS.monitorState).findOne({ businessId, simulationRunId });
    const lastAsOf = state?.detectorVersion === DETECTOR_VERSION ? (state.lastAsOf as string | null) : null;
    if (!req.dryRun && lastAsOf && Date.parse(asOf) < Date.parse(lastAsOf)) {
      throw new MonitorError(`asOf ${asOf} is older than the last processed window ${lastAsOf}; use dryRun to re-analyse history`, "stale_window", 409);
    }
    const loadStart = new Date(Math.max(Date.parse(horizon.historyStart), Date.parse(asOf) - (config.replayHorizonHours + 8 * 24) * HOUR_MS)).toISOString();
    const [rows, catalogue, openFindings] = await Promise.all([
      loadGroupedRows(db, businessId, simulationRunId, loadStart, asOf),
      loadCatalogue(db, businessId, simulationRunId),
      db.collection<FindingDoc>(COLLECTIONS.detectionFindings).find({ businessId, simulationRunId, status: "active" }, { projection: { _id: 0, windows: 1 } }).toArray(),
    ]);
    const priorOnsets = new Map<string, string>();
    for (const f of openFindings) for (const w of f.windows) if (w.resolvedAt === null) priorOnsets.set(w.episodeKey, w.onsetAt);
    const series = new SignalSeries(businessId, simulationRunId, loadStart, asOf, rows, catalogue);
    const run = detect(series, { config, priorOnsets });
    const incidents = correlate(run.findings, run.asOf, catalogue, config);
    const scanId = `scan_${simulationRunId}_${asOf.replace(/[^0-9]/g, "").slice(0, 12)}`;
    const repeatScan = lastAsOf === asOf;
    if (leaseLost) throw new MonitorError("Monitoring lease lost", "monitor_locked", 409);
    await renew();
    const persisted = req.dryRun ? null : await persistDetection({ db, businessId, simulationRunId, asOf, config, catalogue, lockToken: token! }, run, incidents);
    const byTheme: Record<string, number> = {};
    for (const f of run.findings.filter((x) => x.active)) byTheme[f.theme] = (byTheme[f.theme] ?? 0) + 1;
    const summary: MonitorSummary = {
      scanId, businessId, simulationRunId, detectorVersion: DETECTOR_VERSION, asOf,
      analysisWindow: { historyStart: horizon.historyStart, replayFrom: run.replayFrom, asOf, watermark: horizon.watermark },
      repeatScan, dryRun: req.dryRun, durationMs: Date.now() - started,
      metricsEvaluated: { signals: run.evaluatedSignals, signalKeys: run.evaluatedKeys },
      findings: { active: run.findings.filter((f) => f.active).length, total: run.findings.length, byTheme },
      persisted,
      incidents: incidents.map((i) => ({ title: i.title, severity: i.severity.level, polarity: i.polarity, findings: i.findingKeys.length, active: i.active })),
      skippedChecks: run.skipped, pendingSignals: run.pendingSignals,
    };
    if (!req.dryRun) {
      const now = new Date().toISOString();
      await db.collection(COLLECTIONS.monitorRuns).updateOne(
        { businessId, simulationRunId, asOf },
        { $set: { scanId, detectorVersion: DETECTOR_VERSION, lastScannedAt: now, durationMs: summary.durationMs, summary }, $setOnInsert: { businessId, simulationRunId, asOf, firstScannedAt: now }, $inc: { repeats: 1 } },
        { upsert: true },
      );
      await db.collection(COLLECTIONS.monitorState).updateOne({ businessId, simulationRunId, "lock.token": token },
        { $set: { detectorVersion: DETECTOR_VERSION, lastScanAt: now, lastScanId: scanId, lastAsOf: lastAsOf && Date.parse(lastAsOf) > Date.parse(asOf) ? lastAsOf : asOf } });
    }
    return summary;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (token) await release(db, businessId, simulationRunId, token);
  }
}

export async function monitorStatus(businessId: string, simulationRunId: string, db?: Db) {
  const d = db ?? (await getDb());
  const [state, recent, jobs, failedJobs, worker] = await Promise.all([
    d.collection(COLLECTIONS.monitorState).findOne({ businessId, simulationRunId }, { projection: { _id: 0, lock: 0, jobLock: 0 } }),
    d.collection(COLLECTIONS.monitorRuns).find({ businessId, simulationRunId }, { projection: { _id: 0, summary: 0 } }).sort({ lastScannedAt: -1 }).limit(10).toArray(),
    d.collection(COLLECTIONS.monitoringJobs).aggregate<{ _id: string; count: number }>([
      { $match: { businessId, simulationRunId, detectorVersion: DETECTOR_VERSION } }, { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
    d.collection(COLLECTIONS.monitoringJobs).find({ businessId, simulationRunId, status: "failed" }, { projection: { _id: 0, jobKey: 1, lastError: 1, attempts: 1, windowEnd: 1 } }).sort({ windowEnd: -1 }).limit(10).toArray(),
    d.collection(COLLECTIONS.monitoringWorkers).findOne({ workerId: "normal-monitor-watch" }),
  ]);
  const horizon = await loadHorizon(d, businessId, simulationRunId);
  const fresh = worker?.lastHeartbeatAt instanceof Date && Date.now() - worker.lastHeartbeatAt.getTime() < 45_000;
  const flag = process.env.NORMAL_AUTO_MONITOR;
  return { businessId, simulationRunId, lastAsOf: state?.lastAsOf ?? null, lastScanAt: state?.lastScanAt ?? null, watermark: horizon?.watermark ?? null, recentScans: recent,
    jobs: Object.fromEntries(jobs.map((j) => [j._id, j.count])), failedJobs,
    methodA: { enabled: flag === "true" || (flag !== "false" && process.env.NODE_ENV === "development") },
    worker: { connected: Boolean(fresh && worker?.connected && worker?.lock?.until > new Date()), lastHeartbeatAt: worker?.lastHeartbeatAt ?? null,
      lastReconciledAt: worker?.lastReconciledAt ?? null, lastError: worker?.lastError ?? null },
  };
}
