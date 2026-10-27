import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { checkout } from "@/simulator/checkout";
import { startRun, tickRun } from "@/simulator/runtime";
import type { SimulatedProduct } from "@/types/domain";
import { TEST_BUSINESS, eventsForRun, resetTestRun } from "../helpers";

const RUN = "t_chk";

async function stock(productId: string): Promise<number> {
  const db = await getDb();
  const p = await db.collection<SimulatedProduct>(COLLECTIONS.simulatedProducts).findOne({ businessId: TEST_BUSINESS, simulationRunId: RUN, productId });
  return p!.availableUnits;
}

describe("storefront checkout", () => {
  beforeAll(async () => {
    await resetTestRun(RUN);
    await startRun({ businessId: TEST_BUSINESS, simulationRunId: RUN, seed: 5, makeActive: true });
  });
  afterAll(async () => { await resetTestRun(RUN); });

  it("creates a persisted order with server-side pricing, decrements stock and emits canonical events", async () => {
    const before = await stock("nk_air_force_1_07");
    const res = await checkout({ businessId: TEST_BUSINESS, idempotencyKey: "chk-key-0001", items: [{ productId: "nk_air_force_1_07", quantity: 2 }], device: "ios" });
    expect(res.status).toBe("completed");
    const order = res.order!;
    expect(order.netRevenueMinor).toBe(10999 * 2);
    expect(order.grossTotalMinor - order.discountMinor).toBe(order.netRevenueMinor);
    expect(await stock("nk_air_force_1_07")).toBe(before - 2);
    expect(res.ingest).toMatchObject({ accepted: 4, duplicates: 0, rejected: 0 });
    const events = await eventsForRun(RUN);
    const types = events.map((e) => e.type).sort();
    expect(types).toEqual(["delivery.status_changed", "inventory.level_changed", "order.completed", "web.session_started"]);
    const inv = events.find((e) => e.type === "inventory.level_changed");
    expect(inv?.type === "inventory.level_changed" && inv.payload.availableUnits).toBe(before - 2);
    const db = await getDb();
    expect(await db.collection(COLLECTIONS.simulatedShipments).countDocuments({ businessId: TEST_BUSINESS, orderId: order.orderId })).toBe(1);
  });

  it("replays the same idempotency key without charging or decrementing twice", async () => {
    const before = await stock("nk_air_force_1_07");
    const res = await checkout({ businessId: TEST_BUSINESS, idempotencyKey: "chk-key-0001", items: [{ productId: "nk_air_force_1_07", quantity: 2 }], device: "ios" });
    expect(res.status).toBe("replayed");
    expect(res.order?.orderId).toMatch(/_h00001$/);
    expect(await stock("nk_air_force_1_07")).toBe(before);
    expect(res.ingest?.duplicates).toBe(4);
    expect(res.ingest?.accepted).toBe(0);
  });

  it("applies the storefront coupon with a server-computed discount", async () => {
    const res = await checkout({ businessId: TEST_BUSINESS, idempotencyKey: "chk-key-coupon", items: [{ productId: "nk_quest_7", quantity: 1 }], couponCode: "AUTUMN15" });
    // Healthy scenario has a small baseline coupon failure hazard, so either outcome must be internally consistent.
    if (res.status === "completed") {
      expect(res.order!.discountMinor).toBe(Math.round(7499 * 0.15));
      expect(res.order!.netRevenueMinor).toBe(7499 - Math.round(7499 * 0.15));
    } else {
      expect(res.failureCode).toBe("coupon_rejected");
    }
  });

  it("never oversells: concurrent checkouts of the last units let exactly one succeed", async () => {
    const db = await getDb();
    await db.collection(COLLECTIONS.simulatedProducts).updateOne({ businessId: TEST_BUSINESS, simulationRunId: RUN, productId: "nk_kobe_ad_protro" }, { $set: { availableUnits: 1 } });
    const attempts = await Promise.all([1, 2, 3, 4, 5].map((i) =>
      checkout({ businessId: TEST_BUSINESS, idempotencyKey: `chk-race-${i}-xxxx`, items: [{ productId: "nk_kobe_ad_protro", quantity: 1 }] })));
    expect(attempts.filter((a) => a.status === "completed")).toHaveLength(1);
    expect(attempts.filter((a) => a.status === "failed" && a.failureCode === "out_of_stock")).toHaveLength(4);
    expect(await stock("nk_kobe_ad_protro")).toBe(0);
    const failures = (await eventsForRun(RUN, "checkout.failed")).filter((e) => e.type === "checkout.failed" && e.payload.failureCode === "out_of_stock");
    expect(failures.length).toBe(4);
  });

  it("rejects a product with zero units and unknown products", async () => {
    const res = await checkout({ businessId: TEST_BUSINESS, idempotencyKey: "chk-zero-stock-1", items: [{ productId: "nk_kobe_ad_protro", quantity: 1 }] });
    expect(res.status).toBe("failed");
    expect(res.failureCode).toBe("out_of_stock");
    await expect(checkout({ businessId: TEST_BUSINESS, idempotencyKey: "chk-unknown-1xx", items: [{ productId: "nk_nope", quantity: 1 }] })).rejects.toMatchObject({ code: "unknown_product" });
    await expect(checkout({ businessId: TEST_BUSINESS, idempotencyKey: "short", items: [{ productId: "nk_quest_7", quantity: 1 }] })).rejects.toThrow();
  });

  it("storefront orders flow into fulfilment on later ticks", async () => {
    await tickRun({ simulationRunId: RUN, ticks: 40 }, { businessId: TEST_BUSINESS });
    const deliveries = (await eventsForRun(RUN, "delivery.status_changed")).filter((e) => e.type === "delivery.status_changed" && e.payload.orderId.endsWith("_h00001"));
    const statuses = deliveries.map((e) => e.type === "delivery.status_changed" && e.payload.status);
    expect(statuses[0]).toBe("pending");
    expect(statuses).toContain("shipped");
  });
});
