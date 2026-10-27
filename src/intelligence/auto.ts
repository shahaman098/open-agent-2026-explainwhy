import "server-only";

import { after } from "next/server";
import { describeDbError, getDb } from "@/lib/mongodb";
import { drainJobs } from "@/intelligence/monitoring/process";
import { reconcileWindows } from "@/intelligence/monitoring/recovery";
import { COLLECTIONS } from "@/lib/collections";
import { MAX_ATTEMPTS } from "@/intelligence/monitoring/jobs";

const AUTO_MONITOR_ATTEMPTS = 20;
const AUTO_MONITOR_BACKOFF_MS = 1_500;

/**
 * Schedules a monitoring scan after a successful simulator tick has been persisted and its response sent. Runs outside
 * the tick's lock and response path, so simulated purchases and ticks are never blocked. Enabled in development unless
 * NORMAL_AUTO_MONITOR=false; elsewhere only when NORMAL_AUTO_MONITOR=true. Repeated scans are idempotent and a
 * scan that finds the lock held retries with bounded backoff.
 */
export function scheduleAutoMonitor(businessId: string, simulationRunId: string): boolean {
  const flag = process.env.NORMAL_AUTO_MONITOR;
  const enabled = flag === "true" || (flag !== "false" && process.env.NODE_ENV === "development");
  if (!enabled) return false;
  try {
    after(async () => {
      const db = await getDb();
      const scope = { businessId, simulationRunId };
      for (let attempt = 0; attempt < AUTO_MONITOR_ATTEMPTS; attempt++) {
        try {
          await reconcileWindows(db, scope);
          await drainJobs(db, scope);
          const pending = await db.collection(COLLECTIONS.monitoringJobs).countDocuments({ ...scope, status: { $ne: "completed" }, attempts: { $lt: MAX_ATTEMPTS } });
          if (!pending) return;
        } catch (error) {
          console.error("[auto-monitor]", describeDbError(error));
        }
        await new Promise((r) => setTimeout(r, AUTO_MONITOR_BACKOFF_MS));
      }
    });
    return true;
  } catch {
    return false; // outside a request scope (e.g. direct handler invocation in tests)
  }
}
