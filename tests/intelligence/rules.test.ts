import { describe, expect, it } from "vitest";
import { detect } from "@/intelligence/detection/engine";
import { ADVERTISING_SIGNALS } from "@/intelligence/detection/rules/advertising";
import { CHECKOUT_SIGNALS } from "@/intelligence/detection/rules/checkout";
import { DEMAND_SIGNALS } from "@/intelligence/detection/rules/demand";
import { INVENTORY_SIGNALS } from "@/intelligence/detection/rules/inventory";
import { REPUTATION_SIGNALS } from "@/intelligence/detection/rules/reputation";
import { REVENUE_SIGNALS } from "@/intelligence/detection/rules/revenue";
import { SHIPPING_SIGNALS } from "@/intelligence/detection/rules/shipping";
import { ALL_SIGNALS } from "@/intelligence/detection/rules";
import type { ShipmentRow } from "@/intelligence/signals/rows";
import { at, jitter, seriesFrom, type HourSpec } from "./synth";

const DAY = 24;
/** A healthy synthetic shop: ~1,000 sessions/day, ~40 orders/day, two campaigns, three products. */
function healthy(h: number): HourSpec {
  return {
    sessions: { direct: 25 + jitter(h, 1, 3), organic_search: 12 + jitter(h, 2, 2), social: 4 + jitter(h, 3, 1) },
    campaignSessions: { cmp_a: 8 + jitter(h, 4, 1), cmp_b: 8 + jitter(h, 5, 1) },
    orders: 1 + (h % 3 === 0 ? 1 : 0), campaignOrders: { cmp_a: h % 4 === 0 ? 1 : 0, cmp_b: h % 4 === 2 ? 1 : 0 },
    productOrders: { p_a: h % 6 === 0 ? 1 : 0, p_b: h % 8 === 0 ? 1 : 0, p_c: h % 5 === 0 ? 1 : 0 },
    ads: {
      cmp_a: { impressions: 1_000 + jitter(h, 6, 40), clicks: 20 + jitter(h, 7, 2), spendMinor: 500, attributedOrders: h % 4 === 0 ? 1 : 0, attributedRevenueMinor: h % 4 === 0 ? 10_000 : 0, frequency: 2 },
      cmp_b: { impressions: 1_000 + jitter(h, 8, 40), clicks: 20 + jitter(h, 9, 2), spendMinor: 500, attributedOrders: h % 4 === 2 ? 1 : 0, attributedRevenueMinor: h % 4 === 2 ? 10_000 : 0, frequency: 2 },
    },
  };
}
const detectWith = (signals: typeof ALL_SIGNALS, hours: number, spec: (h: number) => HourSpec, shipments: ShipmentRow[] = []) =>
  detect(seriesFrom(hours, spec, shipments), { signals });
const ids = (r: ReturnType<typeof detect>) => r.findings.map((f) => `${f.signalId}@${f.segment}:${f.direction}`);

describe("Detector 1 — revenue and sales", () => {
  it("detects a revenue/order decline and a surge with the right polarity; ignores noise", () => {
    const decline = detectWith(REVENUE_SIGNALS, 7 * DAY, (h) => ({ ...healthy(h), orders: h >= 5 * DAY ? (h % 4 === 0 ? 1 : 0) : healthy(h).orders }));
    expect(ids(decline)).toEqual(expect.arrayContaining(["revenue@global:decrease", "orders@global:decrease"]));
    expect(decline.findings.every((f) => f.polarity === "negative")).toBe(true);
    const surge = detectWith(REVENUE_SIGNALS, 7 * DAY, (h) => ({ ...healthy(h), orders: h >= 5 * DAY ? 5 : healthy(h).orders }));
    expect(ids(surge)).toEqual(expect.arrayContaining(["revenue@global:increase", "orders@global:increase"]));
    expect(surge.findings.find((f) => f.signalId === "revenue")!.polarity).toBe("positive");
    expect(detectWith(REVENUE_SIGNALS, 7 * DAY, healthy).findings).toEqual([]);
  });

  it("respects the relative threshold boundary: a 15% dip is not an anomaly", () => {
    const dip = detectWith(REVENUE_SIGNALS, 7 * DAY, (h) => ({ ...healthy(h), revenuePerOrder: h >= 5 * DAY ? 8_500 : 10_000 }));
    expect(dip.findings.filter((f) => f.signalId === "revenue")).toEqual([]);
  });
});

describe("Detector 2 — advertising efficiency", () => {
  const fatigued = (h: number): HourSpec => {
    const b = healthy(h);
    if (h < 5 * DAY) return b;
    return { ...b, campaignSessions: { ...b.campaignSessions, cmp_a: 2 }, campaignOrders: { ...b.campaignOrders, cmp_a: 0 },
      ads: { ...b.ads, cmp_a: { ...b.ads!.cmp_a, clicks: 5, frequency: 5, attributedOrders: 0, attributedRevenueMinor: 0 } } };
  };
  it("detects CTR decline, rising frequency and falling paid sessions on the affected campaign only", () => {
    const r = detectWith(ADVERTISING_SIGNALS, 7 * DAY, fatigued);
    const found = ids(r);
    expect(found).toEqual(expect.arrayContaining(["ctr@campaign:cmp_a:decrease", "frequency@campaign:cmp_a:increase", "campaign_sessions@campaign:cmp_a:decrease"]));
    expect(found.filter((x) => x.includes("cmp_b"))).toEqual([]);
    expect(r.findings.find((f) => f.signalId === "ctr" && f.segment === "campaign:cmp_a")!.canonicalMetric).toBe("ctr");
  });

  it("does not judge CTR on negligible impression volume", () => {
    const tiny = (h: number): HourSpec => ({ ...healthy(h), ads: { cmp_t: { impressions: 40, clicks: h >= 5 * DAY ? 0 : 2, spendMinor: 50 } } });
    const r = detectWith(ADVERTISING_SIGNALS, 7 * DAY, tiny);
    expect(r.findings.filter((f) => f.segment === "campaign:cmp_t")).toEqual([]);
    expect(r.skipped.some((s) => s.signalId === "ctr" && /denominator/.test(s.reason))).toBe(true);
  });

  it("handles a business with no advertising data safely", () => {
    const r = detectWith(ADVERTISING_SIGNALS, 7 * DAY, (h) => ({ sessions: healthy(h).sessions, orders: 1 }));
    expect(r.findings).toEqual([]);
    expect(r.skipped.length).toBeGreaterThan(0);
  });
});

describe("Detector 3 — checkout and conversion", () => {
  it("detects a promo-code checkout failure surge from canonical checkout.failed events", () => {
    const r = detectWith(CHECKOUT_SIGNALS, 7 * DAY, (h) => ({ ...healthy(h), failures: { coupon_rejected: h >= 5 * DAY && h % 2 === 0 ? 1 : 0 } }));
    expect(ids(r)).toEqual(expect.arrayContaining(["checkout_failure_rate@global:increase", "coupon_failure_rate@global:increase"]));
  });

  it("is denominator-aware: 1→2 failures in ~10 attempts is not an incident", () => {
    const lowVolume = (h: number): HourSpec => ({ sessions: { direct: 30 }, orders: h % 2 === 0 ? 1 : 0, failures: { other: h >= 5 * DAY ? (h % 6 === 0 ? 1 : 0) : (h % 12 === 0 ? 1 : 0) } });
    const r = detectWith(CHECKOUT_SIGNALS, 7 * DAY, lowVolume);
    expect(r.findings.filter((f) => f.signalId === "checkout_failure_rate")).toEqual([]);
  });

  it("detects conversion deterioration when traffic is stable but purchases fall", () => {
    const r = detectWith(CHECKOUT_SIGNALS, 7 * DAY, (h) => ({ ...healthy(h), orders: h >= 5 * DAY ? (h % 3 === 0 ? 1 : 0) : healthy(h).orders }));
    expect(ids(r)).toContain("conversion_rate@global:decrease");
  });
});

describe("Detector 4 — shipping (due-date cohorts and observation lag)", () => {
  /** 2 shipments per hour, promised 48h after shipping; `lateFrom` makes every other one late from that hour. */
  function shipments(hours: number, lateFrom: number | null, openLate = false): ShipmentRow[] {
    const out: ShipmentRow[] = [];
    for (let h = 0; h < hours; h++) for (let i = 0; i < 2; i++) {
      const shipped = at(h); const promised = at(h + 48);
      const late = (lateFrom !== null && h + 48 >= lateFrom && i === 0) || (h % 25 === 0 && i === 1);
      const deliveredAt = late ? (openLate ? null : at(h + 60)) : at(h + 40);
      out.push({ orderId: `o_${h}_${i}`, pendingAt: at(h - 10), shippedAt: shipped, promisedAt: promised, deliveredAt, lostAt: null, productIds: ["p_a"] });
    }
    return out;
  }
  it("detects a late-delivery surge and the overdue leading indicator", () => {
    const r = detectWith(SHIPPING_SIGNALS, 9 * DAY, healthy, shipments(9 * DAY, 6 * DAY));
    expect(ids(r)).toEqual(expect.arrayContaining(["late_delivery_rate@global:increase"]));
  });

  it("counts overdue-but-unreported parcels as late before any delivery event arrives", () => {
    const r = detectWith(SHIPPING_SIGNALS, 9 * DAY, healthy, shipments(9 * DAY, 6 * DAY, true));
    expect(ids(r)).toEqual(expect.arrayContaining(["late_delivery_rate@global:increase", "overdue_shipments@global:increase"]));
  });

  it("stays quiet for healthy fulfilment and never counts immature shipments", () => {
    const r = detectWith(SHIPPING_SIGNALS, 9 * DAY, healthy, shipments(9 * DAY, null));
    expect(r.findings).toEqual([]);
    const s = seriesFrom(9 * DAY, healthy, shipments(9 * DAY, null));
    const dueTotal = s.sum("global", "shipmentsDue", 0, s.hours);
    expect(dueTotal).toBe(2 * (9 * DAY - 48));
  });
});

describe("Detector 5 — inventory availability", () => {
  it("projects a stockout from accelerating depletion and flags the stockout itself; ignores low stock without demand", () => {
    let stockA = 300;
    const spec = (h: number): HourSpec => {
      const surge = h >= 6 * DAY;
      // 3 units/day before the surge, 5 units/hour after it; sales never exceed available stock.
      const sold = Math.min(stockA, surge ? 5 : (h % 8 === 0 ? 1 : 0));
      stockA -= sold;
      return { ...healthy(h), productOrders: { p_a: sold, p_c: 0 }, stock: { p_a: stockA, p_c: 4 } };
    };
    const r = detectWith(INVENTORY_SIGNALS, 6 * DAY + 30, spec);
    const found = ids(r);
    expect(found).toEqual(expect.arrayContaining(["depletion_acceleration@product:p_a:increase", "projected_stockout@product:p_a:decrease"]));
    expect(found.filter((x) => x.includes("p_c"))).toEqual([]);
    const projected = r.findings.find((f) => f.signalId === "projected_stockout")!;
    expect(projected.primary.latest.details?.assumption).toMatch(/no replenishment/);
    expect(Array.isArray(projected.primary.latest.details?.coverRangeHours)).toBe(true);

    stockA = 300;
    const later = detectWith(INVENTORY_SIGNALS, 10 * DAY, spec);
    expect(ids(later)).toContain("product_stockout@product:p_a:decrease");
  });
});

describe("Detector 6 — customer reputation", () => {
  it("detects a product's low-rating surge against the catalogue's pooled history; global stays quiet", () => {
    const spec = (h: number): HourSpec => {
      const reviews: HourSpec["reviews"] = {};
      if (h % 6 === 0) reviews.p_b = { n: 1, low: h % 120 === 0 ? 1 : 0, ratingSum: h % 120 === 0 ? 2 : 5 };
      if (h % 8 === 0) reviews.p_c = { n: 1, low: 0, ratingSum: 4 };
      if (h >= 7 * DAY && h % 10 === 0) reviews.p_a = { n: 1, low: 1, ratingSum: 1 };
      return { ...healthy(h), reviews };
    };
    const r = detectWith(REPUTATION_SIGNALS, 10 * DAY, spec);
    expect(ids(r)).toContain("product_low_rating_rate@product:p_a:increase");
    expect(r.findings.find((f) => f.signalId === "product_low_rating_rate")!.canonicalMetric).toBe("low_rating_rate");
    expect(ids(r).filter((x) => x.startsWith("low_rating_rate@global"))).toEqual([]);
  });
});

describe("Detector 7 — positive demand opportunities", () => {
  it("detects product demand growth, social attention and channel traffic surges as positive findings", () => {
    const spec = (h: number): HourSpec => {
      const b = healthy(h);
      if (h < 5 * DAY) return b;
      return { ...b, productOrders: { ...b.productOrders, p_a: 1 }, mentions: { p_a: 2 }, sessions: { ...b.sessions, social: 30 } };
    };
    const r = detectWith(DEMAND_SIGNALS, 7 * DAY, spec);
    expect(ids(r)).toEqual(expect.arrayContaining(["product_orders@product:p_a:increase", "product_mentions@product:p_a:increase", "channel_sessions@channel:social:increase"]));
    expect(r.findings.every((f) => f.polarity === "positive")).toBe(true);
  });
});

describe("whole rule set", () => {
  it("a healthy synthetic shop produces no findings across all seven families", () => {
    expect(detectWith(ALL_SIGNALS, 8 * DAY, healthy).findings).toEqual([]);
  });

  it("findings contain observations only: no scenario labels or simulator parameters", () => {
    const r = detectWith(ALL_SIGNALS, 7 * DAY, (h) => ({ ...healthy(h), orders: h >= 5 * DAY ? 0 : healthy(h).orders }));
    const text = JSON.stringify(r);
    for (const word of ["ad_fatigue", "delivery_delays", "viral_demand", "negative_reviews", "promo_checkout_failure", "scenario", "hiddenFault", "groundTruth"]) {
      expect(text).not.toContain(word);
    }
  });

  it("every canonical mapping uses a value from the contract's MetricName enum", async () => {
    const { MetricName } = await import("@normal/contracts");
    for (const s of ALL_SIGNALS) if (s.canonicalMetric) expect(MetricName.options).toContain(s.canonicalMetric);
  });
});
