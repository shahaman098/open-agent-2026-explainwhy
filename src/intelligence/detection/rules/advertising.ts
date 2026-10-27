import type { SignalDef } from "@/intelligence/detection/signal";
import { count, countImpact, moneyImpact, ratio, relativeImpact, total } from "@/intelligence/detection/rules/common";

/**
 * Detector 2 — advertising efficiency, per campaign and for all paid media. These signals describe performance
 * deterioration; they never assert a cause such as creative fatigue.
 */
export const ADVERTISING_SIGNALS: SignalDef[] = [
  {
    id: "ctr", label: "Ad click-through rate", family: "advertising", theme: "advertising", kind: "rate", unit: "rate", canonicalMetric: "ctr",
    segmentKinds: ["global", "campaign"], windows: [6, 24], measure: ratio("clicks", "impressions"),
    minCurrent: { 6: 1_500, 24: 5_000 }, minBaselineDenominator: { 6: 3_000, 24: 10_000 },
    triggers: [{ direction: "decrease", polarity: "negative", minRelChange: 0.25, minZ: 4, minAbsChange: 0.002 }],
    impactPerDay: relativeImpact(0.6),
  },
  {
    id: "cpa", label: "Cost per acquisition", family: "advertising", theme: "advertising", kind: "ratio", unit: "minor", canonicalMetric: "cac_minor",
    segmentKinds: ["global", "campaign"], windows: [24], measure: ratio("spendMinor", "attributedOrders"), support: total("attributedOrders"),
    minCurrent: 4, minSupport: 4, minBaselineDenominator: 12, roundActual: Math.round,
    triggers: [{ direction: "increase", polarity: "negative", minRelChange: 0.4, minZ: 3, minAbsChange: 300 }],
    impactPerDay: relativeImpact(0.5),
  },
  {
    id: "roas", label: "Return on ad spend", family: "advertising", theme: "advertising", kind: "ratio", unit: "ratio",
    segmentKinds: ["global", "campaign"], windows: [24], measure: ratio("attributedRevenueMinor", "spendMinor"), support: total("attributedOrders"),
    minCurrent: 3_000, minBaselineDenominator: 6_000,
    triggers: [{ direction: "decrease", polarity: "negative", minRelChange: 0.3, minZ: 3, minAbsChange: 0.5 }],
    impactPerDay: relativeImpact(0.5),
  },
  {
    id: "frequency", label: "Ad frequency (impression-weighted)", family: "advertising", theme: "advertising", kind: "ratio", unit: "frequency",
    segmentKinds: ["global", "campaign"], windows: [6], measure: ratio("frequencyWeighted", "impressions"), support: total("impressions"),
    minCurrent: 1_500, minBaselineDenominator: 3_000, relativeSpreadFloor: 0.1,
    triggers: [{ direction: "increase", polarity: "negative", minRelChange: 0.3, minZ: 3, minAbsChange: 0.5 }],
    impactPerDay: relativeImpact(0.2),
  },
  {
    id: "paid_sessions", label: "Paid sessions (all campaigns)", family: "advertising", theme: "advertising", kind: "count", unit: "count",
    segmentKinds: ["global"], windows: [6, 24], measure: count("paidSessions"), minExpected: { 6: 20, 24: 80 },
    triggers: [{ direction: "decrease", polarity: "negative", minRelChange: 0.3, minZ: 4, minAbsChange: { 6: 30, 24: 120 } }],
    impactPerDay: relativeImpact(0.6),
  },
  {
    id: "campaign_sessions", label: "Campaign sessions", family: "advertising", theme: "advertising", kind: "count", unit: "count",
    segmentKinds: ["campaign"], windows: [6, 24], measure: count("sessions"), minExpected: { 6: 10, 24: 40 },
    triggers: [{ direction: "decrease", polarity: "negative", minRelChange: 0.3, minZ: 4, minAbsChange: { 6: 15, 24: 60 } }],
    impactPerDay: relativeImpact(0.6),
  },
  {
    id: "paid_orders", label: "Paid orders (all campaigns)", family: "advertising", theme: "advertising", kind: "count", unit: "count",
    segmentKinds: ["global"], windows: [24], measure: count("paidOrders"), minExpected: 8,
    triggers: [{ direction: "decrease", polarity: "negative", minRelChange: 0.35, minZ: 3, minAbsChange: 6 }],
    impactPerDay: countImpact(),
  },
  {
    id: "campaign_orders", label: "Campaign orders", family: "advertising", theme: "advertising", kind: "count", unit: "count", canonicalMetric: "orders",
    segmentKinds: ["campaign"], windows: [24], measure: count("orders"), minExpected: 4,
    triggers: [
      { direction: "decrease", polarity: "negative", minRelChange: 0.35, minZ: 3, minAbsChange: 4 },
      { direction: "increase", polarity: "positive", minRelChange: 1.0, minZ: 3.5, minAbsChange: 6 },
    ],
    impactPerDay: countImpact(),
  },
  {
    id: "campaign_revenue", label: "Campaign revenue", family: "advertising", theme: "advertising", kind: "money", unit: "minor", canonicalMetric: "revenue_minor",
    segmentKinds: ["campaign"], windows: [24], measure: count("revenueMinor"), noiseCount: total("orders"), minExpected: 30_000, minExpectedNoiseCount: 4,
    triggers: [{ direction: "decrease", polarity: "negative", minRelChange: 0.35, minZ: 3, minAbsChange: 20_000 }],
    impactPerDay: moneyImpact(),
  },
  {
    id: "campaign_conversion_rate", label: "Campaign conversion rate", family: "advertising", theme: "advertising", kind: "rate", unit: "rate", canonicalMetric: "conversion_rate",
    segmentKinds: ["campaign"], windows: [24], measure: ratio("orders", "sessions"), minCurrent: 200, minBaselineDenominator: 400,
    triggers: [{ direction: "decrease", polarity: "negative", minRelChange: 0.3, minZ: 3, minAbsChange: 0.006 }],
    impactPerDay: (c) => Math.abs(c.evaluation.delta ?? 0) * (c.evaluation.currentDenominator ?? 0) * c.aov,
  },
  {
    id: "ad_spend", label: "Ad spend", family: "advertising", theme: "advertising", kind: "money", unit: "minor", canonicalMetric: "ad_spend_minor",
    segmentKinds: ["global", "campaign"], windows: [24], measure: count("spendMinor"), minExpected: 3_000,
    triggers: [
      { direction: "decrease", polarity: "negative", minRelChange: 0.4, minZ: 3, minAbsChange: 3_000 },
      { direction: "increase", polarity: "negative", minRelChange: 0.4, minZ: 3, minAbsChange: 3_000 },
    ],
    impactPerDay: moneyImpact(),
  },
];
