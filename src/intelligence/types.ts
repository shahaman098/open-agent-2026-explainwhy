import type { z } from "zod";
import type { MetricName } from "@normal/contracts";

export type CanonicalMetric = z.infer<typeof MetricName>;
export type Theme = "sales" | "traffic" | "advertising" | "conversion" | "fulfilment" | "inventory" | "reputation" | "demand";
export type RuleFamily = "revenue" | "advertising" | "checkout" | "shipping" | "inventory" | "reputation" | "demand";
export type Polarity = "negative" | "positive";
export type Direction = "increase" | "decrease";
export type SegmentKind = "global" | "campaign" | "product" | "channel" | "category";
export type SeverityLevel = "low" | "medium" | "high" | "critical";

export interface Segment {
  kind: SegmentKind;
  id?: string;
}

export function segmentKey(s: Segment): string {
  return s.kind === "global" ? "global" : `${s.kind}:${s.id}`;
}

export function parseSegmentKey(key: string): Segment {
  if (key === "global") return { kind: "global" };
  const i = key.indexOf(":");
  return { kind: key.slice(0, i) as SegmentKind, id: key.slice(i + 1) };
}

/** Observable product labels supplied to the detector (no simulator internals). */
export interface CatalogueLabel {
  name: string;
  category: string;
}
export type CatalogueView = ReadonlyMap<string, CatalogueLabel>;

export interface TimeWindowT {
  startAt: string;
  endAt: string;
}
