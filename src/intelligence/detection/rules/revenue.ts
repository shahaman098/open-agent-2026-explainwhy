import type { SignalDef } from "@/intelligence/detection/signal";
import { count, countImpact, moneyImpact, ratio, total } from "@/intelligence/detection/rules/common";

/** Detector 1 — revenue and sales (whole business). Campaign-level sales live in advertising.ts. */
export const REVENUE_SIGNALS: SignalDef[] = [
  {
    id: "revenue", label: "Net revenue", family: "revenue", theme: "sales", kind: "money", unit: "minor", canonicalMetric: "revenue_minor",
    segmentKinds: ["global"], windows: [6, 24], measure: count("revenueMinor"), noiseCount: total("orders"), minExpectedNoiseCount: { 6: 4, 24: 12 },
    triggers: [
      { direction: "decrease", polarity: "negative", minRelChange: 0.25, minZ: 3, minAbsChange: { 6: 15_000, 24: 40_000 } },
      { direction: "increase", polarity: "positive", minRelChange: 0.5, minZ: 3.5, minAbsChange: { 6: 15_000, 24: 40_000 } },
    ],
    impactPerDay: moneyImpact(),
  },
  {
    id: "orders", label: "Completed orders", family: "revenue", theme: "sales", kind: "count", unit: "count", canonicalMetric: "orders",
    segmentKinds: ["global"], windows: [6, 24], measure: count("orders"), minExpected: { 6: 4, 24: 12 },
    triggers: [
      { direction: "decrease", polarity: "negative", minRelChange: 0.25, minZ: 3, minAbsChange: { 6: 4, 24: 10 } },
      { direction: "increase", polarity: "positive", minRelChange: 0.5, minZ: 3.5, minAbsChange: { 6: 4, 24: 10 } },
    ],
    impactPerDay: countImpact(),
  },
  {
    id: "aov", label: "Average order value", family: "revenue", theme: "sales", kind: "ratio", unit: "minor",
    segmentKinds: ["global"], windows: [24], measure: ratio("revenueMinor", "orders"), support: total("orders"),
    minCurrent: 20, minBaselineDenominator: 40,
    triggers: [
      { direction: "decrease", polarity: "negative", minRelChange: 0.2, minZ: 3, minAbsChange: 1_500 },
      { direction: "increase", polarity: "positive", minRelChange: 0.3, minZ: 3, minAbsChange: 2_000 },
    ],
    impactPerDay: (c) => Math.abs(c.evaluation.delta ?? 0) * (c.evaluation.currentDenominator ?? 0),
  },
];
