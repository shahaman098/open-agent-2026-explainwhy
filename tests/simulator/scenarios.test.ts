import { describe, expect, it } from "vitest";
import type { BusinessEventT } from "@normal/contracts";
import { NIKE_REFERENCE_CATALOGUE } from "@/reference/nike-catalogue";
import { createInitialWorld } from "@/simulator/bootstrap";
import { TickEngine } from "@/simulator/engine";
import { deriveScenarioParams, type ScenarioNameT } from "@/simulator/scenarios";
import type { World } from "@/simulator/state";
import { Rng } from "@/simulator/rng";

const RECEIVED = "2026-10-24T12:00:00.000Z";
const TARGETS = { viralProductId: "nk_dunk_low_retro", qualityIssueProductId: "nk_quest_7" };
const WARMUP = 24 * 2;
const MEASURE = 24 * 5;

interface Summary {
  events: BusinessEventT[]; sessions: number; orders: number; revenue: number; impressions: number; clicks: number; spend: number;
  paidSessions: number; paidOrders: number; frequency: number; delayed: number; delivered: number; reviews: number; lowReviews: number;
  ratingSum: number; mentions: number; viralProductOrders: number; checkoutFailures: number; couponFailures: number; stockouts: number;
  avgSatisfaction: number;
}

/** Runs a warm-up healthy period, then injects the scenario and measures the next window. */
function simulate(seed: number, scenario: ScenarioNameT, severity: number, measureTicks = MEASURE): Summary {
  const { world, rng } = createInitialWorld({ businessId: "nike_test", simulationRunId: `run_s${seed}`, seed, catalogue: NIKE_REFERENCE_CATALOGUE, createdAt: RECEIVED });
  const tick = (w: World, r: Rng) => { const o = new TickEngine(w, r, RECEIVED).run(); w.state.rng = r.getState(); return o; };
  for (let i = 0; i < WARMUP; i++) tick(world, rng);
  world.state.activeScenario = scenario;
  world.state.scenarioSeverity = severity;
  world.state.scenarioParams = deriveScenarioParams(scenario, severity, TARGETS);
  const s: Summary = { events: [], sessions: 0, orders: 0, revenue: 0, impressions: 0, clicks: 0, spend: 0, paidSessions: 0, paidOrders: 0, frequency: 0,
    delayed: 0, delivered: 0, reviews: 0, lowReviews: 0, ratingSum: 0, mentions: 0, viralProductOrders: 0, checkoutFailures: 0, couponFailures: 0, stockouts: 0, avgSatisfaction: 0 };
  let freqSamples = 0;
  for (let i = 0; i < measureTicks; i++) {
    const o = tick(world, rng);
    s.events.push(...o.events);
    s.sessions += o.sessions.length; s.orders += o.orders.length; s.revenue += o.orders.reduce((a, x) => a + x.netRevenueMinor, 0);
    s.paidSessions += o.sessions.filter((x) => x.campaignId).length; s.paidOrders += o.orders.filter((x) => x.campaignId).length;
    s.viralProductOrders += o.orders.filter((x) => x.lines.some((l) => l.productId === TARGETS.viralProductId)).length;
    for (const e of o.events) {
      switch (e.type) {
        case "ad.metrics_observed": s.impressions += e.payload.impressions; s.clicks += e.payload.clicks; s.spend += e.payload.spendMinor; s.frequency += e.payload.frequency; freqSamples++; break;
        case "delivery.status_changed": if (e.payload.status === "delayed") s.delayed++; if (e.payload.status === "delivered") s.delivered++; break;
        case "review.created": s.reviews++; s.ratingSum += e.payload.rating; if (e.payload.rating <= 2) s.lowReviews++; break;
        case "social.mention_observed": s.mentions++; break;
        case "checkout.failed": s.checkoutFailures++; if (e.payload.failureCode === "coupon_rejected") s.couponFailures++; if (e.payload.failureCode === "out_of_stock") s.stockouts++; break;
        default: break;
      }
    }
  }
  s.frequency = freqSamples ? s.frequency / freqSamples : 0;
  const customers = [...world.customers.values()];
  s.avgSatisfaction = customers.reduce((a, c) => a + c.satisfaction, 0) / customers.length;
  return s;
}

const SEEDS = [42, 7, 1234];
const ctr = (s: Summary) => s.clicks / s.impressions;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("scenario injection changes mechanics, not display values (Milestone 4)", () => {
  const healthy = SEEDS.map((seed) => simulate(seed, "healthy", 0));

  it("healthy baselines are internally consistent across seeds", () => {
    for (const h of healthy) {
      expect(h.orders).toBeGreaterThan(100);
      expect(h.delayed / h.delivered).toBeLessThan(0.15);
      expect(ctr(h)).toBeGreaterThan(0.01);
    }
  });

  it("ad_fatigue: frequency rises, CTR/clicks/paid sessions/paid orders fall, spend stays, revenue falls (every seed)", () => {
    const fatigued = SEEDS.map((seed) => simulate(seed, "ad_fatigue", 0.8));
    fatigued.forEach((f, i) => {
      const h = healthy[i];
      expect(f.frequency).toBeGreaterThan(h.frequency * 1.5);
      expect(ctr(f)).toBeLessThan(ctr(h) * 0.6);
      expect(f.clicks).toBeLessThan(h.clicks * 0.6);
      expect(f.paidSessions).toBeLessThan(h.paidSessions * 0.6);
      expect(f.paidOrders).toBeLessThan(h.paidOrders * 0.6);
      expect(f.spend).toBeGreaterThan(h.spend * 0.9);
      expect(f.spend).toBeLessThan(h.spend * 1.1);
      expect(f.impressions).toBeGreaterThan(h.impressions * 0.9);
    });
    expect(mean(fatigued.map((f) => f.revenue))).toBeLessThan(mean(healthy.map((h) => h.revenue)) * 0.8);
    // Non-ad mechanics are untouched.
    expect(mean(fatigued.map((f) => f.delayed / f.delivered))).toBeLessThan(0.15);
  });

  it("delivery_delays: delayed-shipment rate rises sharply, customer satisfaction and review ratings fall", () => {
    // Delayed parcels are delivered and reviewed 5-13 virtual days after purchase, so measure a longer window.
    const delayed = SEEDS.map((seed) => simulate(seed, "delivery_delays", 0.8, 24 * 12));
    const healthyLong = SEEDS.map((seed) => simulate(seed, "healthy", 0, 24 * 12));
    delayed.forEach((d, i) => {
      const h = healthyLong[i];
      expect(d.delayed / d.delivered).toBeGreaterThan(0.35);
      expect(d.delayed / d.delivered).toBeGreaterThan((h.delayed / h.delivered) * 3);
      expect(d.avgSatisfaction).toBeLessThan(h.avgSatisfaction);
      // Advertising mechanics are untouched.
      expect(ctr(d)).toBeGreaterThan(ctr(h) * 0.8);
      expect(ctr(d)).toBeLessThan(ctr(h) * 1.2);
    });
    const avgRating = (s: Summary) => s.ratingSum / s.reviews;
    expect(mean(delayed.map(avgRating))).toBeLessThan(mean(healthyLong.map(avgRating)) - 0.3);
    expect(mean(delayed.map((d) => d.lowReviews / d.reviews))).toBeGreaterThan(mean(healthyLong.map((h) => h.lowReviews / Math.max(1, h.reviews))));
  });

  it("viral_demand: social mentions and organic traffic surge, the viral product sells far more, revenue rises and stock pressure appears", () => {
    const viral = SEEDS.map((seed) => simulate(seed, "viral_demand", 0.8, 24 * 7));
    const healthyWeek = SEEDS.map((seed) => simulate(seed, "healthy", 0, 24 * 7));
    viral.forEach((v, i) => {
      const h = healthyWeek[i];
      expect(v.mentions).toBeGreaterThan(h.mentions * 5);
      expect(v.sessions - v.paidSessions).toBeGreaterThan((h.sessions - h.paidSessions) * 2);
      expect(v.viralProductOrders).toBeGreaterThan(h.viralProductOrders * 3);
      expect(v.revenue).toBeGreaterThan(h.revenue * 1.15);
      // Paid media is unaffected by the viral mechanic.
      expect(v.impressions).toBeGreaterThan(h.impressions * 0.9);
      expect(v.impressions).toBeLessThan(h.impressions * 1.1);
    });
    const viralMentions = viral.flatMap((v) => v.events).filter((e) => e.type === "social.mention_observed");
    expect(viralMentions.filter((e) => e.type === "social.mention_observed" && e.payload.productId === TARGETS.viralProductId).length).toBeGreaterThan(viralMentions.length * 0.7);
    // Stock pressure: the viral product runs low or out within the window in at least one seed.
    expect(viral.some((v) => v.stockouts > 0)).toBe(true);
  });

  it("negative_reviews: the affected product's ratings collapse while delivery and ads stay healthy", () => {
    const neg = SEEDS.map((seed) => simulate(seed, "negative_reviews", 0.8, 24 * 10));
    const healthyLong = SEEDS.map((seed) => simulate(seed, "healthy", 0, 24 * 10));
    const targetRatings = (s: Summary) => s.events.filter((e) => e.type === "review.created" && e.payload.productId === TARGETS.qualityIssueProductId).map((e) => e.type === "review.created" ? e.payload.rating : 0);
    const all = neg.flatMap(targetRatings);
    const healthyAll = healthyLong.flatMap(targetRatings);
    expect(all.length).toBeGreaterThan(3);
    expect(mean(all)).toBeLessThan(mean(healthyAll) - 1);
    for (const n of neg) expect(n.delayed / n.delivered).toBeLessThan(0.15);
  });

  it("promo_checkout_failure: coupon checkouts fail, failed checkouts rise, orders fall", () => {
    const promo = SEEDS.map((seed) => simulate(seed, "promo_checkout_failure", 0.8));
    promo.forEach((p, i) => {
      const h = healthy[i];
      expect(p.couponFailures).toBeGreaterThan(h.couponFailures * 5 + 5);
      expect(p.checkoutFailures).toBeGreaterThan(h.checkoutFailures);
    });
    expect(mean(promo.map((p) => p.orders))).toBeLessThan(mean(healthy.map((h) => h.orders)) * 0.9);
  });

  it("severity scales the effect monotonically", () => {
    const mild = simulate(42, "ad_fatigue", 0.3);
    const severe = simulate(42, "ad_fatigue", 0.9);
    expect(ctr(mild)).toBeLessThan(ctr(healthy[0]));
    expect(ctr(severe)).toBeLessThan(ctr(mild));
  });

  it("hidden fault parameters never appear in any emitted event", () => {
    const f = simulate(42, "ad_fatigue", 0.8);
    const text = JSON.stringify(f.events);
    for (const key of ["ctrFatigueStrength", "adAudienceShrink", "deliveryDelayHazard", "scenarioParams", "ad_fatigue", "hiddenFaultParameters", "severity"]) {
      expect(text, key).not.toContain(key);
    }
  });
});
