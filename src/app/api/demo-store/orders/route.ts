import type { Filter } from "mongodb";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { businessIdFrom, handleRouteError } from "@/lib/route-helpers";
import { getActiveRunId } from "@/simulator/runtime";
import type { SimulatedOrder, SimulatedShipment } from "@/types/domain";

/**
 * GET /api/demo-store/orders?keys=k1,k2 — storefront purchase history. Returns
 * the shopper's own orders when idempotency keys are supplied, otherwise the
 * most recent demo-storefront orders (fictional data only).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const businessId = businessIdFrom(request);
    const url = new URL(request.url);
    const keys = (url.searchParams.get("keys") ?? "").split(",").map((k) => k.trim()).filter((k) => k.length >= 8).slice(0, 50);
    const db = await getDb();
    const runId = new URL(request.url).searchParams.get("simulationRunId") ?? await getActiveRunId(businessId, db);
    if (!runId) return Response.json({ orders: [] });
    const filter: Filter<SimulatedOrder> = { businessId, simulationRunId: runId, origin: "demo_storefront", ...(keys.length ? { idempotencyKey: { $in: keys } } : {}) };
    const orders = await db.collection<SimulatedOrder>(COLLECTIONS.simulatedOrders).find(filter, { projection: { _id: 0 } }).sort({ placedAt: -1, orderId: -1 }).limit(20).toArray();
    const shipments = await db.collection<SimulatedShipment>(COLLECTIONS.simulatedShipments)
      .find({ businessId, simulationRunId: runId, orderId: { $in: orders.map((o) => o.orderId) } }, { projection: { _id: 0, orderId: 1, status: 1, promisedAt: 1, shippedAt: 1, deliveredAt: 1, delayMinutes: 1 } }).toArray();
    const byOrder = new Map(shipments.map((s) => [s.orderId, s]));
    return Response.json({
      simulationRunId: runId,
      orders: orders.map((o) => ({
        orderId: o.orderId, placedAt: o.placedAt, wallClockAt: o.wallClockAt, lines: o.lines, grossTotalMinor: o.grossTotalMinor, discountMinor: o.discountMinor,
        netRevenueMinor: o.netRevenueMinor, currency: o.currency, status: o.status, couponCode: o.couponCode, idempotencyKey: keys.length ? o.idempotencyKey : undefined,
        shipment: byOrder.get(o.orderId) ?? null,
      })),
    });
  } catch (error) {
    return handleRouteError(error, "demo-store/orders");
  }
}
