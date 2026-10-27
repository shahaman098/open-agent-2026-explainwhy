import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/intelligence/config";
import { computeBaseline, defaultMethod, selectWindows } from "@/intelligence/baselines/engine";
import { SIGNALS_BY_ID } from "@/intelligence/detection/rules";
import { evaluatePoint } from "@/intelligence/detection/signal";
import { at, jitter, seriesFrom } from "./synth";

const steady = (h: number) => ({ sessions: { direct: 50 + jitter(h, 1, 3) }, orders: 2 + (h % 3 === 0 ? 1 : 0) });

describe("baseline window selection (Milestone 1)", () => {
  it("sub-day windows compare the same hour of day on earlier days; whole days use trailing windows", () => {
    expect(defaultMethod("count", 6)).toBe("same_hour");
    expect(defaultMethod("count", 24)).toBe("trailing_windows");
    expect(defaultMethod("gauge", 0)).toBe("same_hour_point");
    expect(selectWindows("same_hour", 100, 6, 94)).toEqual([[70, 76], [46, 52], [22, 28]]);
    expect(selectWindows("trailing_windows", 100, 24, 76)).toEqual([[52, 76], [28, 52], [4, 28]]);
  });

  it("never overlaps the current window and respects the cutoff and data-maturity boundary", () => {
    for (const [, k1] of selectWindows("same_hour", 200, 6, 194)) expect(k1).toBeLessThanOrEqual(194);
    // frozen cutoff at an onset 30h before evaluation pushes baseline days back
    const frozen = selectWindows("same_hour", 200, 6, 164);
    expect(frozen.every(([, k1]) => k1 <= 164)).toBe(true);
    expect(frozen[0]).toEqual([146, 152]);
    expect(selectWindows("same_hour", 100, 6, 94, DEFAULT_CONFIG, 50)).toEqual([[70, 76]]);
  });
});

describe("baseline estimation", () => {
  it("a stable history yields an expected value close to the truth with a positive spread", () => {
    const s = seriesFrom(24 * 6, steady);
    const def = SIGNALS_BY_ID.get("sessions")!;
    const r = computeBaseline({ kind: "count", windowHours: 6, kEval: 144, cutoffK: 138, method: "same_hour", time: (k) => s.time(k),
      measure: (k0, k1) => def.measure(s, "global", k0, k1) });
    expect(r.status).toBe("ok");
    expect(r.n).toBe(5);
    expect(r.expected).toBeGreaterThan(280);
    expect(r.expected).toBeLessThan(320);
    expect(r.spread).toBeGreaterThan(0);
    expect(r.samples.every((x) => x.endAt <= r.cutoff)).toBe(true);
  });

  it("a known synthetic outlier is measured against the clean baseline and flagged", () => {
    const s = seriesFrom(24 * 5, (h) => ({ sessions: { direct: h >= 114 ? 150 : 50 + jitter(h, 1, 3) } }));
    const def = SIGNALS_BY_ID.get("sessions")!;
    const ev = evaluatePoint(def, def.triggers[1], s, "global", 6, 120, 114);
    expect(ev.ok).toBe(true);
    expect(ev.expected).toBeGreaterThan(280);
    expect(ev.actual).toBe(900);
    expect(ev.triggered).toBe(true);
  });

  it("returns explicit insufficient-history results instead of inventing expected values", () => {
    const s = seriesFrom(30, steady);
    const def = SIGNALS_BY_ID.get("sessions")!;
    const ev = evaluatePoint(def, def.triggers[0], s, "global", 6, 30, 24);
    expect(ev.ok).toBe(false);
    expect(ev.skipReason).toMatch(/insufficient_history/);
    expect(ev.expected).toBeNull();
    const empty = seriesFrom(0, steady);
    expect(empty.hours).toBe(0);
  });

  it("zero denominators are not counted as samples and never produce NaN", () => {
    const s = seriesFrom(24 * 5, (h) => ({ sessions: { direct: h < 48 ? 0 : 50 }, orders: h < 48 ? 0 : 1 }));
    const def = SIGNALS_BY_ID.get("conversion_rate")!;
    const ev = evaluatePoint(def, def.triggers[0], s, "global", 6, 110, 104);
    expect(ev.ok).toBe(false);
    expect(ev.skipReason).toMatch(/insufficient_history: needs ≥3 comparable windows/);
    for (const v of [ev.actual, ev.expected, ev.z]) expect(v === null || Number.isFinite(v)).toBe(true);
  });

  it("sparse samples are refused below the minimum volume", () => {
    const s = seriesFrom(24 * 5, (h) => ({ productOrders: { p_a: h % 24 === 0 ? 1 : 0 } }));
    const def = SIGNALS_BY_ID.get("product_orders")!;
    const ev = evaluatePoint(def, def.triggers[0], s, "product:p_a", 24, 120, 96);
    expect(ev.ok).toBe(false);
    expect(ev.skipReason).toMatch(/below minimum volume/);
  });

  it("time-aligned comparison: a quiet night hour is judged against previous nights, not the busy day", () => {
    const diurnal = (h: number) => ({ sessions: { direct: (h % 24 < 6 ? 10 : 80) + jitter(h, 2, 2) } });
    const s = seriesFrom(24 * 5, diurnal);
    const def = SIGNALS_BY_ID.get("sessions")!;
    const night = evaluatePoint(def, def.triggers[0], s, "global", 6, 24 * 4 + 6, 24 * 4);
    expect(night.ok).toBe(true);
    expect(night.expected).toBeLessThan(80);
    expect(night.triggered).toBe(false);
  });

  it("the median shrugs off one contaminated window", () => {
    const s = seriesFrom(24 * 8, (h) => ({ sessions: { direct: h >= 24 * 6 ? 20 : 60 + jitter(h, 3, 2) } }));
    const def = SIGNALS_BY_ID.get("sessions")!;
    const ev = evaluatePoint(def, def.triggers[0], s, "global", 6, 24 * 7, 24 * 7 - 6);
    expect(ev.expected).toBeGreaterThan(330);
  });

  it("baseline contamination is prevented: a frozen cutoff keeps a long incident out of the comparison", () => {
    // Incident from day 5; evaluated on day 10, four of seven same-hour windows fall inside the incident.
    const s = seriesFrom(24 * 11, (h) => ({ sessions: { direct: h >= 24 * 5 ? 20 : 60 + jitter(h, 3, 2) } }));
    const def = SIGNALS_BY_ID.get("sessions")!;
    const k = 24 * 10;
    const contaminated = evaluatePoint(def, def.triggers[0], s, "global", 6, k, k - 6);
    const frozen = evaluatePoint(def, def.triggers[0], s, "global", 6, k, 24 * 5);
    expect(contaminated.expected).toBeLessThan(200);
    expect(frozen.expected).toBeGreaterThan(330);
    expect(frozen.triggered).toBe(true);
    expect(frozen.baseline!.samples.every((x) => Date.parse(x.endAt) <= Date.parse(at(24 * 5)))).toBe(true);
  });
});
