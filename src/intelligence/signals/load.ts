import "server-only";

import type { Db, Document } from "mongodb";
import { COLLECTIONS } from "@/lib/collections";
import { HOUR_MS, SHIPMENT_LOOKBACK_MS, reduceShipment, type DeliveryObservation, type GroupedRows } from "@/intelligence/signals/rows";

export interface ObservationHorizon {
  /** First hour with ad observations for the run (start of observable history). */
  historyStart: string;
  /** Latest fully observed hour boundary (end of the newest ad observation window). */
  watermark: string;
}

/**
 * Derives the observable time horizon of a run from the canonical ledger alone: every completed simulator hour (and
 * any real connector's hourly ad sync) publishes one `ad.metrics_observed` per campaign whose window ends on the hour.
 * No simulator state is read.
 */
export async function loadHorizon(db: Db, businessId: string, simulationRunId: string): Promise<ObservationHorizon | null> {
  const events = db.collection(COLLECTIONS.businessEvents);
  const filter = { businessId, simulationRunId, type: "ad.metrics_observed" };
  const [last, first, committed] = await Promise.all([
    events.find(filter, { projection: { _id: 0, "payload.window": 1 } }).sort({ occurredAt: -1 }).limit(1).next(),
    events.find(filter, { projection: { _id: 0, "payload.window": 1 } }).sort({ occurredAt: 1 }).limit(1).next(),
    db.collection(COLLECTIONS.monitoringWindows).find({ businessId, simulationRunId, status: "ready" }, { projection: { windowEnd: 1 } }).sort({ windowEnd: -1 }).limit(1).next(),
  ]);
  if (!last || !first || !committed) return null;
  const w = (d: Document) => (d.payload as { window: { startAt: string; endAt: string } }).window;
  const floor = (iso: string) => new Date(Math.floor(Date.parse(iso) / HOUR_MS) * HOUR_MS).toISOString();
  return { historyStart: new Date(Math.ceil(Date.parse(w(first).startAt) / HOUR_MS) * HOUR_MS).toISOString(),
    watermark: floor(w(last).endAt < committed.windowEnd ? w(last).endAt : committed.windowEnd) };
}

const HOUR = (field: string): Document => ({ $dateToString: { date: { $dateTrunc: { date: { $toDate: field }, unit: "hour" } }, format: "%Y-%m-%dT%H:%M:%S.000Z" } });
const CEIL_HOUR = (field: string): Document => ({
  $dateToString: {
    date: { $dateAdd: { startDate: { $dateTrunc: { date: { $dateSubtract: { startDate: { $toDate: field }, unit: "millisecond", amount: 1 } }, unit: "hour" } }, unit: "hour", amount: 1 } },
    format: "%Y-%m-%dT%H:%M:%S.000Z",
  },
});

/**
 * One bounded aggregation over `business_events` for [startAt, endAt] that returns hour-grouped rows. Raw events are
 * never loaded into memory: grouping happens server-side; only delivery milestones are returned per order.
 */
export async function loadGroupedRows(db: Db, businessId: string, simulationRunId: string, startAt: string, endAt: string): Promise<GroupedRows> {
  const lookbackStart = new Date(Date.parse(startAt) - SHIPMENT_LOOKBACK_MS).toISOString();
  const flow = { occurredAt: { $gte: startAt, $lt: endAt } };
  const [facet] = await db.collection(COLLECTIONS.businessEvents).aggregate<Record<string, Document[]>>([
    { $match: { businessId, simulationRunId, occurredAt: { $gte: lookbackStart, $lte: endAt }, type: { $in: [
      "web.session_started", "order.completed", "checkout.failed", "ad.metrics_observed", "review.created",
      "social.mention_observed", "order.refunded", "inventory.level_changed", "delivery.status_changed",
    ] } } },
    { $facet: {
      sessions: [
        { $match: { type: "web.session_started", ...flow } },
        { $group: { _id: { h: HOUR("$occurredAt"), channel: "$payload.channel", campaignId: { $ifNull: ["$payload.campaignId", null] } }, n: { $sum: 1 } } },
      ],
      orders: [
        { $match: { type: "order.completed", ...flow } },
        { $group: { _id: { h: HOUR("$occurredAt"), campaignId: { $ifNull: ["$payload.campaignId", null] } }, n: { $sum: 1 }, revenueMinor: { $sum: "$payload.netRevenueMinor" } } },
      ],
      productOrders: [
        { $match: { type: "order.completed", ...flow } },
        { $project: { h: HOUR("$occurredAt"), productIds: "$payload.productIds", share: { $floor: { $divide: ["$payload.netRevenueMinor", { $size: "$payload.productIds" }] } } } },
        { $unwind: "$productIds" },
        { $group: { _id: { h: "$h", productId: "$productIds" }, n: { $sum: 1 }, revenueShareMinor: { $sum: "$share" } } },
      ],
      checkoutFailures: [
        { $match: { type: "checkout.failed", ...flow } },
        { $group: { _id: { h: HOUR("$occurredAt"), failureCode: "$payload.failureCode" }, n: { $sum: 1 } } },
      ],
      ads: [
        { $match: { type: "ad.metrics_observed", "payload.window.startAt": { $gte: startAt, $lt: endAt } } },
        { $sort: { receivedAt: 1 } },
        { $group: { _id: { campaignId: "$payload.campaignId", startAt: "$payload.window.startAt" }, doc: { $first: "$payload" } } },
        { $project: { _id: 0, h: HOUR("$_id.startAt"), campaignId: "$_id.campaignId", impressions: "$doc.impressions", clicks: "$doc.clicks", spendMinor: "$doc.spendMinor",
          attributedOrders: "$doc.attributedOrders", attributedRevenueMinor: "$doc.attributedRevenueMinor", frequency: "$doc.frequency" } },
      ],
      reviews: [
        { $match: { type: "review.created", ...flow } },
        { $group: { _id: { h: HOUR("$occurredAt"), productId: "$payload.productId" }, n: { $sum: 1 },
          low: { $sum: { $cond: [{ $lte: ["$payload.rating", 2] }, 1, 0] } }, ratingSum: { $sum: "$payload.rating" } } },
      ],
      mentions: [
        { $match: { type: "social.mention_observed", ...flow } },
        { $group: { _id: { h: HOUR("$occurredAt"), productId: { $ifNull: ["$payload.productId", null] } }, n: { $sum: 1 }, views: { $sum: { $ifNull: ["$payload.views", 0] } } } },
      ],
      refunds: [
        { $match: { type: "order.refunded", ...flow } },
        { $group: { _id: { h: HOUR("$occurredAt") }, n: { $sum: 1 }, refundMinor: { $sum: "$payload.refundMinor" } } },
      ],
      inventory: [
        { $match: { type: "inventory.level_changed", occurredAt: { $gte: startAt, $lte: endAt } } },
        { $sort: { occurredAt: 1, eventId: 1 } },
        { $group: { _id: { h: CEIL_HOUR("$occurredAt"), productId: "$payload.productId" }, availableUnits: { $last: "$payload.availableUnits" } } },
      ],
      deliveries: [
        { $match: { type: "delivery.status_changed", occurredAt: { $gte: lookbackStart, $lt: endAt } } },
        { $group: { _id: "$payload.orderId", list: { $push: { status: "$payload.status", at: "$occurredAt", promisedAt: { $ifNull: ["$payload.promisedAt", null] } } } } },
      ],
      orderProducts: [
        { $match: { type: "order.completed", occurredAt: { $gte: lookbackStart, $lt: endAt } } },
        { $project: { _id: 0, orderId: "$payload.orderId", productIds: "$payload.productIds" } },
      ],
    } },
  ], { allowDiskUse: true }).toArray();

  const flat = <T>(rows: Document[] | undefined, map: (r: Document) => T): T[] => (rows ?? []).map(map);
  const products = new Map<string, string[]>(flat(facet.orderProducts, (r) => [r.orderId as string, r.productIds as string[]] as [string, string[]]));
  return {
    sessions: flat(facet.sessions, (r) => ({ h: r._id.h, channel: r._id.channel, campaignId: r._id.campaignId, n: r.n })),
    orders: flat(facet.orders, (r) => ({ h: r._id.h, campaignId: r._id.campaignId, n: r.n, revenueMinor: r.revenueMinor })),
    productOrders: flat(facet.productOrders, (r) => ({ h: r._id.h, productId: r._id.productId, n: r.n, revenueShareMinor: r.revenueShareMinor })),
    checkoutFailures: flat(facet.checkoutFailures, (r) => ({ h: r._id.h, failureCode: r._id.failureCode, n: r.n })),
    ads: flat(facet.ads, (r) => ({ h: r.h, campaignId: r.campaignId, impressions: r.impressions, clicks: r.clicks, spendMinor: r.spendMinor,
      attributedOrders: r.attributedOrders, attributedRevenueMinor: r.attributedRevenueMinor, frequency: r.frequency })),
    reviews: flat(facet.reviews, (r) => ({ h: r._id.h, productId: r._id.productId, n: r.n, low: r.low, ratingSum: r.ratingSum })),
    mentions: flat(facet.mentions, (r) => ({ h: r._id.h, productId: r._id.productId, n: r.n, views: r.views })),
    refunds: flat(facet.refunds, (r) => ({ h: r._id.h, n: r.n, refundMinor: r.refundMinor })),
    inventory: flat(facet.inventory, (r) => ({ h: r._id.h, productId: r._id.productId, availableUnits: r.availableUnits })),
    shipments: flat(facet.deliveries, (r) => reduceShipment(r._id as string, r.list as DeliveryObservation[], products.get(r._id as string) ?? [])),
  };
}
