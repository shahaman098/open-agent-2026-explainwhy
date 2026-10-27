import "server-only";

import type { SimulatedOrder, SimulatedShipment } from "@/types/domain";
import { COLLECTIONS, resolveContext } from "@/adapters/_shared";
import type { ActionContext } from "@/adapters/types";

export interface OrderShippingView {
  orderId: string;
  customerId: string;
  placedAt: string;
  netRevenueMinor: number;
  status: SimulatedOrder["status"];
  shipment: Pick<SimulatedShipment, "status" | "promisedAt" | "shippedAt" | "deliveredAt" | "delayMinutes"> | null;
}

/** Read order + shipping status for specific orders (max 200). */
export async function readOrdersShipping(ctx: Pick<ActionContext, "businessId" | "simulationRunId" | "db">, orderIds: string[]): Promise<OrderShippingView[]> {
  const { db, runId } = await resolveContext(ctx);
  const ids = [...new Set(orderIds)].slice(0, 200);
  const [orders, shipments] = await Promise.all([
    db.collection<SimulatedOrder>(COLLECTIONS.simulatedOrders).find({ businessId: ctx.businessId, simulationRunId: runId, orderId: { $in: ids } }, { projection: { _id: 0 } }).toArray(),
    db.collection<SimulatedShipment>(COLLECTIONS.simulatedShipments).find({ businessId: ctx.businessId, simulationRunId: runId, orderId: { $in: ids } }, { projection: { _id: 0 } }).toArray(),
  ]);
  const byOrder = new Map(shipments.map((s) => [s.orderId, s]));
  return orders.map((o) => {
    const s = byOrder.get(o.orderId);
    return {
      orderId: o.orderId, customerId: o.customerId, placedAt: o.placedAt, netRevenueMinor: o.netRevenueMinor, status: o.status,
      shipment: s ? { status: s.status, promisedAt: s.promisedAt, shippedAt: s.shippedAt, deliveredAt: s.deliveredAt, delayMinutes: s.delayMinutes } : null,
    };
  });
}

/** Orders whose shipment is currently delayed (the natural recipients of a delay notice). */
export async function listDelayedOrders(ctx: Pick<ActionContext, "businessId" | "simulationRunId" | "db">, limit = 100): Promise<OrderShippingView[]> {
  const { db, runId } = await resolveContext(ctx);
  const shipments = await db.collection<SimulatedShipment>(COLLECTIONS.simulatedShipments)
    .find({ businessId: ctx.businessId, simulationRunId: runId, status: "delayed" }, { projection: { _id: 0 } }).sort({ promisedAt: 1 }).limit(limit).toArray();
  return readOrdersShipping(ctx, shipments.map((s) => s.orderId));
}
