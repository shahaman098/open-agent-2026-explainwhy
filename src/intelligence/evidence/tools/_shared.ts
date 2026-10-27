import type { Db, Document, Filter } from "mongodb";
import type { MetricSnapshotT } from "@normal/contracts";
import { COLLECTIONS } from "@/lib/collections";
import type { Measurement, SourceRef, ToolContext, WindowT } from "../types";

export const scopeOf = (ctx: ToolContext) => ({ businessId: ctx.businessId, simulationRunId: ctx.simulationRunId });
export const MAX_SAMPLE = 200;

export function pctChange(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null || !Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return null;
  return Math.round(((current - baseline) / Math.abs(baseline)) * 1000) / 10;
}
/** Signed percentage text for observations; "n/a" when a baseline is missing or zero. */
export function pc(current: number | null, baseline: number | null): string {
  const v = pctChange(current, baseline);
  return v === null ? "n/a" : `${v > 0 ? "+" : ""}${v}%`;
}
export const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);
export const round = (v: number, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;
export const hoursOf = (w: WindowT) => (Date.parse(w.endAt) - Date.parse(w.startAt)) / 3_600_000;

/** Clamp a window so it never reads beyond the run's latest fully observed hour. */
export function clampToCutoff(w: WindowT, cutoff: string): WindowT {
  return w.endAt > cutoff ? { startAt: w.startAt, endAt: cutoff } : w;
}

export function measurement(metric: string, value: number | null, unit: string, baseline?: number | null): Measurement | null {
  if (value === null || !Number.isFinite(value)) return null;
  const m: Measurement = { metric, value: round(value), unit };
  if (baseline !== undefined && baseline !== null && Number.isFinite(baseline)) m.baseline = round(baseline);
  return m;
}
export const compact = (items: Array<Measurement | null>): Measurement[] => items.filter((m): m is Measurement => m !== null);

/** Count matching canonical events and return a bounded, deterministic sample of their IDs for provenance. */
export async function countAndSample(db: Db, filter: Filter<Document>, limit: number): Promise<{ count: number; sample: SourceRef[] }> {
  const col = db.collection(COLLECTIONS.businessEvents);
  const [count, docs] = await Promise.all([
    col.countDocuments(filter),
    col.find(filter, { projection: { _id: 0, eventId: 1 } }).sort({ occurredAt: 1, eventId: 1 }).limit(Math.min(limit, MAX_SAMPLE)).toArray(),
  ]);
  return { count, sample: docs.map((d) => ({ collection: COLLECTIONS.businessEvents, recordId: d.eventId as string })) };
}

export const occurredIn = (w: WindowT) => ({ occurredAt: { $gte: w.startAt, $lt: w.endAt } });

/** Persisted hourly global snapshots inside a window (the detector's own canonical evidence base; every id resolves). */
export async function hourlySnapshots(ctx: ToolContext, w: WindowT): Promise<MetricSnapshotT[]> {
  const docs = await ctx.db.collection(COLLECTIONS.metricSnapshots).find({
    ...scopeOf(ctx), "window.startAt": { $gte: w.startAt, $lt: w.endAt }, dimension: {}, completeness: "complete",
  }, { projection: { _id: 0, simulationRunId: 0 } }).sort({ "window.startAt": 1 }).limit(MAX_BASELINE_SNAPSHOTS).toArray();
  return docs.filter((d) => hoursOfWindow(d.window as WindowT) === 1) as unknown as MetricSnapshotT[];
}
// Hourly rows for the longest baseline plus any multi-hour detector snapshots that share the global dimension.
const MAX_BASELINE_SNAPSHOTS = 2_000;
const hoursOfWindow = (w: WindowT) => (Date.parse(w.endAt) - Date.parse(w.startAt)) / 3_600_000;

export type CounterKey = keyof MetricSnapshotT["counters"];
export function sumCounters(snaps: MetricSnapshotT[]): Record<CounterKey, number> {
  const out = {} as Record<CounterKey, number>;
  for (const s of snaps) for (const [k, v] of Object.entries(s.counters)) out[k as CounterKey] = (out[k as CounterKey] ?? 0) + v;
  return out;
}
export const snapshotRefs = (snaps: MetricSnapshotT[]): SourceRef[] => snaps.map((s) => ({ collection: COLLECTIONS.metricSnapshots, recordId: s.snapshotId }));

/** Groups hourly snapshots into UTC days for compact time series. */
export function dailySeries(snaps: MetricSnapshotT[], pick: (c: MetricSnapshotT["counters"]) => number): Array<{ day: string; value: number; hours: number }> {
  const days = new Map<string, { value: number; hours: number }>();
  for (const s of snaps) {
    const day = s.window.startAt.slice(0, 10);
    const d = days.get(day) ?? { value: 0, hours: 0 };
    d.value += pick(s.counters); d.hours += 1; days.set(day, d);
  }
  return [...days.entries()].map(([day, d]) => ({ day, ...d }));
}

export function labelFor(ctx: ToolContext, productId: string): { name: string; category: string } {
  return ctx.catalogue.get(productId) ?? { name: productId, category: "unknown" };
}

/** Every sample list is capped so evidence stays bounded and serialisable. */
export const cap = <T,>(rows: T[], limit: number) => rows.slice(0, Math.min(limit, MAX_SAMPLE));
