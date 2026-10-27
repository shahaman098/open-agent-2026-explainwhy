import { median, conditionalCountTail, robustSd, round, zFromTail } from "@/intelligence/baselines/statistics";
import type { CustomArgs, Evaluation, SignalDef } from "@/intelligence/detection/signal";
import { requiredZ } from "@/intelligence/detection/signal";
import type { SignalSeries } from "@/intelligence/signals/series";
import { dailyBefore, ratio, rateImpact } from "@/intelligence/detection/rules/common";

/** Projected stockouts inside this many hours are flagged. */
export const STOCKOUT_HORIZON_HOURS = 48;
/** Minimum units depleted in the last 24h before a stock projection is meaningful. */
export const MIN_UNITS_FOR_PROJECTION = 6;

type CustomResult = ReturnType<NonNullable<SignalDef["custom"]>>;

/** Units depleted over the 24h ending at k, scaled from a shorter span (≥6h) when stock was first seen later. */
export function depletion24(s: SignalSeries, productId: string, k: number): { units: number; spanHours: number } | null {
  const now = s.stockAt(productId, k);
  if (Number.isNaN(now)) return null;
  let k0 = k - 24;
  let then = s.stockAt(productId, k0);
  if (Number.isNaN(then)) {
    const first = s.firstStockBoundary(productId);
    if (first < 0 || k - first < 6) return null;
    k0 = first; then = s.stockAt(productId, first);
  }
  const span = k - k0;
  return { units: (Math.max(0, then - now) * 24) / span, spanHours: span };
}

function blank(s: SignalSeries, k: number, reason: string): CustomResult {
  return { ok: false, skipReason: reason, at: s.time(k), window: { startAt: s.time(Math.max(0, k - 24)), endAt: s.time(k) }, actual: null, expected: null,
    delta: null, changePercent: null, z: null, currentNumerator: null, currentDenominator: null, baseline: null, triggered: false, strength: 0 };
}

const productId = (seg: string) => seg.slice("product:".length);

function stockout({ series: s, segment, kEval }: CustomArgs): CustomResult {
  const p = productId(segment);
  const stock = s.stockAt(p, kEval);
  if (Number.isNaN(stock)) return blank(s, kEval, "no inventory observation for this product");
  const recentOrders = s.sum(segment, "orders", kEval - 72, kEval);
  if (recentOrders < 3) return blank(s, kEval, `only ${recentOrders} orders in the last 72h: no demand to protect`);
  const prior = s.stockAt(p, kEval - 24);
  const triggered = stock === 0;
  return { ok: true, at: s.time(kEval), window: { startAt: s.time(Math.max(0, kEval - 24)), endAt: s.time(kEval) }, actual: stock,
    expected: Number.isNaN(prior) ? null : prior, delta: Number.isNaN(prior) ? null : stock - prior, changePercent: null, z: null,
    currentNumerator: stock, currentDenominator: null, baseline: null, triggered, strength: triggered ? 2 : 0,
    details: { availableUnits: stock, ordersLast72h: recentOrders, reliability: 0.9, assumption: "stock level from the latest inventory.level_changed event" } };
}

function projected({ series: s, segment, kEval }: CustomArgs): CustomResult {
  const p = productId(segment);
  const stock = s.stockAt(p, kEval);
  if (Number.isNaN(stock)) return blank(s, kEval, "no inventory observation for this product");
  if (stock === 0) return blank(s, kEval, "already out of stock (see product_stockout)");
  const d = depletion24(s, p, kEval);
  if (!d) return blank(s, kEval, "not enough inventory history to measure depletion");
  const window = { startAt: s.time(kEval - d.spanHours), endAt: s.time(kEval) };
  const base = { ok: true, at: s.time(kEval), window, currentNumerator: d.units, currentDenominator: null, baseline: null, z: null, changePercent: null };
  if (d.units < MIN_UNITS_FOR_PROJECTION) {
    return { ...base, actual: null, expected: STOCKOUT_HORIZON_HOURS, delta: null, triggered: false, strength: 0,
      details: { unitsLast24h: round(d.units, 2), availableUnits: stock, note: "depletion too slow to project" } };
  }
  const perHour = d.units / 24;
  const cover = stock / perHour;
  const spread = 1.96 * Math.sqrt(d.units);
  const hi = (d.units + spread) / 24; const lo = Math.max(0, d.units - spread) / 24;
  const triggered = cover < STOCKOUT_HORIZON_HOURS;
  return { ...base, actual: round(cover, 2), expected: STOCKOUT_HORIZON_HOURS, delta: round(cover - STOCKOUT_HORIZON_HOURS, 2), triggered,
    strength: round(STOCKOUT_HORIZON_HOURS / Math.max(cover, 0.1), 4),
    details: {
      availableUnits: stock, unitsLast24h: round(d.units, 2), coverHours: round(cover, 1),
      coverRangeHours: [round(stock / hi, 1), lo > 0 ? round(stock / lo, 1) : null],
      reliability: round(d.units / (d.units + 10), 3),
      assumption: "the last 24h depletion rate continues and no replenishment arrives; range is a 95% Poisson interval on units sold",
    } };
}

function acceleration({ series: s, segment, kEval, cutoffK, config }: CustomArgs): CustomResult {
  const p = productId(segment);
  const d = depletion24(s, p, kEval);
  if (!d || d.spanHours < 24) return blank(s, kEval, "needs 24h of inventory observations");
  const days: number[] = [];
  for (let j = 0; days.length < config.maxBaselineSamples; j++) {
    const k1 = Math.min(cutoffK, kEval - 24) - 24 * j; const k0 = k1 - 24;
    if (k0 < 0) break;
    const a = s.stockAt(p, k0); const b = s.stockAt(p, k1);
    if (Number.isNaN(a) || Number.isNaN(b)) break;
    days.push(Math.max(0, a - b));
  }
  if (days.length < config.minBaselineSamples) return blank(s, kEval, `needs ≥${config.minBaselineSamples} prior days of inventory history, found ${days.length}`);
  const v0 = median(days) as number;
  const ref = Math.max(v0, 1);
  // Baseline depletion is estimated, not a known Poisson mean; account for its
  // uncertainty and the simultaneous comparison across catalogue products.
  const spread = Math.max(robustSd(days) ?? 0, Math.sqrt(ref)) * Math.sqrt(1 + Math.PI / (2 * days.length));
  const z = Math.min((d.units - v0) / spread,
    d.units > v0 ? zFromTail(conditionalCountTail(Math.floor(d.units), days.reduce((a, b) => a + b, 0), days.length, true)) : 0);
  const zRequired = requiredZ(3.5, s.products.size);
  const rel = d.units / ref;
  const triggered = d.units >= 12 && rel >= 2.5 && z >= zRequired;
  return { ok: true, at: s.time(kEval), window: { startAt: s.time(kEval - 24), endAt: s.time(kEval) }, actual: round(d.units, 2), expected: v0,
    delta: round(d.units - v0, 2), changePercent: v0 > 0 ? round(((d.units - v0) / v0) * 100, 2) : null, z: round(z, 3),
    currentNumerator: d.units, currentDenominator: null,
    baseline: null, triggered, strength: round(Math.min(rel / 2.5, z / zRequired), 4),
    details: { unitsLast24h: round(d.units, 2), baselineDailyUnits: days, zRequired, significanceTest: "conditional count test with catalogue multiplicity correction", reliability: round(days.length / (days.length + 2), 3) } };
}

const productRevenue = (c: { series: SignalSeries; segment: string; cutoffK: number }) => dailyBefore(c.series, c.segment, "revenueMinor", c.cutoffK);

/** Detector 5 — inventory availability, driven by observed depletion velocity rather than raw stock levels. */
export const INVENTORY_SIGNALS: SignalDef[] = [
  {
    id: "product_stockout", label: "Product out of stock with recent demand", family: "inventory", theme: "inventory", kind: "custom", unit: "units",
    segmentKinds: ["product"], windows: [24], measure: ratio("orders", "orders"),
    triggers: [{ direction: "decrease", polarity: "negative", minRelChange: 1, minZ: 0, minAbsChange: 0 }],
    impactPerDay: (c) => productRevenue(c), custom: stockout,
  },
  {
    id: "projected_stockout", label: `Projected stockout within ${STOCKOUT_HORIZON_HOURS}h`, family: "inventory", theme: "inventory", kind: "custom", unit: "hours",
    segmentKinds: ["product"], windows: [24], measure: ratio("orders", "orders"),
    triggers: [{ direction: "decrease", polarity: "negative", minRelChange: 1, minZ: 0, minAbsChange: 0 }],
    impactPerDay: (c) => productRevenue(c) * Math.max(0, 1 - ((c.evaluation.actual ?? STOCKOUT_HORIZON_HOURS) / STOCKOUT_HORIZON_HOURS)) + productRevenue(c) * 0.25,
    custom: projected,
  },
  {
    id: "depletion_acceleration", label: "Unusually rapid inventory depletion", family: "inventory", theme: "inventory", kind: "custom", unit: "units",
    segmentKinds: ["product"], windows: [24], measure: ratio("orders", "orders"),
    triggers: [{ direction: "increase", polarity: "negative", minRelChange: 1, minZ: 3, minAbsChange: 8 }],
    impactPerDay: (c) => productRevenue(c) * 0.5, custom: acceleration,
  },
  {
    id: "stockout_failure_rate", label: "Checkouts failing for lack of stock", family: "inventory", theme: "inventory", kind: "rate", unit: "rate",
    segmentKinds: ["global"], windows: [24], measure: ratio("stockoutFailures", ["orders", "checkoutFailures"]),
    minCurrent: 30, minBaselineDenominator: 60, minNumerator: 3,
    triggers: [{ direction: "increase", polarity: "negative", minRelChange: 1.0, minZ: 3, minAbsChange: 0.02 }],
    impactPerDay: rateImpact(),
  },
];

export type { Evaluation };
