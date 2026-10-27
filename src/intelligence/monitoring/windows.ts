import "server-only";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import { MetricSnapshot } from "@normal/contracts";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { HOUR_MS } from "@/intelligence/signals/rows";

const id = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);
export const WindowInput = z.object({
  businessId: id, simulationRunId: id,
  windowStart: z.string().datetime(), windowEnd: z.string().datetime(),
  snapshotIds: z.array(z.string().min(1)).min(1).max(72),
}).strict().superRefine((w, ctx) => {
  const a = Date.parse(w.windowStart), b = Date.parse(w.windowEnd);
  if (a % HOUR_MS || b % HOUR_MS || b <= a || b - a > 72 * HOUR_MS) {
    ctx.addIssue({ code: "custom", message: "Monitoring windows require 1–72 complete UTC hours" });
  }
});
export type WindowInputT = z.infer<typeof WindowInput>;
export type ReadyWindow = WindowInputT & { windowKey: string; status: "ready"; readyAt: string };
export const stableKey = (parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export const windowKey = (w: WindowInputT) => stableKey([w.businessId, w.simulationRunId, w.windowStart, w.windowEnd]);

/** The producer calls this only AFTER committing events, metrics and its durable clock. */
export async function publishWindow(db: Db, input: WindowInputT): Promise<ReadyWindow> {
  const w = WindowInput.parse(input);
  await ensureIndexes(db);
  // Prove that every hour has a persisted, canonical, complete, global snapshot.
  const docs = await db.collection(COLLECTIONS.metricSnapshots).find({
    businessId: w.businessId, simulationRunId: w.simulationRunId, snapshotId: { $in: w.snapshotIds },
  }, { projection: { _id: 0, simulationRunId: 0 } }).toArray();
  const snapshots = docs.map((d) => MetricSnapshot.parse(d));
  const hours = (Date.parse(w.windowEnd) - Date.parse(w.windowStart)) / HOUR_MS;
  if (snapshots.length !== hours || new Set(w.snapshotIds).size !== hours) throw new Error("Incomplete monitoring snapshot coverage");
  for (let h = 0; h < hours; h++) {
    const start = new Date(Date.parse(w.windowStart) + h * HOUR_MS).toISOString();
    const end = new Date(Date.parse(start) + HOUR_MS).toISOString();
    if (!snapshots.some((s) => s.window.startAt === start && s.window.endAt === end && s.completeness === "complete" && Object.keys(s.dimension).length === 0)) {
      throw new Error("Partial or missing monitoring hour");
    }
  }
  const ready: ReadyWindow = { ...w, windowKey: windowKey(w), status: "ready", readyAt: new Date().toISOString() };
  try {
    await db.collection<ReadyWindow>(COLLECTIONS.monitoringWindows).updateOne(
      { windowKey: ready.windowKey }, { $setOnInsert: ready }, { upsert: true, writeConcern: { w: "majority" } },
    );
  } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; }
  return ready;
}

export function parseReadyWindow(raw: Record<string, unknown>): ReadyWindow {
  const { _id, windowKey: key, readyAt, status, ...input } = raw;
  void _id;
  const w = WindowInput.parse(input);
  if (key !== windowKey(w) || status !== "ready" || !z.string().datetime().safeParse(readyAt).success) throw new Error("Invalid monitoring-ready record");
  return { ...w, windowKey: key as string, readyAt: readyAt as string, status };
}
