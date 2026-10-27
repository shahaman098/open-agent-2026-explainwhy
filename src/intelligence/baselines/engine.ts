import { DEFAULT_CONFIG, type DetectionConfig } from "@/intelligence/config";
import { binomialSe, mean, median, robustSd, smoothedRate } from "@/intelligence/baselines/statistics";

export type MeasureKind = "count" | "money" | "rate" | "ratio" | "gauge";
export type BaselineMethod = "same_hour" | "trailing_windows" | "pooled_history" | "same_hour_point";

export interface WindowMeasure {
  num: number;
  den: number;
}

export interface BaselineSample {
  startAt: string;
  endAt: string;
  numerator: number;
  denominator: number;
  value: number | null;
}

export interface BaselineResult {
  status: "ok" | "insufficient_history" | "insufficient_sample" | "zero_baseline";
  method: BaselineMethod;
  /** Baseline windows end at or before this instant (contamination guard). */
  cutoff: string;
  samples: BaselineSample[];
  n: number;
  expected: number | null;
  spread: number | null;
  /** How the expected value was formed, for audit. */
  estimator: string;
  reason?: string;
}

export interface BaselineInput {
  kind: MeasureKind;
  /** Window length in hours (0 for point-in-time gauges). */
  windowHours: number;
  /** Evaluation boundary index and the latest boundary baseline windows may end at. */
  kEval: number;
  cutoffK: number;
  method: BaselineMethod;
  /** Converts a boundary index into an ISO instant. */
  time: (k: number) => string;
  measure: (k0: number, k1: number) => WindowMeasure;
  gauge?: (k: number) => number;
  /** Count driving Poisson noise for money metrics (e.g. orders behind revenue). */
  noiseCount?: (k0: number, k1: number) => number;
  /** Support count of the current window for ratio metrics (e.g. attributed orders behind CPA). */
  currentSupport?: number;
  currentDenominator?: number;
  minBaselineDenominator?: number;
  minExpected?: number;
  relativeSpreadFloor?: number;
  /** When every comparable window is zero, use this floor as the expected value instead of reporting zero_baseline. */
  zeroBaselineFloor?: number;
  /** Earliest boundary a baseline window may start at (signal not observable before it). */
  minK?: number;
  /** Variance inflation for this signal (quasi-likelihood dispersion); 1 = Poisson/binomial. */
  dispersion?: number;
  /** Support count for a baseline window (ratio metrics), so the baseline's own sampling error is included. */
  supportOf?: (k0: number, k1: number) => number;
  /** Money metrics: minimum expected underlying count (e.g. orders behind revenue) for the comparison to be meaningful. */
  minExpectedNoiseCount?: number;
}

/** Picks the comparable historical windows (most recent first). Never overlaps the current window or the cutoff. */
export function selectWindows(method: BaselineMethod, kEval: number, W: number, cutoffK: number, config: DetectionConfig = DEFAULT_CONFIG, minK = 0): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (method === "same_hour") {
    for (let d = 1; out.length < config.maxBaselineSamples; d++) {
      const k1 = kEval - 24 * d; const k0 = k1 - W;
      if (k0 < minK) break;
      if (k1 <= cutoffK) out.push([k0, k1]);
    }
  } else if (method === "trailing_windows") {
    for (let j = 0; out.length < config.maxBaselineSamples; j++) {
      const k1 = cutoffK - W * j; const k0 = k1 - W;
      if (k0 < minK) break;
      out.push([k0, k1]);
    }
  } else if (method === "pooled_history") {
    const k1 = cutoffK; const k0 = Math.max(minK, cutoffK - config.pooledHistoryMaxHours);
    if (k1 - k0 >= config.pooledHistoryMinHours) out.push([k0, k1]);
  } else {
    for (let d = 1; out.length < config.maxBaselineSamples; d++) {
      const k = kEval - 24 * d;
      if (k < minK) break;
      if (k <= cutoffK) out.push([k, k]);
    }
  }
  return out;
}

/** Default method for a window length: same hour-of-day below a day, contiguous trailing windows for whole days. */
export function defaultMethod(kind: MeasureKind, windowHours: number): BaselineMethod {
  if (kind === "gauge") return "same_hour_point";
  return windowHours % 24 === 0 ? "trailing_windows" : "same_hour";
}

/**
 * Computes the expected value and a robust spread for the current window.
 *
 * - count / money / gauge: median of comparable windows (mean if the median is 0 but some history exists);
 *   spread = max(1.4826·MAD, Poisson noise floor, relative floor).
 * - rate: pooled proportion Σnum/Σden with Jeffreys smoothing; spread = max(1.4826·MAD of window rates, binomial SE
 *   of the current denominator).
 * - ratio: pooled Σnum/Σden; spread = max(1.4826·MAD, expected/√support, relative floor).
 */
export function computeBaseline(input: BaselineInput, config: DetectionConfig = DEFAULT_CONFIG): BaselineResult {
  const windows = selectWindows(input.method, input.kEval, input.windowHours, input.cutoffK, config, input.minK ?? 0);
  const cutoff = input.time(input.cutoffK);
  const samples: BaselineSample[] = windows.map(([k0, k1]) => {
    if (input.kind === "gauge") {
      const v = input.gauge ? input.gauge(k0) : NaN;
      return { startAt: input.time(k0), endAt: input.time(k1), numerator: v, denominator: 1, value: Number.isNaN(v) ? null : v };
    }
    const m = input.measure(k0, k1);
    const value = input.kind === "rate" || input.kind === "ratio" ? (m.den > 0 ? m.num / m.den : null) : m.num;
    return { startAt: input.time(k0), endAt: input.time(k1), numerator: m.num, denominator: m.den, value };
  });
  // Rate/ratio windows with no denominator carry no information and are not counted as samples.
  const informative = input.kind === "rate" || input.kind === "ratio" ? samples.filter((s) => s.denominator > 0) : samples;
  const base = { method: input.method, cutoff, samples, n: informative.length };
  const minSamples = input.method === "pooled_history" ? 1 : config.minBaselineSamples;
  if (informative.length < minSamples) {
    return { ...base, status: "insufficient_history", expected: null, spread: null, estimator: "none",
      reason: input.method === "pooled_history"
        ? `needs ≥${config.pooledHistoryMinHours}h of history before ${cutoff}`
        : `needs ≥${minSamples} comparable windows before ${cutoff}, found ${samples.length}` };
  }
  const relFloor = input.relativeSpreadFloor ?? 0.05;

  const phi = input.dispersion ?? 1;
  if (input.kind === "rate" || input.kind === "ratio") {
    const sumNum = samples.reduce((a, s) => a + s.numerator, 0);
    const sumDen = samples.reduce((a, s) => a + s.denominator, 0);
    if (sumDen <= 0 || (input.minBaselineDenominator !== undefined && sumDen < input.minBaselineDenominator)) {
      return { ...base, status: "insufficient_sample", expected: null, spread: null, estimator: "none",
        reason: `baseline denominator ${sumDen} below minimum ${input.minBaselineDenominator ?? 1}` };
    }
    const windowValues = samples.filter((s) => s.denominator > 0 && s.value !== null).map((s) => s.value as number);
    const mad = windowValues.length >= 3 ? robustSd(windowValues) ?? 0 : 0;
    if (input.kind === "rate") {
      const expected = smoothedRate(sumNum, sumDen) as number;
      // Two-sample standard error (the baseline proportion is itself estimated from Σden trials), inflated by the
      // signal's dispersion for business flows whose day-to-day variation exceeds binomial noise.
      const n1 = input.currentDenominator ?? 0;
      const se = n1 > 0 ? Math.sqrt(phi * expected * (1 - expected) * (1 / n1 + 1 / sumDen)) : binomialSe(expected, 0);
      const spread = Math.max(mad, se);
      return { ...base, status: "ok", expected, spread, estimator: `pooled rate (Σnum+0.5)/(Σden+1) = (${sumNum}+0.5)/(${sumDen}+1)` };
    }
    const expected = sumNum / sumDen;
    if (expected === 0) return { ...base, status: "zero_baseline", expected: 0, spread: null, estimator: "pooled ratio", reason: "baseline ratio is zero" };
    // Relative SE of a ratio driven by (possibly overdispersed) support events, e.g. attributed orders behind CPA,
    // counting the sampling error of BOTH the current window and the pooled baseline.
    const baseSupport = input.supportOf ? windows.reduce((a, [k0, k1]) => a + input.supportOf!(k0, k1), 0) : Infinity;
    const supportFloor = expected * Math.sqrt(phi * (1 / Math.max(1, input.currentSupport ?? 1) + 1 / Math.max(1, baseSupport)));
    const spread = Math.max(mad, supportFloor, relFloor * Math.abs(expected));
    return { ...base, status: "ok", expected, spread, estimator: `pooled ratio Σnum/Σden = ${sumNum}/${sumDen}` };
  }

  const values = samples.map((s) => s.value).filter((v): v is number => v !== null);
  if (values.length < minSamples) {
    return { ...base, status: "insufficient_history", expected: null, spread: null, estimator: "none", reason: "comparable windows have no observations" };
  }
  const med = median(values) as number;
  const avg = mean(values) as number;
  let expected = med > 0 ? med : avg;
  let estimator = med > 0 ? `median of ${values.length} windows` : `mean of ${values.length} windows (median was 0)`;
  if (expected <= 0 && input.zeroBaselineFloor !== undefined) {
    expected = input.zeroBaselineFloor;
    estimator = `zero-history floor ${input.zeroBaselineFloor} (all ${values.length} windows were 0)`;
  }
  if (expected <= 0) return { ...base, status: "zero_baseline", expected: 0, spread: null, estimator, reason: "every comparable window was zero" };
  if (input.minExpected !== undefined && expected < input.minExpected) {
    return { ...base, status: "insufficient_sample", expected, spread: null, estimator, reason: `expected ${expected.toFixed(1)} below minimum volume ${input.minExpected}` };
  }
  const mad = robustSd(values) ?? 0;
  let noise = Math.sqrt(expected * phi);
  if (input.kind === "money") {
    const counts = windows.map(([k0, k1]) => (input.noiseCount ? input.noiseCount(k0, k1) : 1));
    const rawCount = median(counts) ?? 0;
    // Same sample-size rule as the underlying count signal: a revenue total built from one or two orders is not judged.
    if (input.minExpectedNoiseCount !== undefined && rawCount < input.minExpectedNoiseCount) {
      return { ...base, status: "insufficient_sample", expected, spread: null, estimator, reason: `expected ${rawCount} underlying orders below minimum volume ${input.minExpectedNoiseCount}` };
    }
    const expCount = Math.max(1, rawCount);
    noise = Math.sqrt(expCount * phi) * (expected / expCount);
  }
  // The expected value is itself estimated from n windows: inflate by √(1 + c/n), c = π/2 for a median, 1 for a mean.
  const c = med > 0 ? Math.PI / 2 : 1;
  const spread = Math.max(mad, noise, relFloor * expected) * Math.sqrt(1 + c / values.length);
  return { ...base, status: "ok", expected, spread, estimator };
}
