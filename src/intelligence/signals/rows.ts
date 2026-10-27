import type { BusinessEventT } from "@normal/contracts";

/**
 * Hour-grouped observations derived from the canonical `business_events` ledger only.
 *
 * Production builds these with one MongoDB aggregation (`signals/load.ts`). The evaluation harness builds the exact
 * same shape from an in-memory event list (`groupEvents` below) so detection quality can be measured across many
 * seeds without writing every run to Atlas. `tests/intelligence/series-equivalence.test.ts` proves both agree.
 *
 * Hour keys are ISO strings of the hour start (UTC). Flow events use the floor of `occurredAt`; ad observations use
 * `window.startAt`; inventory levels use the CEILING of `occurredAt` so a level published at the end of an hour is
 * visible at that hour boundary; shipments are kept per order and turned into due-date cohorts later.
 */
export interface GroupedRows {
  sessions: Array<{ h: string; channel: string; campaignId: string | null; n: number }>;
  orders: Array<{ h: string; campaignId: string | null; n: number; revenueMinor: number }>;
  productOrders: Array<{ h: string; productId: string; n: number; revenueShareMinor: number }>;
  checkoutFailures: Array<{ h: string; failureCode: string; n: number }>;
  ads: Array<{ h: string; campaignId: string; impressions: number; clicks: number; spendMinor: number; attributedOrders: number; attributedRevenueMinor: number; frequency: number }>;
  reviews: Array<{ h: string; productId: string; n: number; low: number; ratingSum: number }>;
  mentions: Array<{ h: string; productId: string | null; n: number; views: number }>;
  refunds: Array<{ h: string; n: number; refundMinor: number }>;
  inventory: Array<{ h: string; productId: string; availableUnits: number }>;
  shipments: Array<ShipmentRow>;
}

export interface ShipmentRow {
  orderId: string;
  pendingAt: string | null;
  shippedAt: string | null;
  promisedAt: string | null;
  deliveredAt: string | null;
  lostAt: string | null;
  productIds: string[];
}

export const HOUR_MS = 3_600_000;
/** Shipment rows look back this far before the analysis range so open parcels are known at its start. */
export const SHIPMENT_LOOKBACK_MS = 10 * 24 * HOUR_MS;

export function floorHour(iso: string): string {
  const t = Date.parse(iso);
  return new Date(Math.floor(t / HOUR_MS) * HOUR_MS).toISOString();
}
export function ceilHour(iso: string): string {
  const t = Date.parse(iso);
  return new Date(Math.ceil(t / HOUR_MS) * HOUR_MS).toISOString();
}

export interface DeliveryObservation {
  status: string;
  at: string;
  promisedAt: string | null;
}

/** Reduces one order's delivery events to its fulfilment milestones (earliest of each status). Shared by both producers. */
export function reduceShipment(orderId: string, deliveries: readonly DeliveryObservation[], productIds: readonly string[]): ShipmentRow {
  const r: ShipmentRow = { orderId, pendingAt: null, shippedAt: null, promisedAt: null, deliveredAt: null, lostAt: null, productIds: [...productIds] };
  const earlier = (a: string | null, b: string) => a === null || Date.parse(b) < Date.parse(a);
  for (const d of deliveries) {
    if (d.status === "pending" && earlier(r.pendingAt, d.at)) r.pendingAt = d.at;
    if (d.status === "shipped" && earlier(r.shippedAt, d.at)) { r.shippedAt = d.at; r.promisedAt = d.promisedAt; }
    if (d.status === "delivered" && earlier(r.deliveredAt, d.at)) r.deliveredAt = d.at;
    if (d.status === "lost" && earlier(r.lostAt, d.at)) r.lostAt = d.at;
  }
  return r;
}

type Ev<T extends BusinessEventT["type"]> = Extract<BusinessEventT, { type: T }>;

/**
 * Pure grouping used by the evaluation harness. Semantics mirror `signals/load.ts` exactly.
 * `range.endAt` is the analysis watermark: flow events must be strictly before it, inventory levels at or before it.
 */
export function groupEvents(events: readonly BusinessEventT[], range: { startAt: string; endAt: string }): GroupedRows {
  const startMs = Date.parse(range.startAt);
  const endMs = Date.parse(range.endAt);
  const inFlow = (iso: string) => { const t = Date.parse(iso); return t >= startMs && t < endMs; };

  const sessions = new Map<string, GroupedRows["sessions"][number]>();
  const orders = new Map<string, GroupedRows["orders"][number]>();
  const productOrders = new Map<string, GroupedRows["productOrders"][number]>();
  const failures = new Map<string, GroupedRows["checkoutFailures"][number]>();
  const reviews = new Map<string, GroupedRows["reviews"][number]>();
  const mentions = new Map<string, GroupedRows["mentions"][number]>();
  const refunds = new Map<string, GroupedRows["refunds"][number]>();
  const adsFirst = new Map<string, Ev<"ad.metrics_observed">>();
  const inventoryLast = new Map<string, Ev<"inventory.level_changed">>();
  const deliveries = new Map<string, DeliveryObservation[]>();
  const orderProducts = new Map<string, string[]>();

  for (const e of events) {
    switch (e.type) {
      case "web.session_started": {
        if (!inFlow(e.occurredAt)) break;
        const h = floorHour(e.occurredAt); const campaignId = e.payload.campaignId ?? null;
        const k = `${h}|${e.payload.channel}|${campaignId}`;
        const r = sessions.get(k) ?? { h, channel: e.payload.channel, campaignId, n: 0 };
        r.n++; sessions.set(k, r);
        break;
      }
      case "order.completed": {
        const t = Date.parse(e.occurredAt);
        if (t < endMs && t >= startMs - SHIPMENT_LOOKBACK_MS) orderProducts.set(e.payload.orderId, e.payload.productIds);
        if (!inFlow(e.occurredAt)) break;
        const h = floorHour(e.occurredAt); const campaignId = e.payload.campaignId ?? null;
        const k = `${h}|${campaignId}`;
        const r = orders.get(k) ?? { h, campaignId, n: 0, revenueMinor: 0 };
        r.n++; r.revenueMinor += e.payload.netRevenueMinor; orders.set(k, r);
        const share = Math.floor(e.payload.netRevenueMinor / e.payload.productIds.length);
        for (const productId of e.payload.productIds) {
          const pk = `${h}|${productId}`;
          const pr = productOrders.get(pk) ?? { h, productId, n: 0, revenueShareMinor: 0 };
          pr.n++; pr.revenueShareMinor += share; productOrders.set(pk, pr);
        }
        break;
      }
      case "checkout.failed": {
        if (!inFlow(e.occurredAt)) break;
        const h = floorHour(e.occurredAt); const k = `${h}|${e.payload.failureCode}`;
        const r = failures.get(k) ?? { h, failureCode: e.payload.failureCode, n: 0 };
        r.n++; failures.set(k, r);
        break;
      }
      case "ad.metrics_observed": {
        const s = Date.parse(e.payload.window.startAt);
        if (s < startMs || s >= endMs) break;
        const k = `${e.payload.campaignId}|${e.payload.window.startAt}`;
        const prev = adsFirst.get(k);
        if (!prev || Date.parse(e.receivedAt) < Date.parse(prev.receivedAt)) adsFirst.set(k, e);
        break;
      }
      case "review.created": {
        if (!inFlow(e.occurredAt)) break;
        const h = floorHour(e.occurredAt); const k = `${h}|${e.payload.productId}`;
        const r = reviews.get(k) ?? { h, productId: e.payload.productId, n: 0, low: 0, ratingSum: 0 };
        r.n++; r.ratingSum += e.payload.rating; if (e.payload.rating <= 2) r.low++; reviews.set(k, r);
        break;
      }
      case "social.mention_observed": {
        if (!inFlow(e.occurredAt)) break;
        const h = floorHour(e.occurredAt); const productId = e.payload.productId ?? null; const k = `${h}|${productId}`;
        const r = mentions.get(k) ?? { h, productId, n: 0, views: 0 };
        r.n++; r.views += e.payload.views ?? 0; mentions.set(k, r);
        break;
      }
      case "order.refunded": {
        if (!inFlow(e.occurredAt)) break;
        const h = floorHour(e.occurredAt);
        const r = refunds.get(h) ?? { h, n: 0, refundMinor: 0 };
        r.n++; r.refundMinor += e.payload.refundMinor; refunds.set(h, r);
        break;
      }
      case "inventory.level_changed": {
        const t = Date.parse(e.occurredAt);
        if (t < startMs || t > endMs) break;
        const k = `${ceilHour(e.occurredAt)}|${e.payload.productId}`;
        const prev = inventoryLast.get(k);
        if (!prev || e.occurredAt > prev.occurredAt || (e.occurredAt === prev.occurredAt && e.eventId > prev.eventId)) inventoryLast.set(k, e);
        break;
      }
      case "delivery.status_changed": {
        const t = Date.parse(e.occurredAt);
        if (t >= endMs || t < startMs - SHIPMENT_LOOKBACK_MS) break;
        const list = deliveries.get(e.payload.orderId) ?? [];
        list.push({ status: e.payload.status, at: e.occurredAt, promisedAt: e.payload.promisedAt ?? null });
        deliveries.set(e.payload.orderId, list);
        break;
      }
      default:
        break;
    }
  }

  return {
    sessions: [...sessions.values()], orders: [...orders.values()], productOrders: [...productOrders.values()],
    checkoutFailures: [...failures.values()],
    ads: [...adsFirst.values()].map((e) => ({
      h: floorHour(e.payload.window.startAt), campaignId: e.payload.campaignId, impressions: e.payload.impressions, clicks: e.payload.clicks,
      spendMinor: e.payload.spendMinor, attributedOrders: e.payload.attributedOrders, attributedRevenueMinor: e.payload.attributedRevenueMinor, frequency: e.payload.frequency,
    })),
    reviews: [...reviews.values()], mentions: [...mentions.values()], refunds: [...refunds.values()],
    inventory: [...inventoryLast.values()].map((e) => ({ h: ceilHour(e.occurredAt), productId: e.payload.productId, availableUnits: e.payload.availableUnits })),
    shipments: [...deliveries.entries()].map(([orderId, list]) => reduceShipment(orderId, list, orderProducts.get(orderId) ?? [])),
  };
}
