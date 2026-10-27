/** Small, dependency-free robust statistics. All functions handle empty input explicitly. */

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Median absolute deviation (unscaled). */
export function mad(values: readonly number[]): number | null {
  const m = median(values);
  if (m === null) return null;
  return median(values.map((v) => Math.abs(v - m)));
}

/** MAD scaled to be a consistent estimator of the standard deviation for normal data. */
export function robustSd(values: readonly number[]): number | null {
  const d = mad(values);
  return d === null ? null : 1.4826 * d;
}

/**
 * Pooled proportion with a Jeffreys-style correction (+0.5 / +1) so a history with zero events yields a small
 * positive expectation rather than exactly zero. Returns null without any denominator.
 */
export function smoothedRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return (numerator + 0.5) / (denominator + 1);
}

/** Standard error of a proportion p observed over n trials (binomial). */
export function binomialSe(p: number, n: number): number {
  if (n <= 0) return Infinity;
  return Math.sqrt(Math.max(p * (1 - p), 0) / n);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5; const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function logGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9).
  const g = 7;
  const coef = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = coef[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += coef[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Exact Poisson tail: P(X ≥ k) when upper, else P(X ≤ k). */
export function poissonTail(k: number, lambda: number, upper: boolean): number {
  if (lambda <= 0) return upper ? (k <= 0 ? 1 : 0) : 1;
  const kk = Math.floor(k);
  const pmf = (i: number) => Math.exp(i * Math.log(lambda) - lambda - logGamma(i + 1));
  let s = 0;
  if (upper) {
    if (kk <= 0) return 1;
    for (let i = 0; i < kk; i++) s += pmf(i);
    return clamp(1 - s, 0, 1);
  }
  for (let i = 0; i <= kk; i++) s += pmf(i);
  return clamp(s, 0, 1);
}

/** Exact binomial tail: P(X ≥ k) when upper, else P(X ≤ k). */
export function binomialTail(k: number, n: number, p: number, upper: boolean): number {
  if (n <= 0) return 1;
  if (p <= 0) return upper ? (k <= 0 ? 1 : 0) : 1;
  if (p >= 1) return upper ? 1 : (k >= n ? 1 : 0);
  const kk = Math.round(k);
  const lc = (i: number) => logGamma(n + 1) - logGamma(i + 1) - logGamma(n - i + 1);
  const pmf = (i: number) => Math.exp(lc(i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  let s = 0;
  if (upper) { for (let i = Math.max(0, kk); i <= n; i++) s += pmf(i); }
  else { for (let i = 0; i <= Math.min(n, kk); i++) s += pmf(i); }
  return clamp(s, 0, 1);
}

/** z-equivalent of a one-sided tail probability (0 when p ≥ 0.5), capped at 10. */
export function zFromTail(p: number): number {
  if (p >= 0.5) return 0;
  return Math.min(10, normalQuantile(1 - Math.max(p, 1e-300)));
}

/**
 * Fisher's exact (hypergeometric) one-sided tail for comparing a current proportion x1/n1 with a baseline x0/n0.
 * Accounts for the sampling uncertainty of BOTH periods. Upper: P(X ≥ x1); lower: P(X ≤ x1).
 */
export function fisherTail(x1: number, n1: number, x0: number, n0: number, upper: boolean): number {
  const N = n1 + n0; const K = x1 + x0;
  if (n1 <= 0 || N <= 0) return 1;
  const lo = Math.max(0, n1 - (N - K)); const hi = Math.min(n1, K);
  const lc = (n: number, k: number) => logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
  const denom = lc(N, n1);
  let s = 0;
  if (upper) { for (let x = Math.max(lo, Math.ceil(x1)); x <= hi; x++) s += Math.exp(lc(K, x) + lc(N - K, n1 - x) - denom); }
  else { for (let x = lo; x <= Math.min(hi, Math.floor(x1)); x++) s += Math.exp(lc(K, x) + lc(N - K, n1 - x) - denom); }
  return clamp(s, 0, 1);
}

/**
 * Conditional test for a current count x against baseline counts summing to `baselineSum` over `windows` windows of
 * equal exposure: under "no change", x ~ Binomial(x + baselineSum, 1/(1+windows)). Accounts for baseline uncertainty.
 */
export function conditionalCountTail(x: number, baselineSum: number, windows: number, upper: boolean): number {
  const total = Math.round(x + baselineSum);
  if (total <= 0 || windows <= 0) return 1;
  return binomialTail(Math.round(x), total, 1 / (1 + windows), upper);
}
