import "server-only";

import type { Db, Document } from "mongodb";
import { z } from "zod";
import { MetricSnapshot, type MetricSnapshotT } from "@normal/contracts";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import type { SimulatedOrder, SimulatedProduct } from "@/types/domain";

/**
 * Metric definitions (all computed from persisted canonical events, windowed by
 * simulated `occurredAt`, half-open [startAt, endAt)):
 *
 * - sessions            count of web.session_started
 * - orders              count of order.completed
 * - revenueMinor        Σ order.completed.netRevenueMinor (net of discounts; refunds reported separately)
 * - refundMinor         Σ order.refunded.refundMinor
 * - adSpend/impressions/clicks/attributedOrders
 *                       Σ ad.metrics_observed whose window.startAt falls in the range, deduplicated by
 *                       (campaignId, window.startAt) so overlapping observations are never double counted
 * - shipments           due-date cohort: distinct shipped orders whose delivery promise (`promisedAt` on the
 *                       "shipped" event) falls in [startAt, min(endAt, virtualTime)). Promises not yet due are
 *                       immature and excluded, so an immature cohort can never read as healthy.
 * - delayedShipments    members of that cohort NOT delivered on or before their promise: still open past the
 *                       promise, delivered late, or lost. Once a promise has passed this classification is final.
 * - reviews / lowRatingReviews  count of review.created, and those with rating <= 2
 * - checkoutFailures / couponFailures  count of checkout.failed, and those with failureCode=coupon_rejected;
 *                       only the global snapshot reports these because the detector's checkout signals are global
 * - conversionRate = orders/sessions · ctr = clicks/impressions · lateDeliveryRate = delayedShipments/shipments
 *   lowRatingRate = lowRatingReviews/reviews · costPerAcquisitionMinor = round(adSpend/attributedOrders)
 *   checkoutFailureRate = checkoutFailures/(orders+checkoutFailures), couponFailureRate =
 *   couponFailures/(orders+checkoutFailures) (each null when its denominator is 0)
 */

export const MetricsDimension = z.object({
  campaignId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  channel: z.string().min(1).optional(),
  device: z.string().min(1).optional(),
}).strict();
export type MetricsDimensionT = z.infer<typeof MetricsDimension>;

export const Bucket = z.enum(["window", "hour", "day"]);
export type BucketT = z.infer<typeof Bucket>;

export interface MetricsQuery {
  businessId: string;
  simulationRunId?: string;
  startAt: string;
  endAt: string;
  bucket: BucketT;
  dimension: MetricsDimensionT;
  /** Simulated "now"; windows ending after it are marked partial. */
  virtualTime: string;
}

type Counters = MetricSnapshotT["counters"] & { checkoutFailures: number; couponFailures: number };
const zeroCounters = (): Counters => ({
  sessions: 0, orders: 0, revenueMinor: 0, refundMinor: 0, adSpendMinor: 0, impressions: 0, clicks: 0,
  attributedOrders: 0, shipments: 0, delayedShipments: 0, reviews: 0, lowRatingReviews: 0, checkoutFailures: 0, couponFailures: 0,
});

function ratio(n: number, d: number): number | null {
  if (d <= 0) return null;
  const r = n / d;
  return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : null;
}

function bucketExpr(bucket: BucketT, startAt: string, field = "$occurredAt"): Document {
  if (bucket === "window") return { $literal: startAt };
  return { $dateToString: { date: { $dateTrunc: { date: { $toDate: field }, unit: bucket } }, format: "%Y-%m-%dT%H:%M:%S.000Z" } };
}

function bucketEnd(bucketStart: string, bucket: BucketT, endAt: string): string {
  if (bucket === "window") return endAt;
  const ms = bucket === "hour" ? 3_600_000 : 86_400_000;
  return new Date(Math.min(Date.parse(bucketStart) + ms, Date.parse(endAt))).toISOString();
}

export function snapshotId(q: Pick<MetricsQuery, "businessId" | "simulationRunId" | "dimension">, startAt: string, endAt: string): string {
  const dim = Object.entries(q.dimension).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(",") || "global";
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "");
  return `snap_${q.businessId}_${q.simulationRunId ?? "all"}_${clean(startAt)}_${clean(endAt)}_${clean(dim)}`;
}

/** Runs the aggregation and returns one validated MetricSnapshot per bucket (empty buckets included). */
export async function computeSnapshots(q: MetricsQuery, dbOverride?: Db): Promise<MetricSnapshotT[]> {
  const db = dbOverride ?? (await getDb());
  const events = db.collection(COLLECTIONS.businessEvents);
  const base: Document = { businessId: q.businessId, occurredAt: { $gte: q.startAt, $lt: q.endAt }, ...(q.simulationRunId ? { simulationRunId: q.simulationRunId } : {}) };
  const b = bucketExpr(q.bucket, q.startAt);
  const dim = q.dimension;
  const needsSessionJoin = Boolean(dim.channel || dim.device);

  const sessionMatch: Document = { type: "web.session_started", ...(dim.campaignId ? { "payload.campaignId": dim.campaignId } : {}),
    ...(dim.channel ? { "payload.channel": dim.channel } : {}), ...(dim.device ? { "payload.device": dim.device } : {}) };
  const orderMatch: Document = { type: "order.completed", ...(dim.campaignId ? { "payload.campaignId": dim.campaignId } : {}),
    ...(dim.productId ? { "payload.productIds": dim.productId } : {}) };
  const orderPipeline: Document[] = [{ $match: orderMatch }];
  if (needsSessionJoin) {
    orderPipeline.push(
      { $lookup: { from: COLLECTIONS.simulatedSessions, let: { sid: "$payload.sessionId", biz: "$businessId" },
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$sessionId", "$$sid"] }, { $eq: ["$businessId", "$$biz"] }] } } }, { $project: { channel: 1, device: 1 } }], as: "session" } },
      { $unwind: "$session" },
      { $match: { ...(dim.channel ? { "session.channel": dim.channel } : {}), ...(dim.device ? { "session.device": dim.device } : {}) } },
    );
  }
  orderPipeline.push({ $group: { _id: b, orders: { $sum: 1 }, revenueMinor: { $sum: "$payload.netRevenueMinor" } } });

  const refundPipeline: Document[] = [{ $match: { type: "order.refunded" } }];
  if (dim.campaignId || dim.productId || needsSessionJoin) {
    refundPipeline.push(
      { $lookup: { from: COLLECTIONS.simulatedOrders, let: { oid: "$payload.orderId", biz: "$businessId" },
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$orderId", "$$oid"] }, { $eq: ["$businessId", "$$biz"] }] } } }, { $project: { campaignId: 1, channel: 1, device: 1, productIds: "$lines.productId" } }], as: "order" } },
      { $unwind: "$order" },
      { $match: { ...(dim.campaignId ? { "order.campaignId": dim.campaignId } : {}), ...(dim.productId ? { "order.productIds": dim.productId } : {}),
        ...(dim.channel ? { "order.channel": dim.channel } : {}), ...(dim.device ? { "order.device": dim.device } : {}) } },
    );
  }
  refundPipeline.push({ $group: { _id: b, refundMinor: { $sum: "$payload.refundMinor" } } });

  // Ads: only meaningful globally or per campaign. Product/channel/device slices report zeros. Selected and bucketed by
  // the observation window's start (see adMetrics below), not by occurredAt, which is the window END.
  const adsApplicable = !dim.productId && !dim.channel && !dim.device;

  const reviewApplicable = !dim.campaignId && !dim.channel && !dim.device;
  const checkoutApplicable = !dim.campaignId && !dim.productId && !dim.channel && !dim.device;
  const checkoutPipeline: Document[] = checkoutApplicable ? [
    { $match: { type: "checkout.failed" } },
    { $group: { _id: b, checkoutFailures: { $sum: 1 }, couponFailures: { $sum: { $cond: [{ $eq: ["$payload.failureCode", "coupon_rejected"] }, 1, 0] } } } },
  ] : [{ $match: { _id: null } }];
  const reviewPipeline: Document[] = reviewApplicable ? [
    { $match: { type: "review.created", ...(dim.productId ? { "payload.productId": dim.productId } : {}) } },
    { $group: { _id: b, reviews: { $sum: 1 }, lowRatingReviews: { $sum: { $cond: [{ $lte: ["$payload.rating", 2] }, 1, 0] } } } },
  ] : [{ $match: { _id: null } }];

  const [facet] = await events.aggregate<Record<string, Array<Document & { _id: string }>>>([
    { $match: base },
    { $facet: {
      sessions: [{ $match: sessionMatch }, { $group: { _id: b, sessions: { $sum: 1 } } }],
      orders: orderPipeline, refunds: refundPipeline, reviews: reviewPipeline, checkout: checkoutPipeline,
    } },
  ], { allowDiskUse: true }).toArray();

  const buckets = new Map<string, Counters>();
  const get = (key: string) => { let c = buckets.get(key); if (!c) { c = zeroCounters(); buckets.set(key, c); } return c; };
  if (q.bucket === "window") get(q.startAt);
  else {
    const ms = q.bucket === "hour" ? 3_600_000 : 86_400_000;
    const first = Math.floor(Date.parse(q.startAt) / ms) * ms;
    for (let t = first; t < Date.parse(q.endAt); t += ms) get(new Date(t).toISOString());
  }
  for (const r of facet.sessions ?? []) get(r._id).sessions = r.sessions as number;
  for (const r of facet.orders ?? []) { const c = get(r._id); c.orders = r.orders as number; c.revenueMinor = r.revenueMinor as number; }
  for (const r of facet.refunds ?? []) get(r._id).refundMinor = r.refundMinor as number;
  if (adsApplicable) for (const r of await adMetrics(db, q)) { const c = get(r._id); c.adSpendMinor = r.adSpendMinor; c.impressions = r.impressions; c.clicks = r.clicks; c.attributedOrders = r.attributedOrders; }
  for (const r of await shippingCohort(db, q)) { const c = get(r._id); c.shipments = r.due; c.delayedShipments = r.late; }
  for (const r of facet.reviews ?? []) { const c = get(r._id); c.reviews = r.reviews as number; c.lowRatingReviews = r.lowRatingReviews as number; }
  for (const r of facet.checkout ?? []) { const c = get(r._id); c.checkoutFailures = r.checkoutFailures as number; c.couponFailures = r.couponFailures as number; }

  const computedAt = new Date().toISOString();
  return [...buckets.entries()].sort(([a], [b2]) => (a < b2 ? -1 : 1)).map(([start, counters]) => {
    const startAt = q.bucket === "window" ? q.startAt : new Date(Math.max(Date.parse(start), Date.parse(q.startAt))).toISOString();
    const endAt = bucketEnd(start, q.bucket, q.endAt);
    const cpa = counters.attributedOrders > 0 ? Math.round(counters.adSpendMinor / counters.attributedOrders) : null;
    const checkoutAttempts = counters.orders + counters.checkoutFailures;
    return MetricSnapshot.parse({
      schemaVersion: 1, businessId: q.businessId, snapshotId: snapshotId(q, startAt, endAt), window: { startAt, endAt }, currency: "GBP",
      dimension: Object.fromEntries(Object.entries(q.dimension).filter(([, v]) => v)),
      counters,
      rates: {
        conversionRate: ratio(counters.orders, counters.sessions), ctr: ratio(counters.clicks, counters.impressions),
        lateDeliveryRate: ratio(counters.delayedShipments, counters.shipments), lowRatingRate: ratio(counters.lowRatingReviews, counters.reviews),
        costPerAcquisitionMinor: cpa,
        checkoutFailureRate: checkoutApplicable ? ratio(counters.checkoutFailures, checkoutAttempts) : null,
        couponFailureRate: checkoutApplicable ? ratio(counters.couponFailures, checkoutAttempts) : null,
      },
      computedAt, completeness: endAt <= q.virtualTime ? "complete" : "partial",
    });
  });
}

/**
 * Ad observations whose window STARTS in [startAt, endAt), deduplicated by (campaignId, window.startAt) and bucketed by
 * window start. (Their `occurredAt` is the window end, so filtering on occurredAt would shift every window by an hour.)
 */
async function adMetrics(db: Db, q: MetricsQuery): Promise<Array<{ _id: string; adSpendMinor: number; impressions: number; clicks: number; attributedOrders: number }>> {
  return db.collection(COLLECTIONS.businessEvents).aggregate<{ _id: string; adSpendMinor: number; impressions: number; clicks: number; attributedOrders: number }>([
    { $match: { businessId: q.businessId, ...(q.simulationRunId ? { simulationRunId: q.simulationRunId } : {}), type: "ad.metrics_observed",
      "payload.window.startAt": { $gte: q.startAt, $lt: q.endAt }, ...(q.dimension.campaignId ? { "payload.campaignId": q.dimension.campaignId } : {}) } },
    { $sort: { receivedAt: 1 } },
    { $group: { _id: { campaignId: "$payload.campaignId", startAt: "$payload.window.startAt" }, doc: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$doc" } },
    { $group: { _id: bucketExpr(q.bucket, q.startAt, "$payload.window.startAt"), adSpendMinor: { $sum: "$payload.spendMinor" }, impressions: { $sum: "$payload.impressions" },
      clicks: { $sum: "$payload.clicks" }, attributedOrders: { $sum: "$payload.attributedOrders" } } },
  ]).toArray();
}

/**
 * Due-date shipping cohort per bucket (see the metric definitions at the top of this file). Runs as its own
 * aggregation because cohort members were shipped before the window and may be delivered after it.
 */
async function shippingCohort(db: Db, q: MetricsQuery): Promise<Array<{ _id: string; due: number; late: number }>> {
  const dueEnd = q.endAt < q.virtualTime ? q.endAt : q.virtualTime;
  if (dueEnd <= q.startAt) return [];
  const dim = q.dimension;
  const pipeline: Document[] = [
    { $match: { businessId: q.businessId, ...(q.simulationRunId ? { simulationRunId: q.simulationRunId } : {}),
      type: "delivery.status_changed", "payload.status": "shipped", "payload.promisedAt": { $gte: q.startAt, $lt: dueEnd } } },
  ];
  if (dim.campaignId || dim.productId || dim.channel || dim.device) {
    pipeline.push(
      { $lookup: { from: COLLECTIONS.simulatedOrders, let: { oid: "$payload.orderId", biz: "$businessId" },
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$orderId", "$$oid"] }, { $eq: ["$businessId", "$$biz"] }] } } }, { $project: { campaignId: 1, channel: 1, device: 1, productIds: "$lines.productId" } }], as: "order" } },
      { $unwind: "$order" },
      { $match: { ...(dim.campaignId ? { "order.campaignId": dim.campaignId } : {}), ...(dim.productId ? { "order.productIds": dim.productId } : {}),
        ...(dim.channel ? { "order.channel": dim.channel } : {}), ...(dim.device ? { "order.device": dim.device } : {}) } },
    );
  }
  pipeline.push(
    { $lookup: { from: COLLECTIONS.businessEvents, let: { oid: "$payload.orderId", biz: "$businessId" },
      pipeline: [
        { $match: { $expr: { $and: [{ $eq: ["$businessId", "$$biz"] }, { $eq: ["$payload.orderId", "$$oid"] }, { $eq: ["$type", "delivery.status_changed"] }] } } },
        { $match: { "payload.status": "delivered" } },
        { $project: { _id: 0, occurredAt: 1 } },
      ], as: "delivered" } },
    { $group: { _id: { bucket: bucketExpr(q.bucket, q.startAt, "$payload.promisedAt"), orderId: "$payload.orderId" },
      promisedAt: { $min: "$payload.promisedAt" }, deliveredAt: { $min: { $min: "$delivered.occurredAt" } } } },
    { $group: { _id: "$_id.bucket", due: { $sum: 1 }, late: { $sum: { $cond: [
      { $and: [{ $ne: ["$deliveredAt", null] }, { $lte: [{ $toDate: "$deliveredAt" }, { $toDate: "$promisedAt" }] }] }, 0, 1] } } } },
  );
  return db.collection(COLLECTIONS.businessEvents).aggregate<{ _id: string; due: number; late: number }>(pipeline).toArray();
}

/** Upserts validated snapshots by snapshotId; returns their IDs. */
export async function persistSnapshots(snapshots: MetricSnapshotT[], dbOverride?: Db): Promise<string[]> {
  if (snapshots.length === 0) return [];
  const db = dbOverride ?? (await getDb());
  const col = db.collection<MetricSnapshotT & { simulationRunId?: string }>(COLLECTIONS.metricSnapshots);
  await col.bulkWrite(snapshots.map((s) => ({
    replaceOne: { filter: { businessId: s.businessId, snapshotId: s.snapshotId }, replacement: s, upsert: true },
  })), { ordered: false });
  return snapshots.map((s) => s.snapshotId);
}

/** Tick hook: one hourly global snapshot per persisted tick window. */
export async function snapshotTickWindows(businessId: string, simulationRunId: string, windows: Array<{ startAt: string; endAt: string }>, virtualTime: string, db: Db): Promise<string[]> {
  if (windows.length === 0) return [];
  const startAt = windows.reduce((a, w) => (w.startAt < a ? w.startAt : a), windows[0].startAt);
  const endAt = windows.reduce((a, w) => (w.endAt > a ? w.endAt : a), windows[0].endAt);
  const snapshots = await computeSnapshots({ businessId, simulationRunId, startAt, endAt, bucket: "hour", dimension: {}, virtualTime }, db);
  // Tag with the run so a reset can delete them.
  const tagged = snapshots.map((s) => ({ ...s, simulationRunId }));
  const col = db.collection(COLLECTIONS.metricSnapshots);
  await col.bulkWrite(tagged.map((s) => ({ replaceOne: { filter: { businessId: s.businessId, snapshotId: s.snapshotId }, replacement: s, upsert: true } })), { ordered: false });
  return snapshots.map((s) => s.snapshotId);
}

export interface ProductBreakdownRow {
  productId: string; name: string; category: string; priceMinor: number; unitsSold: number; revenueMinor: number; orders: number;
  availableUnits: number; reservedUnits: number; active: boolean;
}

/** Product-level revenue (exact, from order lines) joined with current inventory. */
export async function productBreakdown(businessId: string, simulationRunId: string, startAt: string, endAt: string, dbOverride?: Db): Promise<ProductBreakdownRow[]> {
  const db = dbOverride ?? (await getDb());
  const [products, sales] = await Promise.all([
    db.collection<SimulatedProduct>(COLLECTIONS.simulatedProducts).find({ businessId, simulationRunId }, { projection: { _id: 0 } }).sort({ productId: 1 }).toArray(),
    db.collection<SimulatedOrder>(COLLECTIONS.simulatedOrders).aggregate<{ _id: string; unitsSold: number; revenueMinor: number; orders: number }>([
      { $match: { businessId, simulationRunId, placedAt: { $gte: startAt, $lt: endAt } } },
      { $unwind: "$lines" },
      { $group: { _id: "$lines.productId", unitsSold: { $sum: "$lines.quantity" }, revenueMinor: { $sum: "$lines.lineTotalMinor" }, orders: { $sum: 1 } } },
    ]).toArray(),
  ]);
  const byId = new Map(sales.map((s) => [s._id, s]));
  return products.map((p) => {
    const s = byId.get(p.productId);
    return { productId: p.productId, name: p.name, category: p.category, priceMinor: p.priceMinor, unitsSold: s?.unitsSold ?? 0,
      revenueMinor: s?.revenueMinor ?? 0, orders: s?.orders ?? 0, availableUnits: p.availableUnits, reservedUnits: p.reservedUnits, active: p.active };
  });
}

export interface CampaignBreakdownRow {
  campaignId: string; impressions: number; clicks: number; spendMinor: number; attributedOrders: number; attributedRevenueMinor: number;
  ctr: number | null; costPerAcquisitionMinor: number | null; roas: number | null; averageFrequency: number | null;
}

/** Per-campaign advertising arithmetic from deduplicated ad.metrics_observed windows. */
export async function campaignBreakdown(businessId: string, simulationRunId: string, startAt: string, endAt: string, dbOverride?: Db): Promise<CampaignBreakdownRow[]> {
  const db = dbOverride ?? (await getDb());
  const rows = await db.collection(COLLECTIONS.businessEvents).aggregate<{ _id: string; impressions: number; clicks: number; spendMinor: number; attributedOrders: number; attributedRevenueMinor: number; frequency: number; windows: number }>([
    { $match: { businessId, simulationRunId, type: "ad.metrics_observed", "payload.window.startAt": { $gte: startAt, $lt: endAt } } },
    { $sort: { receivedAt: 1 } },
    { $group: { _id: { campaignId: "$payload.campaignId", startAt: "$payload.window.startAt" }, doc: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$doc" } },
    { $group: { _id: "$payload.campaignId", impressions: { $sum: "$payload.impressions" }, clicks: { $sum: "$payload.clicks" }, spendMinor: { $sum: "$payload.spendMinor" },
      attributedOrders: { $sum: "$payload.attributedOrders" }, attributedRevenueMinor: { $sum: "$payload.attributedRevenueMinor" }, frequency: { $avg: "$payload.frequency" }, windows: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();
  return rows.map((r) => ({
    campaignId: r._id, impressions: r.impressions, clicks: r.clicks, spendMinor: r.spendMinor, attributedOrders: r.attributedOrders, attributedRevenueMinor: r.attributedRevenueMinor,
    ctr: ratio(r.clicks, r.impressions), costPerAcquisitionMinor: r.attributedOrders > 0 ? Math.round(r.spendMinor / r.attributedOrders) : null,
    roas: r.spendMinor > 0 ? Math.round((r.attributedRevenueMinor / r.spendMinor) * 100) / 100 : null,
    averageFrequency: r.windows > 0 ? Math.round(r.frequency * 100) / 100 : null,
  }));
}
