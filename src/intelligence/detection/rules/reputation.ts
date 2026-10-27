import type { SignalDef } from "@/intelligence/detection/signal";
import { ratio, relativeImpact, total } from "@/intelligence/detection/rules/common";
import type { Field, SignalSeries } from "@/intelligence/signals/series";
import type { WindowMeasure } from "@/intelligence/baselines/engine";

/**
 * Detector 6 — customer reputation from synthetic `review.created` events. Reviews are sparse, so the current window
 * is 72h (and 120h for single products, which receive about one review a day at most) and the baseline pools all
 * earlier history (up to 14 days). Products and categories are compared with the REST of the catalogue's pooled
 * history: a single product rarely has enough reviews for its own baseline, and it must never be compared with a pool
 * that contains its own incident reviews.
 * Simulated reviews are never presented as public Nike sentiment.
 */
/**
 * "rest:<segment>" = the whole catalogue EXCLUDING that product/category, so a segment is never compared with a pool
 * that contains its own (possibly incident) reviews.
 */
const restOf = (segment: string) => `rest:${segment}`;
const restRatio = (num: Field, den: Field) => (s: SignalSeries, seg: string, k0: number, k1: number): WindowMeasure => {
  if (!seg.startsWith("rest:")) return ratio(num, den)(s, seg, k0, k1);
  const own = seg.slice(5);
  return { num: s.sum("global", num, k0, k1) - s.sum(own, num, k0, k1), den: s.sum("global", den, k0, k1) - s.sum(own, den, k0, k1) };
};
const firstReview = (s: SignalSeries) => s.firstObserved("global", "reviews");
export const REPUTATION_SIGNALS: SignalDef[] = [
  {
    id: "low_rating_rate", label: "Share of 1–2★ reviews", family: "reputation", theme: "reputation", kind: "rate", unit: "rate", canonicalMetric: "low_rating_rate",
    segmentKinds: ["global"], windows: [72], baseline: "pooled_history", observableFrom: firstReview, measure: ratio("lowReviews", "reviews"),
    minCurrent: 10, minBaselineDenominator: 10, minNumerator: 3,
    triggers: [{ direction: "increase", polarity: "negative", minRelChange: 1.0, minZ: 3, minAbsChange: 0.08 }],
    impactPerDay: relativeImpact(0.3),
  },
  {
    id: "product_low_rating_rate", label: "Product share of 1–2★ reviews", family: "reputation", theme: "reputation", kind: "rate", unit: "rate", canonicalMetric: "low_rating_rate",
    segmentKinds: ["product"], windows: [72, 120], baseline: "pooled_history", observableFrom: firstReview, baselineSegment: restOf, measure: restRatio("lowReviews", "reviews"),
    minCurrent: 4, minBaselineDenominator: 10, minNumerator: 3,
    triggers: [{ direction: "increase", polarity: "negative", minRelChange: 1.0, minZ: 3, minAbsChange: 0.2 }],
    impactPerDay: relativeImpact(0.3),
  },
  {
    id: "category_low_rating_rate", label: "Category share of 1–2★ reviews", family: "reputation", theme: "reputation", kind: "rate", unit: "rate",
    segmentKinds: ["category"], windows: [72], baseline: "pooled_history", observableFrom: firstReview, baselineSegment: restOf, measure: restRatio("lowReviews", "reviews"),
    minCurrent: 6, minBaselineDenominator: 10, minNumerator: 3,
    triggers: [{ direction: "increase", polarity: "negative", minRelChange: 1.0, minZ: 3, minAbsChange: 0.15 }],
    impactPerDay: relativeImpact(0.3),
  },
  {
    id: "avg_rating", label: "Average review rating", family: "reputation", theme: "reputation", kind: "ratio", unit: "stars",
    segmentKinds: ["global", "product"], windows: [72], baseline: "pooled_history", observableFrom: firstReview, baselineSegment: (seg) => (seg === "global" ? seg : restOf(seg)), measure: restRatio("ratingSum", "reviews"),
    support: total("reviews"), minCurrent: 4, minBaselineDenominator: 10, relativeSpreadFloor: 0.03,
    triggers: [{ direction: "decrease", polarity: "negative", minRelChange: 0.12, minZ: 3, minAbsChange: 0.5 }],
    impactPerDay: relativeImpact(0.3),
  },
];
