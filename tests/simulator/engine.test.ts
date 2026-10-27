import { describe, expect, it } from "vitest";
import { BusinessEvent, type BusinessEventT } from "@normal/contracts";
import { NIKE_REFERENCE_CATALOGUE } from "@/reference/nike-catalogue";
import { cloneWorld, createInitialWorld } from "@/simulator/bootstrap";
import { TickEngine } from "@/simulator/engine";
import { Rng } from "@/simulator/rng";
import type { TickOutput, World } from "@/simulator/state";

const RECEIVED = "2026-10-24T12:00:00.000Z";

function boot(seed: number, runId = "run_t") {
  return createInitialWorld({ businessId: "nike_test", simulationRunId: runId, seed, catalogue: NIKE_REFERENCE_CATALOGUE, createdAt: RECEIVED });
}

function runTicks(world: World, rng: Rng, ticks: number): TickOutput[] {
  const outputs: TickOutput[] = [];
  for (let i = 0; i < ticks; i++) {
    outputs.push(new TickEngine(world, rng, RECEIVED).run());
    world.state.rng = rng.getState();
  }
  return outputs;
}

const observable = (events: BusinessEventT[]) => events.map((e) => ({ ...e, receivedAt: undefined }));

describe("TickEngine determinism (Milestone 2)", () => {
  it("identical seeds produce identical observations over 48 ticks", () => {
    const a = boot(42); const b = boot(42);
    const ea = runTicks(a.world, a.rng, 48).flatMap((o) => o.events);
    const eb = runTicks(b.world, b.rng, 48).flatMap((o) => o.events);
    expect(ea.length).toBeGreaterThan(500);
    expect(observable(ea)).toEqual(observable(eb));
    expect(a.world.state.rng).toEqual(b.world.state.rng);
    expect(a.world.state.virtualTime).toBe("2026-10-03T00:00:00.000Z");
  });

  it("different seeds diverge", () => {
    const a = boot(42); const b = boot(43);
    const ea = runTicks(a.world, a.rng, 12).flatMap((o) => o.events);
    const eb = runTicks(b.world, b.rng, 12).flatMap((o) => o.events);
    expect(observable(ea)).not.toEqual(observable(eb));
  });

  it("resuming from serialised world + RNG state reproduces the continuous run (restart safety)", () => {
    const cont = boot(7);
    const outputsA = runTicks(cont.world, cont.rng, 30);
    const split = boot(7);
    const first = runTicks(split.world, split.rng, 12);
    const snapshot = cloneWorld(split.world);
    const resumedRng = Rng.fromState(snapshot.state.rng);
    const rest = runTicks(snapshot, resumedRng, 18);
    expect(observable([...first, ...rest].flatMap((o) => o.events))).toEqual(observable(outputsA.flatMap((o) => o.events)));
  });
});

describe("TickEngine business invariants", () => {
  const { world, rng } = boot(42);
  const outputs = runTicks(world, rng, 24 * 5);
  const events = outputs.flatMap((o) => o.events);
  const orders = outputs.flatMap((o) => o.orders);
  const byType = <T extends BusinessEventT["type"]>(t: T) => events.filter((e): e is Extract<BusinessEventT, { type: T }> => e.type === t);

  it("every emitted event re-validates against the canonical BusinessEvent schema", () => {
    for (const e of events) expect(BusinessEvent.safeParse(e).success).toBe(true);
    const ids = events.map((e) => e.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    const srcs = events.map((e) => e.provenance.sourceRecordId);
    expect(new Set(srcs).size).toBe(srcs.length);
  });

  it("produces a plausible healthy baseline over five days", () => {
    expect(orders.length).toBeGreaterThan(60);
    expect(outputs.flatMap((o) => o.sessions).length).toBeGreaterThan(3000);
    const conversion = orders.length / outputs.flatMap((o) => o.sessions).length;
    expect(conversion).toBeGreaterThan(0.01);
    expect(conversion).toBeLessThan(0.08);
  });

  it("order arithmetic reconciles: net = gross - discount and lines sum to totals", () => {
    for (const o of orders) {
      const gross = o.lines.reduce((a, l) => a + l.unitPriceMinor * l.quantity, 0);
      const discount = o.lines.reduce((a, l) => a + l.discountMinor, 0);
      expect(o.grossTotalMinor).toBe(gross);
      expect(o.discountMinor).toBe(discount);
      expect(o.netRevenueMinor).toBe(gross - discount);
      const ev = byType("order.completed").find((e) => e.payload.orderId === o.orderId)!;
      expect(ev.payload.netRevenueMinor).toBe(o.netRevenueMinor);
      expect(ev.payload.productIds).toEqual(o.lines.map((l) => l.productId));
      for (const l of o.lines) expect(l.unitPriceMinor).toBe(world.products.get(l.productId)!.priceMinor);
    }
  });

  it("inventory never goes negative and units sold never exceed initial stock", () => {
    const fresh = boot(42).world;
    for (const [id, p] of world.products) {
      const sold = orders.flatMap((o) => o.lines).filter((l) => l.productId === id).reduce((a, l) => a + l.quantity, 0);
      expect(p.availableUnits).toBe(fresh.products.get(id)!.availableUnits - sold);
      expect(p.availableUnits).toBeGreaterThanOrEqual(0);
    }
    for (const e of byType("inventory.level_changed")) expect(e.payload.availableUnits).toBeGreaterThanOrEqual(0);
  });

  it("ad metrics: clicks <= impressions, attributed orders <= clicks, spend within daily budget", () => {
    const ads = byType("ad.metrics_observed");
    expect(ads.length).toBe(24 * 5 * world.campaigns.size);
    for (const e of ads) {
      expect(e.payload.clicks).toBeLessThanOrEqual(e.payload.impressions);
      expect(e.payload.attributedOrders).toBeLessThanOrEqual(e.payload.clicks);
    }
    const spendByDay = new Map<string, number>();
    for (const e of ads) {
      const k = `${e.payload.campaignId}|${e.payload.window.startAt.slice(0, 10)}`;
      spendByDay.set(k, (spendByDay.get(k) ?? 0) + e.payload.spendMinor);
    }
    for (const [k, spend] of spendByDay) {
      const c = world.campaigns.get(k.split("|")[0])!;
      expect(spend).toBeLessThanOrEqual(c.dailyBudgetMinor);
      expect(spend).toBeGreaterThan(c.dailyBudgetMinor * 0.5);
    }
    // Attribution derives from real linked orders.
    const attributedTotal = ads.reduce((a, e) => a + e.payload.attributedOrders, 0);
    expect(attributedTotal).toBe(orders.filter((o) => o.campaignId).length);
    const windows = new Set(ads.map((e) => `${e.payload.campaignId}|${e.payload.window.startAt}`));
    expect(windows.size).toBe(ads.length);
  });

  it("deliveries reference existing orders and never travel backwards in time", () => {
    const orderIds = new Set(orders.map((o) => o.orderId));
    const byOrder = new Map<string, Array<{ status: string; at: string }>>();
    for (const e of byType("delivery.status_changed")) {
      expect(orderIds.has(e.payload.orderId)).toBe(true);
      const arr = byOrder.get(e.payload.orderId) ?? [];
      arr.push({ status: e.payload.status, at: e.occurredAt });
      byOrder.set(e.payload.orderId, arr);
    }
    const rank: Record<string, number> = { pending: 0, shipped: 1, delayed: 2, delivered: 3, lost: 3 };
    let delivered = 0;
    for (const [, seq] of byOrder) {
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i].at >= seq[i - 1].at).toBe(true);
        expect(rank[seq[i].status]).toBeGreaterThan(rank[seq[i - 1].status]);
      }
      expect(seq[0].status).toBe("pending");
      if (seq.some((s) => s.status === "delivered")) delivered++;
    }
    expect(delivered).toBeGreaterThan(10);
    for (const e of byType("delivery.status_changed")) {
      if (e.payload.status === "delivered") expect(e.payload.deliveredAt).toBe(e.occurredAt);
    }
  });

  it("reviews have valid ratings and reference real orders and products", () => {
    const reviews = byType("review.created");
    expect(reviews.length).toBeGreaterThan(3);
    const orderIds = new Set(orders.map((o) => o.orderId));
    for (const r of reviews) {
      expect(r.payload.rating).toBeGreaterThanOrEqual(1);
      expect(r.payload.rating).toBeLessThanOrEqual(5);
      expect(orderIds.has(r.payload.orderId!)).toBe(true);
      expect(world.products.has(r.payload.productId)).toBe(true);
      const o = orders.find((x) => x.orderId === r.payload.orderId)!;
      expect(o.lines.some((l) => l.productId === r.payload.productId)).toBe(true);
      expect(r.occurredAt > o.placedAt).toBe(true);
    }
  });

  it("sessions and orders are linked, and every event type is canonical", () => {
    const sessionIds = new Set(byType("web.session_started").map((e) => e.payload.sessionId));
    for (const o of byType("order.completed")) expect(sessionIds.has(o.payload.sessionId!)).toBe(true);
    for (const c of byType("checkout.failed")) expect(sessionIds.has(c.payload.sessionId)).toBe(true);
    const allowed = new Set(BusinessEvent.options.map((o) => o.shape.type.value));
    for (const e of events) expect(allowed.has(e.type)).toBe(true);
  });
});

describe("TickEngine stock exhaustion", () => {
  it("cannot sell a product with zero available units and records out_of_stock checkout failures", () => {
    const { world, rng } = boot(11);
    for (const p of world.products.values()) p.availableUnits = 0;
    const outputs = runTicks(world, rng, 24);
    const events = outputs.flatMap((o) => o.events);
    expect(outputs.flatMap((o) => o.orders)).toHaveLength(0);
    expect(events.filter((e) => e.type === "order.completed")).toHaveLength(0);
    const failures = events.filter((e) => e.type === "checkout.failed" && e.payload.failureCode === "out_of_stock");
    expect(failures.length).toBeGreaterThan(5);
    for (const p of world.products.values()) expect(p.availableUnits).toBe(0);
  });
});
