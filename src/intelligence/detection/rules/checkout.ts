import type { SignalDef } from "@/intelligence/detection/signal";
import { ratio, rateImpact } from "@/intelligence/detection/rules/common";

/**
 * Detector 3 — checkout and conversion. Checkout attempts = completed orders + failed checkouts (both canonical).
 * Cart abandonment is not measurable: cart activity is not part of the canonical v1 event ledger.
 */
export const CHECKOUT_SIGNALS: SignalDef[] = [
  {
    id: "conversion_rate", label: "Session conversion rate", family: "checkout", theme: "conversion", kind: "rate", unit: "rate", canonicalMetric: "conversion_rate",
    dispersion: "flow", segmentKinds: ["global"], windows: [6, 24], measure: ratio("orders", "sessions"),
    minCurrent: { 6: 300, 24: 1_000 }, minBaselineDenominator: { 6: 600, 24: 2_000 },
    triggers: [
      { direction: "decrease", polarity: "negative", minRelChange: 0.2, minZ: 3, minAbsChange: 0.004 },
      { direction: "increase", polarity: "positive", minRelChange: 0.25, minZ: 3, minAbsChange: 0.005 },
    ],
    impactPerDay: rateImpact(),
  },
  {
    id: "checkout_failure_rate", label: "Checkout failure rate", family: "checkout", theme: "conversion", kind: "rate", unit: "rate", canonicalMetric: "checkout_failure_rate",
    segmentKinds: ["global"], windows: [12, 24], measure: ratio("checkoutFailures", ["orders", "checkoutFailures"]),
    minCurrent: { 12: 10, 24: 20 }, minBaselineDenominator: { 12: 30, 24: 60 }, minNumerator: 4,
    triggers: [{ direction: "increase", polarity: "negative", minRelChange: 1.0, minZ: 3, minAbsChange: { 12: 0.06, 24: 0.05 } }],
    impactPerDay: rateImpact(),
  },
  {
    id: "coupon_failure_rate", label: "Promo-code checkout failure rate", family: "checkout", theme: "conversion", kind: "rate", unit: "rate", canonicalMetric: "coupon_failure_rate",
    segmentKinds: ["global"], windows: [12, 24], measure: ratio("couponFailures", ["orders", "checkoutFailures"]),
    minCurrent: { 12: 10, 24: 20 }, minBaselineDenominator: { 12: 30, 24: 60 }, minNumerator: 4,
    triggers: [{ direction: "increase", polarity: "negative", minRelChange: 1.0, minZ: 3, minAbsChange: { 12: 0.05, 24: 0.04 } }],
    impactPerDay: rateImpact(),
  },
];
