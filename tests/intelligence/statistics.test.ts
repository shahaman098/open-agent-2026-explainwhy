import { describe, expect, it } from "vitest";
import {
  binomialTail, conditionalCountTail, fisherTail, mad, mean, median, normalCdf, normalQuantile, poissonTail, robustSd, smoothedRate, zFromTail,
} from "@/intelligence/baselines/statistics";

describe("robust statistics", () => {
  it("median, mean, MAD handle odd/even/empty input", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(mean([])).toBeNull();
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
    expect(robustSd([5, 5, 5])).toBe(0);
  });

  it("smoothed rate never returns 0 for a zero-event history and is null without a denominator", () => {
    expect(smoothedRate(0, 99)).toBeCloseTo(0.005, 10);
    expect(smoothedRate(10, 0)).toBeNull();
  });

  it("normal CDF/quantile agree with reference values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.99865)).toBeCloseTo(3.0, 3);
    expect(zFromTail(0.6)).toBe(0);
    expect(zFromTail(0)).toBe(10);
  });

  it("exact tails match hand-computed probabilities", () => {
    // P(X ≥ 3 | Poisson(1)) = 1 - e^-1 (1 + 1 + 1/2)
    expect(poissonTail(3, 1, true)).toBeCloseTo(1 - Math.exp(-1) * 2.5, 10);
    expect(poissonTail(0, 1, false)).toBeCloseTo(Math.exp(-1), 10);
    // P(X ≥ 2 | Bin(3, 0.5)) = 4/8
    expect(binomialTail(2, 3, 0.5, true)).toBeCloseTo(0.5, 10);
    expect(binomialTail(0, 3, 0.5, false)).toBeCloseTo(0.125, 10);
  });

  it("Fisher's test accounts for baseline uncertainty (a small baseline weakens significance)", () => {
    // 4/4 vs 1/11: hypergeometric P = C(5,4) C(10,0) / C(15,4) = 5/1365
    expect(fisherTail(4, 4, 1, 11, true)).toBeCloseTo(5 / 1365, 10);
    const smallBaseline = zFromTail(fisherTail(7, 31, 4, 128, true));
    const knownRate = zFromTail(binomialTail(7, 31, 4 / 128, true));
    expect(smallBaseline).toBeLessThan(knownRate);
  });

  it("conditional count test equals a binomial with exposure share 1/(1+windows)", () => {
    expect(conditionalCountTail(8, 6, 3, true)).toBeCloseTo(binomialTail(8, 14, 0.25, true), 12);
    expect(conditionalCountTail(0, 0, 3, true)).toBe(1);
  });
});
