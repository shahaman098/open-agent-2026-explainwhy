import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS } from "@/lib/collections";
import { describeDbError } from "@/lib/mongodb";
import { runMonitor, type MonitorSummary } from "@/intelligence/monitor";
import { claimJob, JOB_LEASE_MS, releaseQueue, renewJob, scopeOf, type Scope } from "./jobs";
import type { MonitoringJob } from "./schedule";

export async function processNext(db: Db, scope?: Scope, detector = runMonitor): Promise<MonitoringJob | null> {
  const job = await claimJob(db, scope);
  if (!job) return null;
  let lost = false;
  const timer = setInterval(() => { void renewJob(db, job).then((ok) => { if (!ok) lost = true; }).catch(() => { lost = true; }); }, JOB_LEASE_MS / 3);
  const owned = () => ({ jobKey: job.jobKey, status: "running" as const, leaseToken: job.leaseToken, leaseUntil: { $gt: new Date() } });
  try {
    let summary: MonitorSummary | undefined;
    let supersededBy: string | undefined;
    try {
      summary = await detector({ ...scopeOf(job), asOf: job.windowEnd }, { db });
    } catch (e) {
      if ((e as { code?: string }).code !== "stale_window") throw e;
      // Legacy/manual scans may already have replayed this interval. Never overwrite newer incident state.
      const scan = await db.collection(COLLECTIONS.monitorRuns).findOne({ ...scopeOf(job), asOf: { $gte: job.windowEnd }, detectorVersion: job.detectorVersion }, { sort: { asOf: 1 } });
      if (!scan) throw e;
      supersededBy = scan.scanId as string;
    }
    if (lost || !(await renewJob(db, job))) throw new Error("Monitoring job lease lost");
    await db.collection<MonitoringJob>(COLLECTIONS.monitoringJobs).updateOne(owned(), { $set: {
      status: "completed", completedAt: new Date(), leaseToken: null, leaseUntil: null, lastError: null,
      ...(summary ? { summary } : {}), ...(supersededBy ? { supersededBy } : {}),
    } }, { writeConcern: { w: "majority" } });
  } catch (error) {
    const busy = (error as { code?: string }).code === "monitor_locked";
    await db.collection<MonitoringJob>(COLLECTIONS.monitoringJobs).updateOne(owned(), {
      $set: { status: busy ? "pending" : "failed", leaseToken: null, leaseUntil: null,
        nextAttemptAt: new Date(Date.now() + Math.min(30_000, 1_000 * 2 ** job.attempts)), lastError: describeDbError(error).slice(0, 1000) },
      ...(busy ? { $inc: { attempts: -1 } } : {}),
    });
  } finally {
    clearInterval(timer);
    await releaseQueue(db, scopeOf(job), job.leaseToken!);
  }
  return db.collection<MonitoringJob>(COLLECTIONS.monitoringJobs).findOne({ jobKey: job.jobKey }, { projection: { _id: 0 } });
}

/** Bounded request-side drain; durable leftovers are picked up by the worker or a later request. */
export async function drainJobs(db: Db, scope?: Scope, maxJobs = 8): Promise<number> {
  let n = 0;
  for (; n < maxJobs; n++) {
    const job = await processNext(db, scope);
    if (!job || job.status !== "completed") break;
  }
  return n;
}
