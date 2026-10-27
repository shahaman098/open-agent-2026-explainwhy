import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { DETECTOR_VERSION } from "@/intelligence/config";
import type { MonitorSummary } from "@/intelligence/monitor";
import { parseReadyWindow, stableKey, type ReadyWindow } from "./windows";

export interface MonitoringJob {
  jobKey: string; windowKey: string; businessId: string; simulationRunId: string;
  windowStart: string; windowEnd: string; detectorVersion: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number; createdAt: Date; nextAttemptAt: Date;
  leaseToken: string | null; leaseUntil: Date | null;
  completedAt?: Date; lastError?: string | null; summary?: MonitorSummary;
  supersededBy?: string;
}
export const jobKey = (w: ReadyWindow, version = DETECTOR_VERSION) => stableKey([w.businessId, w.simulationRunId, w.windowStart, w.windowEnd, version]);

/** Both triggers and reconciliation converge here. Scheduling is a majority-acknowledged unique upsert. */
export async function scheduleWindow(db: Db, input: ReadyWindow): Promise<string> {
  await ensureIndexes(db);
  const w = parseReadyWindow(input);
  const durable = await db.collection(COLLECTIONS.monitoringWindows).findOne({ windowKey: w.windowKey }, { projection: { _id: 0 } });
  if (!durable) throw new Error("Monitoring window has not been durably published");
  parseReadyWindow(durable);
  const key = jobKey(w), now = new Date();
  const job: MonitoringJob = {
    jobKey: key, windowKey: w.windowKey, businessId: w.businessId, simulationRunId: w.simulationRunId,
    windowStart: w.windowStart, windowEnd: w.windowEnd, detectorVersion: DETECTOR_VERSION,
    status: "pending", attempts: 0, createdAt: now, nextAttemptAt: now, leaseToken: null, leaseUntil: null,
  };
  try {
    await db.collection<MonitoringJob>(COLLECTIONS.monitoringJobs).updateOne({ jobKey: key }, { $setOnInsert: job }, { upsert: true, writeConcern: { w: "majority" } });
  } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; }
  return key;
}
