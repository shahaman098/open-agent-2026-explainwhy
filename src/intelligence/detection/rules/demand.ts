import type { SignalDef } from "@/intelligence/detection/signal";
import { count, relativeImpact } from "@/intelligence/detection/rules/common";

/** Detector 7 — demand and traffic. Positive movements are first-class findings, not just failures. */
export const DEMAND_SIGNALS: SignalDef[] = [
  {
    id: "product_orders", label: "Product orders", family: "demand", theme: "demand", kind: "count", unit: "count", canonicalMetric: "orders",
    segmentKinds: ["product"], windows: [24], measure: count("orders"), minExpected: 2,
    triggers: [
      { direction: "increase", polarity: "positive", minRelChange: 1.5, minZ: 3.5, minAbsChange: 8 },
      { direction: "decrease", polarity: "negative", minRelChange: 0.6, minZ: 3, minAbsChange: 4 },
    ],
    impactPerDay: relativeImpact(1),
  },
  {
    id: "product_mentions", label: "Social mentions of a product", family: "demand", theme: "demand", kind: "count", unit: "count",
    segmentKinds: ["product"], windows: [24], measure: count("mentions"), zeroBaselineFloor: 0.5,
    triggers: [{ direction: "increase", polarity: "positive", minRelChange: 2.0, minZ: 4, minAbsChange: 8 }],
    impactPerDay: relativeImpact(0.25),
  },
  {
    id: "social_mentions", label: "Social mentions (all products)", family: "demand", theme: "demand", kind: "count", unit: "count",
    segmentKinds: ["global"], windows: [24], measure: count("mentions"), zeroBaselineFloor: 0.5,
    triggers: [{ direction: "increase", polarity: "positive", minRelChange: 2.0, minZ: 4, minAbsChange: 10 }],
    impactPerDay: relativeImpact(0.1),
  },
  {
    id: "sessions", label: "Website sessions", family: "demand", theme: "traffic", kind: "count", unit: "count",
    segmentKinds: ["global"], windows: [6, 24], measure: count("sessions"), minExpected: { 6: 60, 24: 250 },
    triggers: [
      { direction: "decrease", polarity: "negative", minRelChange: 0.25, minZ: 4, minAbsChange: { 6: 60, 24: 250 } },
      { direction: "increase", polarity: "positive", minRelChange: 0.4, minZ: 4, minAbsChange: { 6: 80, 24: 300 } },
    ],
    impactPerDay: relativeImpact(0.5),
  },
  {
    id: "channel_sessions", label: "Sessions by acquisition channel", family: "demand", theme: "traffic", kind: "count", unit: "count",
    segmentKinds: ["channel"], windows: [6, 24], measure: count("sessions"), minExpected: { 6: 15, 24: 50 },
    triggers: [
      { direction: "increase", polarity: "positive", minRelChange: 1.0, minZ: 4, minAbsChange: { 6: 40, 24: 150 } },
      { direction: "decrease", polarity: "negative", minRelChange: 0.5, minZ: 4, minAbsChange: { 6: 40, 24: 150 } },
    ],
    impactPerDay: relativeImpact(0.3),
  },
];
