import { binomialSe, binomialTail, fisherTail, round, smoothedRate, zFromTail } from "@/intelligence/baselines/statistics";
import type { SignalDef } from "@/intelligence/detection/signal";
import { ratio, rateImpact } from "@/intelligence/detection/rules/common";
import type { SignalSeries } from "@/intelligence/signals/series";

/** Shipping is observable once the first delivery promise has fallen due in this run. */
const firstPromiseDue = (s: SignalSeries) => s.firstObserved("global", "shipmentsDue");

/**
 * Detector 4 — shipping and fulfilment.
 *
 * Late delivery uses due-date cohorts: a shipment belongs to the window in which its promise fell due, and it is late
 * unless delivered on or before that promise. Every cohort member's deadline has passed, so a young cohort can never
 * look healthy just because its delays have not been reported yet. `overdue_shipments` is the leading indicator: the
 * number of parcels past their promise and still open right now.
 */
export const SHIPPING_SIGNALS: SignalDef[] = [
  {
    id: "late_delivery_rate", label: "Late delivery rate (due-date cohort)", family: "shipping", theme: "fulfilment", kind: "rate", unit: "rate", canonicalMetric: "late_delivery_rate",
    segmentKinds: ["global"], windows: [12, 24], measure: ratio("shipmentsLate", "shipmentsDue"), observableFrom: firstPromiseDue,
    minCurrent: { 12: 12, 24: 20 }, minBaselineDenominator: { 12: 24, 24: 40 }, minNumerator: 4,
    triggers: [{ direction: "increase", polarity: "negative", minRelChange: 1.0, minZ: 3.5, minAbsChange: 0.1 }],
    impactPerDay: rateImpact(0.25),
  },
  {
    id: "lost_shipment_rate", label: "Lost shipment rate", family: "shipping", theme: "fulfilment", kind: "rate", unit: "rate",
    segmentKinds: ["global"], windows: [24], measure: ratio("shipmentsLost", "shipmentsDue"), observableFrom: firstPromiseDue,
    minCurrent: 30, minBaselineDenominator: 60, minNumerator: 3,
    triggers: [{ direction: "increase", polarity: "negative", minRelChange: 2.0, minZ: 3, minAbsChange: 0.06 }],
    impactPerDay: rateImpact(1),
  },
  {
    // Leading indicator: parcels past their promise and still open NOW, relative to the volume falling due. A raw count
    // would rise with order volume alone (e.g. a demand surge) without any change in delivery reliability.
    id: "overdue_shipments", label: "Open shipments past their promise (volume-adjusted)", family: "shipping", theme: "fulfilment", kind: "custom", unit: "rate",
    segmentKinds: ["global"], windows: [24], measure: ratio("shipmentsLate", "shipmentsDue"), observableFrom: firstPromiseDue,
    triggers: [{ direction: "increase", polarity: "negative", minRelChange: 2.0, minZ: 3.5, minAbsChange: 6 }],
    impactPerDay: (c) => Math.max(0, (c.evaluation.currentNumerator ?? 0) - (c.evaluation.expected ?? 0) * (c.evaluation.currentDenominator ?? 0)) * c.aov * 0.25,
    custom: ({ series: s, kEval, cutoffK, trigger, config }) => {
      const minK = firstPromiseDue(s);
      const at = s.time(kEval);
      const window = { startAt: s.time(Math.max(0, kEval - 24)), endAt: at };
      const volume = (k: number) => Math.max(10, s.sum("global", "shipmentsDue", k - 24, k));
      const blankR = (reason: string) => ({ ok: false, skipReason: reason, at, window, actual: null, expected: null, delta: null, changePercent: null, z: null,
        currentNumerator: null, currentDenominator: null, baseline: null, triggered: false, strength: 0 });
      if (minK < 0 || kEval < minK) return blankR("signal not yet observable in this run");
      const points: Array<{ k: number; open: number; vol: number }> = [];
      for (let d = 1; points.length < config.maxBaselineSamples; d++) {
        const k = kEval - 24 * d;
        if (k < minK) break;
        if (k <= cutoffK) points.push({ k, open: s.overdueOpen[k], vol: volume(k) });
      }
      if (points.length < config.minBaselineSamples) return blankR(`baseline insufficient_history: needs ≥${config.minBaselineSamples} same-hour points after the first promise fell due, found ${points.length}`);
      const open = s.overdueOpen[kEval]; const vol = volume(kEval);
      const p0 = smoothedRate(points.reduce((a, p) => a + p.open, 0), points.reduce((a, p) => a + p.vol, 0)) as number;
      const lambda = p0 * vol;
      const share = open / vol;
      // Conditional rate comparison: given all open-past-promise parcels (now + baseline points), the share observed now
      // should match the share of volume now. Accounts for uncertainty in the baseline rate.
      const sumOpen = points.reduce((a, p) => a + p.open, 0); const sumVol = points.reduce((a, p) => a + p.vol, 0);
      const pNow = vol / (vol + sumVol);
      const total = Math.round(open + sumOpen);
      const z = open > lambda ? zFromTail(binomialTail(open, total, pNow, true)) : -zFromTail(binomialTail(open, total, pNow, false));
      const rel = (share - p0) / p0;
      const triggered = rel >= trigger.minRelChange && z >= trigger.minZ && open - lambda >= (trigger.minAbsChange as number);
      const strength = open > lambda ? Math.min(rel / trigger.minRelChange, z / trigger.minZ) : 0;
      return { ok: true, at, window, actual: round(share, 4), expected: round(p0, 4), delta: round(share - p0, 4), changePercent: round(rel * 100, 2), z: round(z, 3),
        currentNumerator: open, currentDenominator: vol, triggered, strength: round(strength, 4),
        baseline: { status: "ok" as const, method: "same_hour_point" as const, cutoff: s.time(cutoffK), n: points.length, expected: p0, spread: null,
          estimator: "pooled overdue share (Σopen+0.5)/(Σvolume+1) at the same hour on earlier days",
          samples: points.map((p) => ({ startAt: s.time(p.k - 24), endAt: s.time(p.k), numerator: p.open, denominator: p.vol, value: p.open / p.vol })) },
        details: { openPastPromise: open, dueLast24h: vol, expectedOpen: round(lambda, 2), significanceTest: "conditional binomial test vs baseline points", reliability: round(points.length / (points.length + 2), 3) } };
    },
  },
  {
    id: "fulfilment_backlog", label: "Orders unshipped after 36 hours", family: "shipping", theme: "fulfilment", kind: "gauge", unit: "count",
    segmentKinds: ["global"], windows: [0], measure: () => ({ num: 0, den: 1 }), gauge: (s, _seg, k) => s.backlog[k] ?? NaN,
    observableFrom: (s) => (s.firstObserved("global", "orders") < 0 ? -1 : s.firstObserved("global", "orders") + 36), zeroBaselineFloor: 0.5,
    triggers: [{ direction: "increase", polarity: "negative", minRelChange: 2.0, minZ: 3, minAbsChange: 5 }],
    impactPerDay: (c) => Math.abs(c.evaluation.delta ?? 0) * c.aov * 0.25,
  },
  {
    // Concentration: one product's late rate against the rest of the business over the same 72h of due dates.
    id: "product_late_concentration", label: "Late deliveries concentrated on one product", family: "shipping", theme: "fulfilment", kind: "custom", unit: "rate",
    segmentKinds: ["product"], windows: [72], measure: ratio("shipmentsLate", "shipmentsDue"),
    triggers: [{ direction: "increase", polarity: "negative", minRelChange: 1.0, minZ: 3.5, minAbsChange: 0.2 }],
    impactPerDay: (c) => Math.abs(c.evaluation.delta ?? 0) * (c.evaluation.currentDenominator ?? 0) / 3 * c.aov * 0.25,
    custom: ({ series, segment, kEval, windowHours: W, trigger }) => {
      const k0 = kEval - W;
      const at = series.time(kEval);
      const window = { startAt: series.time(Math.max(0, k0)), endAt: at };
      const due = series.sum(segment, "shipmentsDue", k0, kEval);
      const late = series.sum(segment, "shipmentsLate", k0, kEval);
      const restDue = series.sum("global", "shipmentsDue", k0, kEval) - due;
      const restLate = series.sum("global", "shipmentsLate", k0, kEval) - late;
      const base = { at, window, currentNumerator: late, currentDenominator: due, baseline: null };
      if (k0 < 0 || due < 15 || restDue < 30) {
        return { ...base, ok: false, skipReason: `needs ≥15 due shipments for the product and ≥30 elsewhere (have ${due}/${restDue})`, actual: null, expected: null, delta: null, changePercent: null, z: null, triggered: false, strength: 0 };
      }
      const p = late / due; const r = smoothedRate(restLate, restDue) as number;
      // Exact binomial tail of the product's late count under the rest-of-business rate, as a z-equivalent.
      const z = Math.min((p - r) / binomialSe(r, due), p > r ? zFromTail(fisherTail(late, due, restLate, restDue, true)) : 0);
      const rel = (p - r) / r;
      const triggered = late >= 4 && rel >= trigger.minRelChange && z >= trigger.minZ && p - r >= (trigger.minAbsChange as number);
      const strength = p > r ? Math.min(rel / trigger.minRelChange, z / trigger.minZ, (p - r) / (trigger.minAbsChange as number)) : 0;
      return { ...base, ok: true, actual: p, expected: r, delta: p - r, changePercent: round(rel * 100, 2), z: round(z, 3), triggered, strength: round(strength, 4),
        details: { comparison: "rest of business, same due window", restDue, restLate, reliability: Math.min(1, due / 40) } };
    },
  },
];
