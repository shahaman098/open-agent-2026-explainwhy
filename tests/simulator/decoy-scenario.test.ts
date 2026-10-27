import { describe, expect, it } from "vitest";
import type { BusinessEventT } from "@explainwhy/contracts";
import { detectTimeline, simulate, type SimulatedTimeline } from "@/intelligence/evaluation/harness";
import { DEFAULT_DECOY_CAMPAIGN_ID, SCENARIO_DECOYS, SCENARIO_ROOT_CAUSES } from "@/simulator/scenarios";

/**
 * The false-lead case: a promo-code checkout fault plus one small campaign whose ads fatigue at the same moment.
 * These checks prove the lead is misleading from canonical events alone, before any model sees them.
 */
const SEEDS = [42, 7, 1234];
const PAID = new Set(["paid_social", "paid_search"]);
const DECOY = DEFAULT_DECOY_CAMPAIGN_ID;

interface Window { hours: number; sessions: number; orders: number; decoySessions: number; failures: Map<string, number>; couponFailuresPaid: number; couponFailuresNonPaid: number; decoyCtr: number }
function measure(events: BusinessEventT[], from: string, to: string): Window {
  const channel = new Map<string, string>();
  const w: Window = { hours: (Date.parse(to) - Date.parse(from)) / 3_600_000, sessions: 0, orders: 0, decoySessions: 0, failures: new Map(), couponFailuresPaid: 0, couponFailuresNonPaid: 0, decoyCtr: 0 };
  let impressions = 0, clicks = 0;
  for (const e of events) {
    if (e.occurredAt < from || e.occurredAt >= to) continue;
    switch (e.type) {
      case "web.session_started":
        w.sessions++; channel.set(e.payload.sessionId, e.payload.channel);
        if (e.payload.campaignId === DECOY) w.decoySessions++;
        break;
      case "order.completed": w.orders++; break;
      case "checkout.failed":
        w.failures.set(e.payload.failureCode, (w.failures.get(e.payload.failureCode) ?? 0) + 1);
        if (e.payload.failureCode === "coupon_rejected") { if (PAID.has(channel.get(e.payload.sessionId) ?? "")) w.couponFailuresPaid++; else w.couponFailuresNonPaid++; }
        break;
      case "ad.metrics_observed":
        if (e.payload.campaignId === DECOY) { impressions += e.payload.impressions; clicks += e.payload.clicks; }
        break;
      default: break;
    }
  }
  w.decoyCtr = impressions ? clicks / impressions : 0;
  return w;
}
const perHour = (n: number, w: Window) => n / w.hours;
const change = (cur: number, base: number) => (cur - base) / base;

const runs = SEEDS.map((seed) => {
  const t: SimulatedTimeline = simulate({ seed, healthyHours: 72, scenario: "promo_checkout_failure_ad_decoy", severity: 0.85, scenarioHours: 96 });
  return { seed, t, pre: measure(t.events, t.startAt, t.injectedAt!), post: measure(t.events, t.injectedAt!, t.endAt) };
});

describe("promo checkout failure with an advertising decoy", () => {
  it("records ad fatigue only as a decoy, never as a root cause", () => {
    expect(SCENARIO_ROOT_CAUSES.promo_checkout_failure_ad_decoy).toEqual(["discount_failure", "checkout_failure"]);
    expect(SCENARIO_DECOYS.promo_checkout_failure_ad_decoy).toEqual(["ad_fatigue"]);
  });

  it.each(runs)("seed $seed: the decoy campaign's ads collapse visibly", ({ pre, post }) => {
    expect(change(post.decoyCtr, pre.decoyCtr)).toBeLessThan(-0.8);
  });

  it.each(runs)("seed $seed: the decoy is too small to explain the order loss", ({ pre, post }) => {
    // The fatigued campaign was a small share of traffic, and total sessions barely moved...
    expect(pre.decoySessions / pre.sessions).toBeLessThan(0.1);
    expect(change(perHour(post.sessions, post), perHour(pre.sessions, pre))).toBeGreaterThan(-0.12);
    // ...while orders fell much further than sessions, and over a fifth of checkout attempts now fail.
    const orderDrop = change(perHour(post.orders, post), perHour(pre.orders, pre));
    expect(orderDrop).toBeLessThan(-0.12);
    expect(Math.abs(orderDrop)).toBeGreaterThan(2 * Math.abs(change(perHour(post.sessions, post), perHour(pre.sessions, pre))));
    const failed = [...post.failures.values()].reduce((a, b) => a + b, 0);
    expect(failed / (failed + post.orders)).toBeGreaterThan(0.2);
  });

  it.each(runs)("seed $seed: rejected promo codes dominate and hit paid and non-paid shoppers alike", ({ post }) => {
    const coupon = post.failures.get("coupon_rejected") ?? 0;
    const total = [...post.failures.values()].reduce((a, b) => a + b, 0);
    expect(coupon / total).toBeGreaterThan(0.8);
    expect(post.couponFailuresPaid).toBeGreaterThan(5);
    expect(post.couponFailuresNonPaid).toBeGreaterThan(5);
  });

  it.each(runs)("seed $seed: the detector groups the decoy and the checkout fault into one incident", ({ t }) => {
    const { incidents } = detectTimeline(t);
    const joint = incidents.find((i) => i.themes.includes("advertising") && i.themes.includes("conversion"));
    expect(joint).toBeDefined();
    expect(joint!.findingKeys.some((k) => k.startsWith(`ctr|campaign:${DECOY}|decrease`))).toBe(true);
    expect(joint!.findingKeys.some((k) => k.startsWith("coupon_failure_rate|global|increase"))).toBe(true);
  });
});
