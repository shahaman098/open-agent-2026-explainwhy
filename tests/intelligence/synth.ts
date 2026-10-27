import type { GroupedRows, ShipmentRow } from "@/intelligence/signals/rows";
import { SignalSeries } from "@/intelligence/signals/series";
import type { CatalogueLabel } from "@/intelligence/types";

/** Deterministic synthetic observation builder for unit tests (no simulator involved). */
export const T0 = "2026-10-01T00:00:00.000Z";
const H = 3_600_000;
export const at = (h: number) => new Date(Date.parse(T0) + h * H).toISOString();

export interface HourSpec {
  sessions?: Record<string, number>; // channel -> sessions
  campaignSessions?: Record<string, number>;
  orders?: number;
  revenuePerOrder?: number;
  campaignOrders?: Record<string, number>;
  productOrders?: Record<string, number>;
  failures?: Record<string, number>;
  ads?: Record<string, { impressions: number; clicks: number; spendMinor: number; attributedOrders?: number; attributedRevenueMinor?: number; frequency?: number }>;
  reviews?: Record<string, { n: number; low: number; ratingSum: number }>;
  mentions?: Record<string, number>;
  stock?: Record<string, number>;
}

/** Small deterministic jitter in [-amp, amp] so series are not perfectly flat. */
export function jitter(h: number, salt: number, amp: number): number {
  const x = Math.sin(h * 12.9898 + salt * 78.233) * 43758.5453;
  return Math.round((x - Math.floor(x) - 0.5) * 2 * amp);
}

export function buildRows(hours: number, spec: (h: number) => HourSpec, shipments: ShipmentRow[] = []): GroupedRows {
  const rows: GroupedRows = { sessions: [], orders: [], productOrders: [], checkoutFailures: [], ads: [], reviews: [], mentions: [], refunds: [], inventory: [], shipments };
  for (let h = 0; h < hours; h++) {
    const s = spec(h); const hk = at(h);
    for (const [channel, n] of Object.entries(s.sessions ?? {})) if (n > 0) rows.sessions.push({ h: hk, channel, campaignId: null, n });
    for (const [campaignId, n] of Object.entries(s.campaignSessions ?? {})) if (n > 0) rows.sessions.push({ h: hk, channel: "paid_social", campaignId, n });
    const rpo = s.revenuePerOrder ?? 10_000;
    if ((s.orders ?? 0) > 0) rows.orders.push({ h: hk, campaignId: null, n: s.orders!, revenueMinor: s.orders! * rpo });
    for (const [campaignId, n] of Object.entries(s.campaignOrders ?? {})) if (n > 0) rows.orders.push({ h: hk, campaignId, n, revenueMinor: n * rpo });
    for (const [productId, n] of Object.entries(s.productOrders ?? {})) if (n > 0) rows.productOrders.push({ h: hk, productId, n, revenueShareMinor: n * rpo });
    for (const [failureCode, n] of Object.entries(s.failures ?? {})) if (n > 0) rows.checkoutFailures.push({ h: hk, failureCode, n });
    for (const [campaignId, a] of Object.entries(s.ads ?? {})) rows.ads.push({ h: hk, campaignId, impressions: a.impressions, clicks: a.clicks, spendMinor: a.spendMinor,
      attributedOrders: a.attributedOrders ?? 0, attributedRevenueMinor: a.attributedRevenueMinor ?? 0, frequency: a.frequency ?? 2 });
    for (const [productId, r] of Object.entries(s.reviews ?? {})) if (r.n > 0) rows.reviews.push({ h: hk, productId, ...r });
    for (const [productId, n] of Object.entries(s.mentions ?? {})) if (n > 0) rows.mentions.push({ h: hk, productId, n, views: n * 1000 });
    for (const [productId, v] of Object.entries(s.stock ?? {})) rows.inventory.push({ h: at(h + 1), productId, availableUnits: v });
  }
  return rows;
}

export const CATALOGUE = new Map<string, CatalogueLabel>([
  ["p_a", { name: "Product A", category: "running" }], ["p_b", { name: "Product B", category: "running" }], ["p_c", { name: "Product C", category: "apparel" }],
]);

export function seriesFrom(hours: number, spec: (h: number) => HourSpec, shipments: ShipmentRow[] = []): SignalSeries {
  return new SignalSeries("biz_test", "run_test", T0, at(hours), buildRows(hours, spec, shipments), CATALOGUE);
}
