import type { SignalDef } from "@/intelligence/detection/signal";
import { parseSegmentKey } from "@/intelligence/types";

/** Canonical `SourceReference` shape from @normal/contracts (collection + recordId), reused for detection evidence. */
export interface SourceRef {
  collection: string;
  recordId: string;
}

export interface EventQuery {
  collection: "business_events";
  filter: Record<string, unknown>;
  description: string;
}

/**
 * The canonical events that justify a finding, as a resolvable query over `business_events` for the finding's
 * current window. The investigator can re-run it to retrieve every supporting event, not just the stored samples.
 */
export function evidenceQuery(def: SignalDef, businessId: string, simulationRunId: string, segmentKey: string, window: { startAt: string; endAt: string }): EventQuery {
  const seg = parseSegmentKey(segmentKey);
  const base: Record<string, unknown> = { businessId, simulationRunId };
  const occurred = { occurredAt: { $gte: window.startAt, $lt: window.endAt } };
  const campaign = seg.kind === "campaign" ? { "payload.campaignId": seg.id } : {};
  const product = seg.kind === "product" ? seg.id : undefined;
  switch (def.family) {
    case "advertising":
      if (def.id.endsWith("sessions")) return { collection: "business_events", filter: { ...base, type: "web.session_started", ...occurred, ...(seg.kind === "campaign" ? campaign : { "payload.campaignId": { $exists: true } }) }, description: "paid sessions in the current window" };
      if (def.id.endsWith("orders") || def.id.endsWith("revenue")) return { collection: "business_events", filter: { ...base, type: "order.completed", ...occurred, ...(seg.kind === "campaign" ? campaign : { "payload.campaignId": { $exists: true } }) }, description: "campaign-attributed orders in the current window" };
      return { collection: "business_events", filter: { ...base, type: "ad.metrics_observed", "payload.window.startAt": { $gte: window.startAt, $lt: window.endAt }, ...campaign }, description: "hourly ad observations in the current window" };
    case "revenue":
      return { collection: "business_events", filter: { ...base, type: "order.completed", ...occurred }, description: "completed orders in the current window" };
    case "checkout":
      if (def.id === "conversion_rate") return { collection: "business_events", filter: { ...base, type: { $in: ["web.session_started", "order.completed"] }, ...occurred }, description: "sessions and completed orders in the current window" };
      return { collection: "business_events", filter: { ...base, type: "checkout.failed", ...occurred, ...(def.id === "coupon_failure_rate" ? { "payload.failureCode": "coupon_rejected" } : {}) }, description: "failed checkouts in the current window" };
    case "shipping":
      return { collection: "business_events", filter: { ...base, type: "delivery.status_changed", "payload.promisedAt": { $gte: window.startAt, $lt: window.endAt } }, description: "delivery events for shipments whose promise fell due in the current window" };
    case "inventory":
      if (def.id === "stockout_failure_rate") return { collection: "business_events", filter: { ...base, type: "checkout.failed", "payload.failureCode": "out_of_stock", ...occurred }, description: "checkouts that failed for lack of stock" };
      return { collection: "business_events", filter: { ...base, type: "inventory.level_changed", "payload.productId": product, ...occurred }, description: "inventory level changes for the product in the current window" };
    case "reputation":
      return { collection: "business_events", filter: { ...base, type: "review.created", ...occurred, ...(product ? { "payload.productId": product } : {}) }, description: "reviews in the current window" };
    case "demand":
      if (def.id.endsWith("mentions")) return { collection: "business_events", filter: { ...base, type: "social.mention_observed", ...occurred, ...(product ? { "payload.productId": product } : {}) }, description: "synthetic social mentions in the current window" };
      if (def.id === "product_orders") return { collection: "business_events", filter: { ...base, type: "order.completed", "payload.productIds": product, ...occurred }, description: "orders containing the product in the current window" };
      return { collection: "business_events", filter: { ...base, type: "web.session_started", ...occurred, ...(seg.kind === "channel" ? { "payload.channel": seg.id } : {}) }, description: "sessions in the current window" };
  }
}

/** Snapshot dimension used for canonical evidence (MetricSnapshot.dimension). */
export function snapshotDimension(segmentKey: string): { campaignId?: string; productId?: string; channel?: string } {
  const s = parseSegmentKey(segmentKey);
  if (s.kind === "campaign") return { campaignId: s.id };
  if (s.kind === "product") return { productId: s.id };
  if (s.kind === "channel") return { channel: s.id };
  return {};
}
