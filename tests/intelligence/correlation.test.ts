import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/intelligence/config";
import { correlate } from "@/intelligence/detection/correlation";
import type { FindingDraft } from "@/intelligence/detection/engine";
import type { Theme } from "@/intelligence/types";
import { CATALOGUE, at } from "./synth";

/** Minimal finding draft for correlation tests (severity components drive incident scoring). */
function f(signalId: string, theme: Theme, segment: string, polarity: "negative" | "positive", onsetH: number, opts: { endH?: number; score?: number; reliability?: number; magnitude?: number; canonical?: boolean } = {}): FindingDraft {
  const ev = { ok: true, at: at(onsetH), window: { startAt: at(onsetH - 6), endAt: at(onsetH) }, actual: 1, expected: 2, delta: -1, changePercent: -50, z: -5,
    currentNumerator: 1, currentDenominator: 1, baseline: null, checks: { direction: true, relative: true, absolute: true, significance: true, sample: true }, triggered: true, strength: 2, cleared: false };
  const severity = { score: opts.score ?? 50, level: "medium" as const, components: { magnitude: opts.magnitude ?? 0.5, reliability: opts.reliability ?? 0.8, impact: 0.5, persistence: 0.5 }, impactPerDayMinor: 0, dailyRevenueMinor: 0, explanation: "" };
  const episode = { key: `${signalId}|${segment}|w6|x`, signalId, segment, windowHours: 6, triggerIndex: 0, direction: "decrease" as const, polarity, onsetAt: at(onsetH), confirmedAt: at(onsetH + 2),
    lastTriggeredAt: at(opts.endH ?? 200), resolvedAt: opts.endH ? at(opts.endH) : null, baselineCutoff: at(onsetH - 6), latest: ev, peak: ev, severity };
  return { key: `${signalId}|${segment}|decrease|${at(onsetH)}`, signalId, label: signalId, family: "advertising", theme, canonicalMetric: opts.canonical === false ? null : "ctr", segment,
    direction: "decrease", polarity, onsetAt: at(onsetH), confirmedAt: at(onsetH + 2), lastTriggeredAt: at(opts.endH ?? 200), resolvedAt: opts.endH ? at(opts.endH) : null,
    active: !opts.endH, episodes: [episode], primary: episode, severity };
}
const ASOF = at(200);

describe("multi-signal correlation (Milestone 3)", () => {
  it("links related advertising signals and attaches the revenue decline to the same incident", () => {
    const incidents = correlate([
      f("ctr", "advertising", "global", "negative", 80), f("frequency", "advertising", "global", "negative", 79),
      f("ctr", "advertising", "campaign:cmp_a", "negative", 81), f("paid_sessions", "advertising", "global", "negative", 80),
      f("revenue", "sales", "global", "negative", 96),
    ], ASOF, CATALOGUE);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].primaryTheme).toBe("advertising");
    expect(incidents[0].findingKeys).toHaveLength(5);
    expect(incidents[0].title).toMatch(/Advertising performance deterioration.*with revenue decline/);
    expect(incidents[0].links.length).toBeGreaterThan(0);
  });

  it("does not merge unrelated campaigns without a business-wide signal", () => {
    const incidents = correlate([f("ctr", "advertising", "campaign:cmp_a", "negative", 80), f("ctr", "advertising", "campaign:cmp_b", "negative", 140)], ASOF, CATALOGUE);
    expect(incidents).toHaveLength(2);
    expect(incidents.map((i) => i.scope.ids[0]).sort()).toEqual(["cmp_a", "cmp_b"]);
  });

  it("does not merge across unrelated themes or opposite polarities", () => {
    const incidents = correlate([
      f("ctr", "advertising", "global", "negative", 80), f("late_delivery_rate", "fulfilment", "global", "negative", 82),
      f("product_orders", "demand", "product:p_a", "positive", 85),
    ], ASOF, CATALOGUE);
    expect(incidents).toHaveLength(3);
  });

  it("links delivery and rating deterioration even when reviews lag by days (overlap, not onset)", () => {
    const incidents = correlate([f("late_delivery_rate", "fulfilment", "global", "negative", 100), f("product_low_rating_rate", "reputation", "product:p_a", "negative", 170)], ASOF, CATALOGUE);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].links.some((l) => /delivery performance and customer ratings/.test(l.reason))).toBe(true);
  });

  it("links demand growth with stock risk for the same product only, yielding a mixed-polarity incident", () => {
    const incidents = correlate([
      f("product_orders", "demand", "product:p_a", "positive", 90), f("projected_stockout", "inventory", "product:p_a", "negative", 120),
      f("projected_stockout", "inventory", "product:p_b", "negative", 121),
    ], ASOF, CATALOGUE);
    const a = incidents.find((i) => i.affected.products.includes("p_a"))!;
    expect(a.polarity).toBe("mixed");
    expect(a.affected.products).toEqual(["p_a"]);
    expect(incidents).toHaveLength(2);
  });

  it("a business-wide impact signal joins one incident only, never bridging two", () => {
    const incidents = correlate([
      f("ctr", "advertising", "global", "negative", 80, { score: 70 }), f("late_delivery_rate", "fulfilment", "global", "negative", 80, { score: 50 }),
      f("revenue", "sales", "global", "negative", 90),
    ], ASOF, CATALOGUE);
    expect(incidents).toHaveLength(2);
    expect(incidents.filter((i) => i.findingKeys.some((k) => k.startsWith("revenue|")))).toHaveLength(1);
    expect(incidents.find((i) => i.findingKeys.some((k) => k.startsWith("revenue|")))!.primaryTheme).toBe("advertising");
  });

  it("does not link findings that never overlapped in time", () => {
    const incidents = correlate([f("ctr", "advertising", "global", "negative", 20, { endH: 40 }), f("ctr", "advertising", "campaign:cmp_a", "negative", 100)], ASOF, CATALOGUE);
    expect(incidents).toHaveLength(2);
  });
});

describe("incident severity", () => {
  it("increases with the number of independent supporting signals", () => {
    const one = correlate([f("ctr", "advertising", "global", "negative", 80, { score: 50 })], ASOF, CATALOGUE)[0];
    const four = correlate([
      f("ctr", "advertising", "global", "negative", 80, { score: 50 }), f("frequency", "advertising", "global", "negative", 80, { score: 45 }),
      f("cpa", "advertising", "global", "negative", 80, { score: 45 }), f("paid_sessions", "advertising", "global", "negative", 80, { score: 45 }),
    ], ASOF, CATALOGUE)[0];
    expect(four.severity.score).toBeGreaterThan(one.severity.score);
    expect(four.severity.breadthBonus).toBe(15);
  });

  it("caps a single low-reliability signal at medium and a single signal at high", () => {
    const weak = correlate([f("ctr", "advertising", "global", "negative", 80, { score: 70, reliability: 0.3 })], ASOF, CATALOGUE)[0];
    expect(weak.severity.level).toBe("medium");
    expect(weak.severity.cap).toMatch(/low-reliability/);
    const single = correlate([f("ctr", "advertising", "global", "negative", 80, { score: 90, reliability: 0.9, magnitude: 0.5 })], ASOF, CATALOGUE)[0];
    expect(single.severity.level).toBe("high");
  });

  it("uses only the canonical severity levels", () => {
    const levels = DEFAULT_CONFIG.severity.levels.map((l) => l.level).sort();
    expect(levels).toEqual(["critical", "high", "low", "medium"]);
  });
});
