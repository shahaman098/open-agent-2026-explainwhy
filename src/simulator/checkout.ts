import "server-only";

import type { ClientSession, Db } from "mongodb";
import { z } from "zod";
import type { BusinessEventT } from "@normal/contracts";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { ingestEvents } from "@/ingestion/service";
import { DISPATCH_MAX_HOURS, DISPATCH_MIN_HOURS, STANDARD_DELIVERY_HOURS } from "@/simulator/config";
import { buildSimulatorEvent } from "@/simulator/events";
import { loadState } from "@/simulator/persistence";
import { Rng, hash32 } from "@/simulator/rng";
import { SimulatorError, getActiveRunId } from "@/simulator/runtime";
import type { SimulatorStateDoc } from "@/simulator/state";
import { addHours, pad } from "@/simulator/time";
import type {
  SimulatedCustomer, SimulatedOrder, SimulatedOrderLine, SimulatedProduct, SimulatedSession, SimulatedShipment, SimulatedStorefront,
} from "@/types/domain";

export const CheckoutRequest = z.object({
  businessId: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/).default("nike_demo"),
  simulationRunId: z.string().min(1).max(64).optional(),
  /** Client-generated key; replays return the original order instead of charging twice. */
  idempotencyKey: z.string().min(8).max(120),
  device: z.enum(["desktop", "ios", "android", "other"]).default("desktop"),
  items: z.array(z.object({ productId: z.string().min(1).max(64), quantity: z.number().int().min(1).max(5) }).strict()).min(1).max(5),
  couponCode: z.string().min(1).max(32).optional(),
  shopperName: z.string().min(1).max(60).optional(),
}).strict();
export type CheckoutRequestT = z.infer<typeof CheckoutRequest>;

export interface CheckoutResult {
  status: "completed" | "replayed" | "failed";
  order?: SimulatedOrder;
  failureCode?: string;
  message?: string;
  ingest?: { accepted: number; duplicates: number; rejected: number };
}



/** Builds the canonical events for a storefront order (used on first write and on replay re-ingestion). */
function eventsForOrder(order: SimulatedOrder, session: SimulatedSession, stockAfter: Map<string, { available: number; reserved: number }>, promisedAt: string, receivedAt: string): BusinessEventT[] {
  const env = (sourceRecordId: string, occurredAt: string, correlationId?: string) => ({
    businessId: order.businessId, simulationRunId: order.simulationRunId, occurredAt, receivedAt,
    sourceRecordId: `${order.simulationRunId}:${sourceRecordId}`, correlationId,
  });
  const events: BusinessEventT[] = [
    buildSimulatorEvent("web.session_started", { sessionId: session.sessionId, device: session.device, channel: "demo_storefront" },
      env(`session:${session.sessionId}`, session.startedAt, session.sessionId)),
    buildSimulatorEvent("order.completed", {
      orderId: order.orderId, sessionId: session.sessionId, customerId: order.customerId,
      productIds: order.lines.map((l) => l.productId), grossTotalMinor: order.grossTotalMinor,
      discountMinor: order.discountMinor, netRevenueMinor: order.netRevenueMinor, currency: "GBP",
    }, env(`order:${order.orderId}`, order.placedAt, session.sessionId)),
    buildSimulatorEvent("delivery.status_changed", { orderId: order.orderId, status: "pending", promisedAt },
      env(`delivery:${order.orderId}:pending`, order.placedAt, order.orderId)),
  ];
  for (const [productId, level] of stockAfter) {
    events.push(buildSimulatorEvent("inventory.level_changed", { productId, availableUnits: level.available, reservedUnits: level.reserved },
      env(`inv:${productId}:h:${order.orderId}`, order.placedAt)));
  }
  return events;
}

function applyPromotions(storefront: SimulatedStorefront | null, state: SimulatorStateDoc, couponCode: string | undefined, productId: string, now: string): number {
  if (!couponCode) return 0;
  if (couponCode.toUpperCase() === state.scenarioParams.couponCode) return 15;
  const promo = storefront?.promotions.find((p) => p.promoCode.toUpperCase() === couponCode.toUpperCase() && p.expiresAt > now && p.redemptions < p.maxRedemptions && p.productIds.includes(productId));
  return promo ? promo.percentOff : 0;
}

/**
 * Completes a synthetic purchase. All money is computed server-side from the
 * persisted product prices; stock is reserved atomically inside a transaction;
 * no payment details are ever requested or stored.
 */
export async function checkout(input: unknown, db?: Db): Promise<CheckoutResult> {
  const req = CheckoutRequest.parse(input);
  const d = db ?? (await getDb());
  await ensureIndexes(d);
  const runId = req.simulationRunId ?? (await getActiveRunId(req.businessId, d));
  if (!runId) throw new SimulatorError("No active simulation run for this business", "no_active_run", 404);
  const state = await loadState(d, req.businessId, runId);
  if (!state) throw new SimulatorError(`Run ${runId} not found`, "run_not_found", 404);

  const orders = d.collection<SimulatedOrder>(COLLECTIONS.simulatedOrders);
  const existing = await orders.findOne({ businessId: req.businessId, idempotencyKey: req.idempotencyKey }, { projection: { _id: 0 } });
  if (existing) {
    // Replay: make sure the canonical events exist (idempotent), then return the original order.
    const session = await d.collection<SimulatedSession>(COLLECTIONS.simulatedSessions).findOne({ businessId: req.businessId, sessionId: existing.sessionId }, { projection: { _id: 0 } });
    const shipment = await d.collection<SimulatedShipment>(COLLECTIONS.simulatedShipments).findOne({ businessId: req.businessId, orderId: existing.orderId }, { projection: { _id: 0 } });
    if (session && shipment) {
      const stock = new Map<string, { available: number; reserved: number }>();
      const inv = await d.collection<BusinessEventT>(COLLECTIONS.businessEvents).find({ businessId: req.businessId, type: "inventory.level_changed", correlationId: { $exists: false }, "provenance.sourceRecordId": { $regex: `:h:${existing.orderId}$` } }).toArray();
      for (const e of inv) if (e.type === "inventory.level_changed") stock.set(e.payload.productId, { available: e.payload.availableUnits, reserved: e.payload.reservedUnits });
      const events = eventsForOrder(existing, session, stock, shipment.promisedAt, new Date().toISOString());
      const r = await ingestEvents(events, { businessId: req.businessId, db: d });
      return { status: "replayed", order: existing, ingest: r.result };
    }
    return { status: "replayed", order: existing };
  }

  // Merge duplicate product lines.
  const quantities = new Map<string, number>();
  for (const item of req.items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  if ([...quantities.values()].some((q) => q > 5)) throw new SimulatorError("Maximum 5 units per product", "quantity_limit", 400);

  const productDocs = await d.collection<SimulatedProduct>(COLLECTIONS.simulatedProducts)
    .find({ businessId: req.businessId, simulationRunId: runId, productId: { $in: [...quantities.keys()] } }, { projection: { _id: 0 } }).toArray();
  const products = new Map(productDocs.map((p) => [p.productId, p]));
  for (const pid of quantities.keys()) {
    const p = products.get(pid);
    if (!p || !p.active) throw new SimulatorError(`Unknown or inactive product ${pid}`, "unknown_product", 400);
  }
  const storefront = await d.collection<SimulatedStorefront>(COLLECTIONS.simulatedStorefront).findOne({ businessId: req.businessId, simulationRunId: runId }, { projection: { _id: 0 } });

  const virtualNow = state.virtualTime;
  const wallNow = new Date().toISOString();
  const rng = Rng.fromSeed(hash32(`${runId}:${req.idempotencyKey}`));
  const client = await getMongoClient();
  const stateCol = d.collection<SimulatorStateDoc>(COLLECTIONS.simulatorState);

  // Reserve a storefront order number atomically (never touched by ticks).
  const counterDoc = await stateCol.findOneAndUpdate(
    { businessId: req.businessId, simulationRunId: runId }, { $inc: { storefrontOrderCounter: 1 } },
    { returnDocument: "after", projection: { storefrontOrderCounter: 1 } },
  );
  const n = counterDoc?.storefrontOrderCounter ?? 0;
  const suffix = `h${pad(n, 5)}`;
  const orderId = `ord_${runId}_${suffix}`;
  const sessionId = `sess_${runId}_${suffix}`;
  const customerId = `cust_${runId}_${suffix}`;
  const shipmentId = `shp_${runId}_${suffix}`;
  const checkoutId = `chk_${runId}_${suffix}`;

  const session: SimulatedSession = {
    businessId: req.businessId, simulationRunId: runId, sessionId, customerId, isNewCustomer: true, device: req.device,
    channel: "demo_storefront", startedAt: virtualNow, viewedProductIds: [...quantities.keys()],
    cart: [...quantities].map(([productId, quantity]) => ({ productId, quantity })), outcome: "browsed",
  };

  // Coupon path can be broken by the promo_checkout_failure scenario (mechanistic, per-order roll).
  if (req.couponCode && rng.chance(state.scenarioParams.couponFailureRate)) {
    session.outcome = "checkout_failed"; session.checkoutId = checkoutId; session.failureCode = "coupon_rejected";
    await d.collection(COLLECTIONS.simulatedSessions).insertOne({ ...session });
    const env = (src: string, corr?: string) => ({ businessId: req.businessId, simulationRunId: runId, occurredAt: virtualNow, receivedAt: wallNow, sourceRecordId: `${runId}:${src}`, correlationId: corr });
    await ingestEvents([
      buildSimulatorEvent("web.session_started", { sessionId, device: req.device, channel: "demo_storefront" }, env(`session:${sessionId}`, sessionId)),
      buildSimulatorEvent("checkout.failed", { checkoutId, sessionId, failureCode: "coupon_rejected", device: req.device, couponCode: req.couponCode }, env(`checkout_failed:${checkoutId}`, sessionId)),
    ], { businessId: req.businessId, db: d });
    return { status: "failed", failureCode: "coupon_rejected", message: "The promo code could not be applied. Please retry without it." };
  }

  const lines: SimulatedOrderLine[] = [...quantities].map(([productId, quantity]) => {
    const p = products.get(productId)!;
    const gross = p.priceMinor * quantity;
    const percent = Math.min(100, p.discountPercent + applyPromotions(storefront, state, req.couponCode, productId, virtualNow));
    const discountMinor = Math.round((gross * percent) / 100);
    return { productId, name: p.name, quantity, unitPriceMinor: p.priceMinor, discountMinor, lineTotalMinor: gross - discountMinor };
  });
  const grossTotalMinor = lines.reduce((a, l) => a + l.unitPriceMinor * l.quantity, 0);
  const discountMinor = lines.reduce((a, l) => a + l.discountMinor, 0);
  const order: SimulatedOrder = {
    businessId: req.businessId, simulationRunId: runId, orderId, customerId, sessionId, channel: "demo_storefront", device: req.device,
    lines, grossTotalMinor, discountMinor, netRevenueMinor: grossTotalMinor - discountMinor, refundedMinor: 0, currency: "GBP",
    ...(req.couponCode && discountMinor > 0 ? { couponCode: req.couponCode } : {}),
    placedAt: virtualNow, wallClockAt: wallNow, origin: "demo_storefront", idempotencyKey: req.idempotencyKey, status: "placed",
  };
  const dispatchAt = addHours(virtualNow, rng.uniform(DISPATCH_MIN_HOURS, DISPATCH_MAX_HOURS));
  const shipment: SimulatedShipment = {
    businessId: req.businessId, simulationRunId: runId, shipmentId, orderId, customerId, status: "pending", createdAt: virtualNow,
    promisedAt: addHours(dispatchAt, STANDARD_DELIVERY_HOURS), nextTransitionAt: dispatchAt, nextStatus: "shipped", plannedOutcome: "on_time",
    reviewScheduledAt: null, refundIssued: false, orderNetMinor: order.netRevenueMinor, productIds: lines.map((l) => l.productId),
  };
  const customer: SimulatedCustomer = {
    businessId: req.businessId, simulationRunId: runId, customerId, displayName: req.shopperName ?? "Demo Shopper", preferredDevice: req.device,
    acquisitionChannel: "demo_storefront", interests: [...new Set(lines.map((l) => products.get(l.productId)!.category))],
    purchasePropensity: 0.8, priceSensitivity: 0.5, deliverySensitivity: 0.6, satisfaction: 0.8, ordersPlaced: 1, createdAt: virtualNow, lastSeenAt: virtualNow,
  };

  const stockAfter = new Map<string, { available: number; reserved: number }>();
  let failure: string | undefined;
  const mongoSession: ClientSession = client.startSession();
  try {
    await mongoSession.withTransaction(async () => {
      stockAfter.clear();
      const productsCol = d.collection<SimulatedProduct>(COLLECTIONS.simulatedProducts);
      for (const l of lines) {
        const res = await productsCol.findOneAndUpdate(
          { businessId: req.businessId, simulationRunId: runId, productId: l.productId, active: true, availableUnits: { $gte: l.quantity } },
          { $inc: { availableUnits: -l.quantity }, $set: { updatedAt: wallNow } },
          { returnDocument: "after", session: mongoSession },
        );
        if (!res) {
          failure = l.productId;
          await mongoSession.abortTransaction();
          return;
        }
        stockAfter.set(l.productId, { available: res.availableUnits, reserved: res.reservedUnits });
      }
      session.outcome = "purchased"; session.orderId = orderId;
      await d.collection(COLLECTIONS.simulatedOrders).insertOne({ ...order }, { session: mongoSession });
      await d.collection(COLLECTIONS.simulatedSessions).insertOne({ ...session }, { session: mongoSession });
      await d.collection(COLLECTIONS.simulatedShipments).insertOne({ ...shipment }, { session: mongoSession });
      await d.collection(COLLECTIONS.simulatedCustomers).insertOne({ ...customer }, { session: mongoSession });
      if (req.couponCode && storefront) {
        await d.collection(COLLECTIONS.simulatedStorefront).updateOne(
          { businessId: req.businessId, simulationRunId: runId, "promotions.promoCode": req.couponCode.toUpperCase() },
          { $inc: { "promotions.$.redemptions": 1 } }, { session: mongoSession },
        );
      }
    });
  } finally {
    await mongoSession.endSession();
  }

  if (failure) {
    session.outcome = "stockout"; session.checkoutId = checkoutId; session.failureCode = "out_of_stock"; session.customerId = "";
    await d.collection(COLLECTIONS.simulatedSessions).insertOne({ ...session });
    const env = (src: string, corr?: string) => ({ businessId: req.businessId, simulationRunId: runId, occurredAt: virtualNow, receivedAt: wallNow, sourceRecordId: `${runId}:${src}`, correlationId: corr });
    await ingestEvents([
      buildSimulatorEvent("web.session_started", { sessionId, device: req.device, channel: "demo_storefront" }, env(`session:${sessionId}`, sessionId)),
      buildSimulatorEvent("checkout.failed", { checkoutId, sessionId, failureCode: "out_of_stock", device: req.device }, env(`checkout_failed:${checkoutId}`, sessionId)),
    ], { businessId: req.businessId, db: d });
    const p = products.get(failure)!;
    return { status: "failed", failureCode: "out_of_stock", message: `${p.name} no longer has enough stock.` };
  }

  const ingest = await ingestEvents(eventsForOrder(order, session, stockAfter, shipment.promisedAt, wallNow), { businessId: req.businessId, db: d });
  return { status: "completed", order, ingest: ingest.result };
}
