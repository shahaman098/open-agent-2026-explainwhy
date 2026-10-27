import "server-only";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { MonitorError, MonitorRunRequest, runMonitor } from "@/intelligence/monitor";
import { loadHorizon } from "@/intelligence/signals/load";
import { HOUR_MS } from "@/intelligence/signals/rows";
import { snapshotId } from "@/analytics/metrics";
import { publishWindow, parseReadyWindow } from "./windows";
import { scheduleWindow, type MonitoringJob } from "./schedule";
import { reconcileWindows } from "./recovery";
import { drainJobs } from "./process";

export async function runScheduledMonitor(input: unknown) {
  const req = MonitorRunRequest.parse(input);
  if (req.dryRun) return runMonitor(req);
  const db = await getDb(), scope = { businessId: req.businessId, simulationRunId: req.simulationRunId };
  const horizon = await loadHorizon(db, req.businessId, req.simulationRunId);
  if (!horizon) throw new MonitorError("No completed monitoring windows", "no_observations", 404);
  const end = req.asOf ? new Date(req.asOf).toISOString() : horizon.watermark;
  if (Date.parse(end) % HOUR_MS || end > horizon.watermark || end <= horizon.historyStart) {
    throw new MonitorError("asOf must identify a completed hour", "invalid_as_of", 400);
  }
  const existing = await db.collection(COLLECTIONS.monitoringWindows).findOne({ ...scope, windowEnd: end }, { projection: { _id: 0 } });
  const start = new Date(Date.parse(end) - HOUR_MS).toISOString();
  const ready = existing ? parseReadyWindow(existing) : await publishWindow(db, { ...scope, windowStart: start, windowEnd: end,
    snapshotIds: [snapshotId({ ...scope, dimension: {} }, start, end)] });
  const key = await scheduleWindow(db, ready);
  const jobs = db.collection<MonitoringJob>(COLLECTIONS.monitoringJobs);
  const previous = await jobs.findOne({ jobKey: key });
  if (previous?.status === "completed" && previous.summary) return { ...previous.summary, repeatScan: true };
  await reconcileWindows(db, scope);
  await drainJobs(db, scope);
  const result = await jobs.findOne({ jobKey: key });
  if (result?.summary) return result.summary;
  if (result?.supersededBy) throw new MonitorError("A newer scan already covers this window; use dryRun to inspect history", "stale_window", 409);
  throw new MonitorError("Monitoring is queued or retrying; inspect monitoring status", "monitor_locked", 409);
}
