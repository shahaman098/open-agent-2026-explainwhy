import { DEFAULT_CONFIG, type DetectionConfig } from "@/intelligence/config";
import { computeBaseline, defaultMethod, type BaselineMethod, type BaselineResult, type MeasureKind, type WindowMeasure } from "@/intelligence/baselines/engine";
import { conditionalCountTail, fisherTail, normalCdf, normalQuantile, round, zFromTail } from "@/intelligence/baselines/statistics";
import { parseSegmentKey } from "@/intelligence/types";
import type { SignalSeries } from "@/intelligence/signals/series";
import type { CanonicalMetric, Direction, Polarity, RuleFamily, SegmentKind, Theme } from "@/intelligence/types";

export interface Trigger {
  direction: Direction;
  polarity: Polarity;
  /** Minimum |change| relative to expected (0.25 = 25%). */
  minRelChange: number;
  /** Minimum |z| against the robust spread. */
  minZ: number;
  /** Minimum absolute change in the signal's own unit (money in minor units, rates as fractions). */
  minAbsChange: number | Partial<Record<number, number>>;
}

export interface ImpactContext {
  series: SignalSeries;
  segment: string;
  windowHours: number;
  cutoffK: number;
  evaluation: Evaluation;
  /** Baseline daily net revenue of the whole business (minor units), measured before the cutoff. */
  dailyRevenue: number;
  /** Baseline average order value (minor units). */
  aov: number;
  /** Baseline daily revenue attributable to this segment (minor units). */
  segmentDailyRevenue: number;
}

export interface SignalDef {
  id: string;
  label: string;
  family: RuleFamily;
  theme: Theme;
  kind: MeasureKind | "custom";
  unit: "minor" | "count" | "rate" | "ratio" | "units" | "hours" | "stars" | "frequency";
  /** Canonical `Anomaly.metric` this signal can be reported as, if any. */
  canonicalMetric?: CanonicalMetric;
  segmentKinds: SegmentKind[];
  windows: number[];
  baseline?: BaselineMethod;
  measure: (s: SignalSeries, seg: string, k0: number, k1: number) => WindowMeasure;
  gauge?: (s: SignalSeries, seg: string, k: number) => number;
  noiseCount?: (s: SignalSeries, seg: string, k0: number, k1: number) => number;
  support?: (s: SignalSeries, seg: string, k0: number, k1: number) => number;
  /** Minimum denominator (rate/ratio) or count (count signals) in the current window, by window hours. */
  minCurrent?: number | Partial<Record<number, number>>;
  minSupport?: number;
  minBaselineDenominator?: number | Partial<Record<number, number>>;
  minExpected?: number | Partial<Record<number, number>>;
  /** Money signals: minimum expected underlying count (same rule as the matching count signal). */
  minExpectedNoiseCount?: number | Partial<Record<number, number>>;
  relativeSpreadFloor?: number;
  /** Measure baselines on another segment (e.g. a product compared with the whole catalogue's history). */
  baselineSegment?: (segment: string) => string;
  /** Minimum numerator in the current window before an increase can trigger (e.g. ≥3 low ratings). */
  minNumerator?: number;
  /** Expected value used when every comparable window was zero (gauges/counts that are normally near zero). */
  zeroBaselineFloor?: number;
  /**
   * "flow": business-wide flows (orders, revenue, sessions, conversions) whose day-to-day variation exceeds Poisson
   * noise; inflated by config.countDispersion. "independent": per-segment counts and per-item outcomes (reviews,
   * failures, shipments). Defaults: global count/money/ratio signals are flows, everything else independent.
   */
  dispersion?: "flow" | "independent";
  /** First boundary from which this signal is observable (e.g. once delivery promises start falling due). */
  observableFrom?: (s: SignalSeries) => number;
  /** Values that the canonical metric snapshot reports rounded (e.g. CPA in whole minor units). */
  roundActual?: (v: number) => number;
  triggers: Trigger[];
  persistenceHours?: number | Partial<Record<number, number>>;
  impactPerDay: (ctx: ImpactContext) => number;
  /** Fully custom evaluation (inventory rules). */
  custom?: (args: CustomArgs) => Omit<Evaluation, "triggered" | "cleared" | "strength" | "checks"> & { triggered: boolean; strength: number };
}

export interface CustomArgs {
  series: SignalSeries;
  segment: string;
  kEval: number;
  cutoffK: number;
  windowHours: number;
  trigger: Trigger;
  config: DetectionConfig;
}

export interface Evaluation {
  ok: boolean;
  skipReason?: string;
  at: string;
  window: { startAt: string; endAt: string };
  actual: number | null;
  expected: number | null;
  delta: number | null;
  changePercent: number | null;
  z: number | null;
  currentNumerator: number | null;
  currentDenominator: number | null;
  baseline: BaselineResult | null;
  checks: { direction: boolean; relative: boolean; absolute: boolean; significance: boolean; sample: boolean };
  triggered: boolean;
  /** min(relative/threshold, z/threshold) in the trigger direction; ≥1 means both thresholds are met. */
  strength: number;
  cleared: boolean;
  details?: Record<string, unknown>;
}

export const pick = (v: number | Partial<Record<number, number>> | undefined, W: number, fallback: number): number => {
  if (v === undefined) return fallback;
  if (typeof v === "number") return v;
  return v[W] ?? fallback;
};

export function persistenceFor(def: SignalDef, W: number): number {
  const fallback = def.kind === "gauge" ? 3 : def.kind === "custom" ? 2 : W >= 72 ? 6 : W >= 24 ? 2 : 3;
  return pick(def.persistenceHours, W, fallback);
}

export function methodFor(def: SignalDef, W: number): BaselineMethod {
  if (def.baseline) return def.baseline;
  return defaultMethod(def.kind === "custom" ? "count" : def.kind, W);
}

/**
 * Bonferroni adjustment across the segments a signal is tested on: the one-sided tail of `minZ` is shared by `segments`
 * simultaneous tests (e.g. 17 products), so each needs a stricter z.
 */
export function requiredZ(minZ: number, segments: number): number {
  if (segments <= 1) return minZ;
  return normalQuantile(1 - (1 - normalCdf(minZ)) / segments);
}

const EMPTY_CHECKS = { direction: false, relative: false, absolute: false, significance: false, sample: false };

/** Evaluates one signal/segment/window/trigger at boundary kEval with baselines ending at or before cutoffK. */
export function evaluatePoint(def: SignalDef, trigger: Trigger, series: SignalSeries, segment: string, W: number, kEval: number, cutoffK: number, config: DetectionConfig = DEFAULT_CONFIG): Evaluation {
  const at = series.time(kEval);
  const window = { startAt: series.time(def.kind === "gauge" ? kEval : kEval - W), endAt: at };
  const blank = (skipReason: string, extra: Partial<Evaluation> = {}): Evaluation => ({
    ok: false, skipReason, at, window, actual: null, expected: null, delta: null, changePercent: null, z: null,
    currentNumerator: null, currentDenominator: null, baseline: null, checks: EMPTY_CHECKS, triggered: false, strength: 0, cleared: true, ...extra,
  });
  if (def.kind !== "gauge" && kEval - W < 0) return blank("current window starts before observable history");
  const minK = def.observableFrom ? def.observableFrom(series) : 0;
  if (minK < 0 || (def.kind === "gauge" ? kEval : kEval - W) < minK) return blank("signal not yet observable in this run");

  if (def.custom) {
    const r = def.custom({ series, segment, kEval, cutoffK, windowHours: W, trigger, config });
    return { ...r, checks: { direction: r.triggered, relative: r.triggered, absolute: r.triggered, significance: r.triggered, sample: r.ok },
      cleared: !r.ok ? false : r.strength < config.clearRatio };
  }

  let actual: number; let num: number; let den: number;
  if (def.kind === "gauge") {
    actual = def.gauge ? def.gauge(series, segment, kEval) : NaN;
    if (Number.isNaN(actual)) return blank("no observation at evaluation time");
    num = actual; den = 1;
  } else {
    const m = def.measure(series, segment, kEval - W, kEval);
    num = m.num; den = m.den;
    if (def.kind === "rate" || def.kind === "ratio") {
      const minDen = pick(def.minCurrent, W, 1);
      if (den < Math.max(1, minDen)) return blank(`current denominator ${den} below minimum ${minDen}`, { currentNumerator: num, currentDenominator: den, checks: EMPTY_CHECKS });
      actual = num / den;
    } else {
      actual = num;
    }
  }
  if (def.roundActual) actual = def.roundActual(actual);
  const support = def.support ? def.support(series, segment, kEval - W, kEval) : undefined;
  if (def.minSupport !== undefined && (support ?? 0) < def.minSupport) {
    return blank(`current support ${support ?? 0} below minimum ${def.minSupport}`, { actual, currentNumerator: num, currentDenominator: den });
  }

  const baseSeg = def.baselineSegment ? def.baselineSegment(segment) : segment;
  const segKind = parseSegmentKey(segment).kind;
  const dispersionClass = def.dispersion ?? (segKind === "global" && (def.kind === "count" || def.kind === "money" || def.kind === "ratio") ? "flow" : "independent");
  const phi = dispersionClass === "flow" ? config.countDispersion : 1;
  const baseline = computeBaseline({
    kind: def.kind as MeasureKind, windowHours: W, kEval, cutoffK, method: methodFor(def, W), time: (k) => series.time(k),
    measure: (k0, k1) => def.measure(series, baseSeg, k0, k1),
    gauge: def.gauge ? (k) => def.gauge!(series, baseSeg, k) : undefined,
    noiseCount: def.noiseCount ? (k0, k1) => def.noiseCount!(series, baseSeg, k0, k1) : undefined,
    zeroBaselineFloor: def.zeroBaselineFloor,
    dispersion: phi,
    minExpectedNoiseCount: def.minExpectedNoiseCount === undefined ? undefined : pick(def.minExpectedNoiseCount, W, 0),
    supportOf: def.support ? (k0, k1) => def.support!(series, baseSeg, k0, k1) : undefined,
    currentSupport: support, currentDenominator: den,
    minBaselineDenominator: def.minBaselineDenominator === undefined ? undefined : pick(def.minBaselineDenominator, W, 0),
    minExpected: def.minExpected === undefined ? undefined : pick(def.minExpected, W, 0),
    relativeSpreadFloor: def.relativeSpreadFloor,
    minK,
  }, config);
  if (baseline.status !== "ok" || baseline.expected === null || baseline.spread === null) {
    return blank(`baseline ${baseline.status}: ${baseline.reason ?? ""}`.trim(), { actual, currentNumerator: num, currentDenominator: den, baseline });
  }

  const expected = baseline.expected;
  const delta = actual - expected;
  const changePercent = expected !== 0 ? (delta / expected) * 100 : null;
  // Robust z against the spread, and for small expected counts an exact binomial/Poisson tail converted to a
  // z-equivalent. The more conservative of the two is used: small samples never look more significant than they are.
  let zRobust = baseline.spread > 0 ? delta / baseline.spread : null;
  let residualMethod = "linear robust residual";
  // Counts and proportions are asymmetric near zero. A symmetric normal residual
  // understates sustained declines (and can make a near-total loss undetectable).
  // Use signed root deviance for business flows, retaining the robust spread,
  // dispersion and baseline-estimation uncertainty as variance inflation.
  if (dispersionClass === "flow" && delta < 0 && expected > 0 && zRobust !== null) {
    if (def.kind === "count" || def.kind === "money") {
      const ratio = Math.max(0, actual / expected);
      const deviance = 2 * (ratio === 0 ? 1 : ratio * Math.log(ratio) - ratio + 1);
      zRobust *= Math.sqrt(deviance) / Math.abs(ratio - 1);
      residualMethod = "signed Poisson deviance with robust variance inflation";
    } else if (def.kind === "rate" && expected < 1 && actual >= 0 && actual < 1) {
      const kl = (actual === 0 ? 0 : actual * Math.log(actual / expected))
        + (1 - actual) * Math.log((1 - actual) / (1 - expected));
      zRobust *= Math.sqrt(2 * kl * expected * (1 - expected)) / Math.abs(delta);
      residualMethod = "signed binomial deviance with robust variance inflation";
    }
  }
  let zExact: number | null = null;
  let test = "robust z";
  const informative = baseline.samples.filter((x) => def.kind !== "rate" || x.denominator > 0);
  if (def.kind === "rate" && den > 0) {
    const e = expected * den;
    if (e < 30 || den * (1 - expected) < 30) {
      const x0 = informative.reduce((a, x) => a + x.numerator, 0); const n0 = informative.reduce((a, x) => a + x.denominator, 0);
      zExact = (Math.sign(delta) * zFromTail(fisherTail(num, den, x0, n0, delta > 0))) / Math.sqrt(phi); test = "Fisher exact test vs pooled baseline";
    }
  } else if ((def.kind === "count" || def.kind === "gauge") && expected < 30) {
    const sum = informative.reduce((a, x) => a + (x.value ?? 0), 0);
    zExact = (Math.sign(delta) * zFromTail(conditionalCountTail(actual, sum, informative.length, delta > 0))) / Math.sqrt(phi); test = "conditional binomial test vs baseline windows";
  }
  const z = zRobust === null ? zExact : zExact === null ? zRobust : Math.sign(zRobust) * Math.min(Math.abs(zRobust), Math.abs(zExact));
  const minCount = def.kind === "count" ? pick(def.minCurrent, W, 0) : 0;
  const zRequired = requiredZ(trigger.minZ, segKind === "global" ? 1 : series.segments(segKind as "campaign" | "product" | "channel" | "category").length);
  const checks = {
    direction: trigger.direction === "increase" ? delta > 0 : delta < 0,
    relative: changePercent !== null && Math.abs(changePercent) >= trigger.minRelChange * 100,
    absolute: Math.abs(delta) >= pick(trigger.minAbsChange, W, 0),
    significance: z !== null && Math.abs(z) >= zRequired,
    sample: (def.kind !== "count" || Math.max(actual, expected) >= minCount)
      && (def.minNumerator === undefined || trigger.direction !== "increase" || num >= def.minNumerator),
  };
  const strength = checks.direction && changePercent !== null && z !== null
    ? Math.min(Math.abs(changePercent) / (trigger.minRelChange * 100), Math.abs(z) / zRequired)
    : 0;
  const triggered = checks.direction && checks.relative && checks.absolute && checks.significance && checks.sample;
  return {
    ok: true, at, window, actual, expected, delta, changePercent: changePercent === null ? null : round(changePercent, 2), z: z === null ? null : round(z, 3),
    currentNumerator: num, currentDenominator: den, baseline, checks, triggered, strength: round(strength, 4),
    cleared: !checks.direction || strength < config.clearRatio,
    details: { zRobust: zRobust === null ? null : round(zRobust, 3), zExact: zExact === null ? null : round(zExact, 3), significanceTest: test, residualMethod,
      zRequired: round(zRequired, 3), dispersion: phi, segmentsTested: segKind === "global" ? 1 : series.segments(segKind as "campaign" | "product" | "channel" | "category").length },
  };
}
