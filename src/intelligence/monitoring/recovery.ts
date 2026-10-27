import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS } from "@/lib/collections";
import { DETECTOR_VERSION } from "@/intelligence/config";
import { scheduleWindow } from "./schedule";
import { parseReadyWindow } from "./windows";
import type { Scope } from "./jobs";

/** Anti-join avoids starving newer windows behind a fixed first page of completed work. */
export async function reconcileWindows(db: Db, scope?: Scope, limit = 100): Promise<number> {
  const missing = await db.collection(COLLECTIONS.monitoringWindows).aggregate([
    { $match: { ...scope, status: "ready" } },
    { $lookup: { from: COLLECTIONS.monitoringJobs, let: { key: "$windowKey" }, pipeline: [
      { $match: { $expr: { $and: [{ $eq: ["$windowKey", "$$key"] }, { $eq: ["$detectorVersion", DETECTOR_VERSION] }] } } },
      { $project: { _id: 1 } },
    ], as: "jobs" } },
    { $match: { jobs: { $size: 0 } } }, { $sort: { windowEnd: 1 } }, { $limit: limit }, { $project: { jobs: 0, _id: 0 } },
  ]).toArray();
  for (const row of missing) await scheduleWindow(db, parseReadyWindow(row));
  return missing.length;
}
