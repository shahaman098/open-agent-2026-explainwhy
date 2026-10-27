import type { WindowMeasure } from "@/intelligence/baselines/engine";
import type { Field, SignalSeries } from "@/intelligence/signals/series";
import type { ImpactContext } from "@/intelligence/detection/signal";

export const count = (field: Field) => (s: SignalSeries, seg: string, k0: number, k1: number): WindowMeasure => ({ num: s.sum(seg, field, k0, k1), den: 1 });
export const ratio = (num: Field, den: Field | Field[]) => (s: SignalSeries, seg: string, k0: number, k1: number): WindowMeasure => ({
  num: s.sum(seg, num, k0, k1),
  den: (Array.isArray(den) ? den : [den]).reduce((a, f) => a + s.sum(seg, f, k0, k1), 0),
});
export const total = (field: Field) => (s: SignalSeries, seg: string, k0: number, k1: number): number => s.sum(seg, field, k0, k1);

/** Average daily value of a field over the 72h before `cutoffK` (or less history if that is all there is). */
export function dailyBefore(s: SignalSeries, seg: string, field: Field, cutoffK: number, hours = 72): number {
  const k0 = Math.max(0, cutoffK - hours);
  const span = cutoffK - k0;
  if (span <= 0) return 0;
  return (s.sum(seg, field, k0, cutoffK) / span) * 24;
}

/** Impact = |relative change| (capped at 100%) × the segment's baseline daily revenue × factor. */
export const relativeImpact = (factor = 1) => (c: ImpactContext): number =>
  Math.min(1, Math.abs(c.evaluation.changePercent ?? 0) / 100) * c.segmentDailyRevenue * factor;

/** Impact of a change in a per-window count, valued at baseline AOV and scaled to a day. */
export const countImpact = (factor = 1) => (c: ImpactContext): number =>
  Math.abs(c.evaluation.delta ?? 0) * c.aov * (24 / Math.max(1, c.windowHours)) * factor;

export const moneyImpact = (factor = 1) => (c: ImpactContext): number =>
  Math.abs(c.evaluation.delta ?? 0) * (24 / Math.max(1, c.windowHours)) * factor;

/** Impact of a rate change applied to the current window's denominator, valued at AOV, scaled to a day. */
export const rateImpact = (factor = 1) => (c: ImpactContext): number =>
  Math.abs(c.evaluation.delta ?? 0) * (c.evaluation.currentDenominator ?? 0) * c.aov * (24 / Math.max(1, c.windowHours)) * factor;
