import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, Filter } from "mongodb";
import { COLLECTIONS } from "@/lib/collections";
import { DETECTOR_VERSION } from "@/intelligence/config";
import type { MonitoringJob } from "./schedule";

export const JOB_LEASE_MS = 120_000;
export const MAX_ATTEMPTS = 3;
export type Scope = { businessId: string; simulationRunId: string };
export const scopeOf = (j: Scope): Scope => ({ businessId: j.businessId, simulationRunId: j.simulationRunId });

/** Per-run queue lease prevents two workers from processing successive windows out of order. */
export async function claimJob(db: Db, scope?: Scope, now = new Date()): Promise<MonitoringJob | null> {
  const jobs = db.collection<MonitoringJob>(COLLECTIONS.monitoringJobs);
  // A crash on the final allowed attempt becomes an observable terminal failure.
  await jobs.updateMany({ ...scope, status: "running", attempts: { $gte: MAX_ATTEMPTS }, leaseUntil: { $lte: now } },
    { $set: { status: "failed", lastError: "Lease expired on final attempt", leaseToken: null, leaseUntil: null } });
  const candidates = await jobs.find({ ...scope, detectorVersion: DETECTOR_VERSION, status: { $ne: "completed" }, attempts: { $lt: MAX_ATTEMPTS } })
    .sort({ nextAttemptAt: 1, windowEnd: 1 }).limit(50).toArray();
  const tried = new Set<string>();
  for (const candidate of candidates) {
    const s = scopeOf(candidate), runKey = JSON.stringify(s);
    if (tried.has(runKey)) continue;
    tried.add(runKey);
    const token = randomUUID(), until = new Date(now.getTime() + JOB_LEASE_MS);
    try {
      await db.collection(COLLECTIONS.monitorState).updateOne(
        { ...s, $or: [{ jobLock: null }, { jobLock: { $exists: false } }, { "jobLock.until": { $lte: now } }] },
        { $set: { jobLock: { token, until } } }, { upsert: true },
      );
    } catch (e) { if ((e as { code?: number }).code === 11000) continue; throw e; }
    const oldest = await jobs.find({ ...s, detectorVersion: DETECTOR_VERSION, status: { $ne: "completed" }, attempts: { $lt: MAX_ATTEMPTS } })
      .sort({ windowEnd: 1, createdAt: 1 }).limit(1).next();
    const eligible: Filter<MonitoringJob> = { jobKey: oldest?.jobKey ?? "", attempts: { $lt: MAX_ATTEMPTS }, $or: [
      { status: { $in: ["pending", "failed"] }, nextAttemptAt: { $lte: now } }, { status: "running", leaseUntil: { $lte: now } },
    ] };
    const job = await jobs.findOneAndUpdate(eligible,
      { $set: { status: "running", leaseToken: token, leaseUntil: until }, $inc: { attempts: 1 } }, { returnDocument: "after" });
    if (job) return job;
    await releaseQueue(db, s, token);
  }
  return null;
}

export async function releaseQueue(db: Db, scope: Scope, token: string): Promise<void> {
  await db.collection(COLLECTIONS.monitorState).updateOne({ ...scope, "jobLock.token": token }, { $set: { jobLock: null } });
}

export async function renewJob(db: Db, job: MonitoringJob): Promise<boolean> {
  const now = new Date(), until = new Date(now.getTime() + JOB_LEASE_MS);
  const q = await db.collection(COLLECTIONS.monitorState).updateOne({ ...scopeOf(job), "jobLock.token": job.leaseToken, "jobLock.until": { $gt: now } }, { $set: { "jobLock.until": until } });
  if (!q.matchedCount) return false;
  const j = await db.collection<MonitoringJob>(COLLECTIONS.monitoringJobs).updateOne({ jobKey: job.jobKey, status: "running", leaseToken: job.leaseToken, leaseUntil: { $gt: now } }, { $set: { leaseUntil: until } });
  return j.matchedCount === 1;
}
