import { HOUR_MS, type GroupedRows } from "@/intelligence/signals/rows";
import type { CatalogueView } from "@/intelligence/types";

/** Flow fields summed per hour. Every value is derived from canonical events. */
export const FIELDS = [
  "sessions", "paidSessions", "orders", "paidOrders", "revenueMinor", "paidRevenueMinor",
  "checkoutFailures", "couponFailures", "stockoutFailures",
  "impressions", "clicks", "spendMinor", "attributedOrders", "attributedRevenueMinor", "frequencyWeighted",
  "reviews", "lowReviews", "ratingSum", "mentions", "mentionViews", "refundMinor",
  "shipmentsDue", "shipmentsLate", "shipmentsLost",
] as const;
export type Field = (typeof FIELDS)[number];

/** Dispatch backlog: an order still unshipped this long after it was placed. */
export const BACKLOG_HOURS = 36;

/**
 * Hourly observation series for one business + simulation run, indexed from `startAt`.
 * Hour index i covers [startAt + i h, startAt + (i+1) h); evaluation boundary k is the instant startAt + k h.
 */
export class SignalSeries {
  readonly hours: number;
  readonly startMs: number;
  private readonly data = new Map<string, Map<Field, Float64Array>>();
  private readonly prefix = new Map<string, Float64Array>();
  /** Gauges sampled at boundaries k = 0..hours. */
  readonly overdueOpen: Float64Array;
  readonly backlog: Float64Array;
  /** Stock level known at boundary k (NaN until the first observation). */
  readonly stock = new Map<string, Float64Array>();
  readonly campaigns = new Set<string>();
  readonly products = new Set<string>();
  readonly channels = new Set<string>();
  readonly categories = new Set<string>();

  constructor(readonly businessId: string, readonly simulationRunId: string, readonly startAt: string, readonly endAt: string, rows: GroupedRows, readonly catalogue: CatalogueView) {
    this.startMs = Date.parse(startAt);
    this.hours = Math.max(0, Math.round((Date.parse(endAt) - this.startMs) / HOUR_MS));
    this.overdueOpen = new Float64Array(this.hours + 1);
    this.backlog = new Float64Array(this.hours + 1);
    this.assemble(rows);
  }

  idx(iso: string): number {
    return Math.floor((Date.parse(iso) - this.startMs) / HOUR_MS);
  }
  time(k: number): string {
    return new Date(this.startMs + k * HOUR_MS).toISOString();
  }
  boundary(iso: string): number {
    return Math.round((Date.parse(iso) - this.startMs) / HOUR_MS);
  }

  private arr(segment: string, field: Field): Float64Array {
    let seg = this.data.get(segment);
    if (!seg) { seg = new Map(); this.data.set(segment, seg); }
    let a = seg.get(field);
    if (!a) { a = new Float64Array(this.hours); seg.set(field, a); }
    return a;
  }
  private add(segment: string, field: Field, iso: string, v: number): void {
    const i = this.idx(iso);
    if (i < 0 || i >= this.hours || v === 0) return;
    this.arr(segment, field)[i] += v;
  }

  private assemble(rows: GroupedRows): void {
    const cat = (productId: string) => this.catalogue.get(productId)?.category;
    for (const r of rows.sessions) {
      this.add("global", "sessions", r.h, r.n);
      this.add(`channel:${r.channel}`, "sessions", r.h, r.n);
      this.channels.add(r.channel);
      if (r.campaignId) {
        this.add("global", "paidSessions", r.h, r.n);
        this.add(`campaign:${r.campaignId}`, "sessions", r.h, r.n);
        this.campaigns.add(r.campaignId);
      }
    }
    for (const r of rows.orders) {
      this.add("global", "orders", r.h, r.n);
      this.add("global", "revenueMinor", r.h, r.revenueMinor);
      if (r.campaignId) {
        this.add("global", "paidOrders", r.h, r.n);
        this.add("global", "paidRevenueMinor", r.h, r.revenueMinor);
        this.add(`campaign:${r.campaignId}`, "orders", r.h, r.n);
        this.add(`campaign:${r.campaignId}`, "revenueMinor", r.h, r.revenueMinor);
        this.campaigns.add(r.campaignId);
      }
    }
    for (const r of rows.productOrders) {
      this.products.add(r.productId);
      this.add(`product:${r.productId}`, "orders", r.h, r.n);
      this.add(`product:${r.productId}`, "revenueMinor", r.h, r.revenueShareMinor);
      const c = cat(r.productId);
      if (c) { this.categories.add(c); this.add(`category:${c}`, "orders", r.h, r.n); this.add(`category:${c}`, "revenueMinor", r.h, r.revenueShareMinor); }
    }
    for (const r of rows.checkoutFailures) {
      this.add("global", "checkoutFailures", r.h, r.n);
      if (r.failureCode === "coupon_rejected") this.add("global", "couponFailures", r.h, r.n);
      if (r.failureCode === "out_of_stock") this.add("global", "stockoutFailures", r.h, r.n);
    }
    for (const r of rows.ads) {
      this.campaigns.add(r.campaignId);
      for (const seg of ["global", `campaign:${r.campaignId}`]) {
        this.add(seg, "impressions", r.h, r.impressions);
        this.add(seg, "clicks", r.h, r.clicks);
        this.add(seg, "spendMinor", r.h, r.spendMinor);
        this.add(seg, "attributedOrders", r.h, r.attributedOrders);
        this.add(seg, "attributedRevenueMinor", r.h, r.attributedRevenueMinor);
        this.add(seg, "frequencyWeighted", r.h, r.frequency * r.impressions);
      }
    }
    for (const r of rows.reviews) {
      this.products.add(r.productId);
      const segs = ["global", `product:${r.productId}`];
      const c = cat(r.productId);
      if (c) { this.categories.add(c); segs.push(`category:${c}`); }
      for (const seg of segs) {
        this.add(seg, "reviews", r.h, r.n);
        this.add(seg, "lowReviews", r.h, r.low);
        this.add(seg, "ratingSum", r.h, r.ratingSum);
      }
    }
    for (const r of rows.mentions) {
      this.add("global", "mentions", r.h, r.n);
      this.add("global", "mentionViews", r.h, r.views);
      if (r.productId) {
        this.products.add(r.productId);
        this.add(`product:${r.productId}`, "mentions", r.h, r.n);
        this.add(`product:${r.productId}`, "mentionViews", r.h, r.views);
      }
    }
    for (const r of rows.refunds) this.add("global", "refundMinor", r.h, r.refundMinor);

    // Inventory: forward-filled level known at each boundary.
    const byProduct = new Map<string, Array<{ k: number; v: number }>>();
    for (const r of rows.inventory) {
      const k = this.boundary(r.h);
      if (k < 0 || k > this.hours) continue;
      const list = byProduct.get(r.productId) ?? [];
      list.push({ k, v: r.availableUnits });
      byProduct.set(r.productId, list);
    }
    for (const [productId, list] of byProduct) {
      this.products.add(productId);
      list.sort((a, b) => a.k - b.k);
      const a = new Float64Array(this.hours + 1).fill(NaN);
      let j = 0; let current = NaN;
      for (let k = 0; k <= this.hours; k++) {
        while (j < list.length && list[j].k <= k) { current = list[j].v; j++; }
        a[k] = current;
      }
      this.stock.set(productId, a);
    }

    // Shipments: due-date cohorts per hour + overdue/backlog gauges via difference arrays.
    const overdueDiff = new Float64Array(this.hours + 2);
    const backlogDiff = new Float64Array(this.hours + 2);
    const ceilK = (iso: string) => Math.ceil((Date.parse(iso) - this.startMs) / HOUR_MS);
    const range = (diff: Float64Array, from: number, to: number) => {
      const a = Math.max(0, from); const b = Math.min(this.hours + 1, to);
      if (b <= a) return;
      diff[a] += 1; diff[b] -= 1;
    };
    for (const s of rows.shipments) {
      const closedAt = [s.deliveredAt, s.lostAt].filter((x): x is string => x !== null).sort()[0] ?? null;
      if (s.promisedAt) {
        const late = !(s.deliveredAt && Date.parse(s.deliveredAt) <= Date.parse(s.promisedAt));
        const segs = ["global", ...s.productIds.map((p) => `product:${p}`)];
        for (const seg of segs) {
          this.add(seg, "shipmentsDue", s.promisedAt, 1);
          if (late) this.add(seg, "shipmentsLate", s.promisedAt, 1);
          if (s.lostAt) this.add(seg, "shipmentsLost", s.promisedAt, 1);
        }
        // Overdue & open: promise strictly passed and not yet delivered/lost at boundary k.
        const from = Math.floor((Date.parse(s.promisedAt) - this.startMs) / HOUR_MS) + 1;
        range(overdueDiff, from, closedAt ? ceilK(closedAt) : this.hours + 1);
      }
      if (s.pendingAt) {
        const from = ceilK(new Date(Date.parse(s.pendingAt) + BACKLOG_HOURS * HOUR_MS).toISOString());
        const shippedOrClosed = [s.shippedAt, s.lostAt].filter((x): x is string => x !== null).sort()[0] ?? null;
        range(backlogDiff, from, shippedOrClosed ? ceilK(shippedOrClosed) : this.hours + 1);
      }
    }
    let o = 0; let b = 0;
    for (let k = 0; k <= this.hours; k++) {
      o += overdueDiff[k]; b += backlogDiff[k];
      this.overdueOpen[k] = o; this.backlog[k] = b;
    }
  }

  /** Σ field over hour indices [k0, k1) for a segment; 0 for unknown segments/fields. */
  sum(segment: string, field: Field, k0: number, k1: number): number {
    const a0 = Math.max(0, k0); const a1 = Math.min(this.hours, k1);
    if (a1 <= a0) return 0;
    const key = `${segment}|${field}`;
    let p = this.prefix.get(key);
    if (!p) {
      const a = this.data.get(segment)?.get(field);
      p = new Float64Array(this.hours + 1);
      if (a) for (let i = 0; i < this.hours; i++) p[i + 1] = p[i] + a[i];
      this.prefix.set(key, p);
    }
    return p[a1] - p[a0];
  }

  private readonly firstCache = new Map<string, number>();
  /** First boundary k such that hour k-1 had a non-zero value (i.e. data observed before k); -1 if never. */
  firstObserved(segment: string, field: Field): number {
    const key = `${segment}|${field}`;
    const hit = this.firstCache.get(key);
    if (hit !== undefined) return hit;
    const a = this.data.get(segment)?.get(field);
    let k = -1;
    if (a) for (let i = 0; i < a.length; i++) if (a[i] !== 0) { k = i; break; }
    this.firstCache.set(key, k);
    return k;
  }

  stockAt(productId: string, k: number): number {
    const a = this.stock.get(productId);
    if (!a || k < 0 || k > this.hours) return NaN;
    return a[k];
  }

  /** Earliest boundary at which this product's stock is known, or -1. */
  firstStockBoundary(productId: string): number {
    const a = this.stock.get(productId);
    if (!a) return -1;
    for (let k = 0; k < a.length; k++) if (!Number.isNaN(a[k])) return k;
    return -1;
  }

  segments(kind: "campaign" | "product" | "channel" | "category"): string[] {
    const set = kind === "campaign" ? this.campaigns : kind === "product" ? this.products : kind === "channel" ? this.channels : this.categories;
    return [...set].sort().map((id) => `${kind}:${id}`);
  }
}
