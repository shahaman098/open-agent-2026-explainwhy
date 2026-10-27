import "server-only";

import type { AnyBulkWriteOperation, Db, MongoBulkWriteError } from "mongodb";
import { COLLECTIONS } from "@/lib/collections";
import { ingestEvents } from "@/ingestion/service";
import type { SimulatorStateDoc, TickOutput, World } from "@/simulator/state";
import type {
  SimulatedCampaign, SimulatedCustomer, SimulatedOrder, SimulatedProduct, SimulatedReview, SimulatedSession,
  SimulatedShipment, SimulatedStorefront,
} from "@/types/domain";

export class StockConflictError extends Error {
  override name = "StockConflictError";
}

const runFilter = (businessId: string, simulationRunId: string) => ({ businessId, simulationRunId });

export async function loadState(db: Db, businessId: string, simulationRunId: string): Promise<SimulatorStateDoc | null> {
  return db.collection<SimulatorStateDoc>(COLLECTIONS.simulatorState).findOne(runFilter(businessId, simulationRunId), { projection: { _id: 0 } });
}

/** Loads the full mutable world for a run from MongoDB. */
export async function loadWorld(db: Db, state: SimulatorStateDoc): Promise<World> {
  const f = runFilter(state.businessId, state.simulationRunId);
  const noId = { projection: { _id: 0 } } as const;
  const [products, campaigns, customers, shipments, storefront] = await Promise.all([
    db.collection<SimulatedProduct>(COLLECTIONS.simulatedProducts).find(f, noId).sort({ productId: 1 }).toArray(),
    db.collection<SimulatedCampaign>(COLLECTIONS.simulatedCampaigns).find(f, noId).sort({ campaignId: 1 }).toArray(),
    db.collection<SimulatedCustomer>(COLLECTIONS.simulatedCustomers).find(f, noId).sort({ customerId: 1 }).toArray(),
    db.collection<SimulatedShipment>(COLLECTIONS.simulatedShipments)
      .find({ ...f, $or: [{ nextTransitionAt: { $ne: null } }, { reviewScheduledAt: { $ne: null } }] }, noId)
      .sort({ shipmentId: 1 }).toArray(),
    db.collection<SimulatedStorefront>(COLLECTIONS.simulatedStorefront).findOne(f, noId),
  ]);
  return {
    state, products: new Map(products.map((p) => [p.productId, p])), campaigns: new Map(campaigns.map((c) => [c.campaignId, c])),
    customers: new Map(customers.map((c) => [c.customerId, c])), shipments, storefront,
  };
}

/** Writes a freshly bootstrapped world. */
export async function persistInitialWorld(db: Db, world: World): Promise<void> {
  const { state } = world;
  await db.collection(COLLECTIONS.simulatorState).insertOne({ ...state });
  if (world.products.size) await db.collection(COLLECTIONS.simulatedProducts).insertMany([...world.products.values()].map((p) => ({ ...p })));
  if (world.campaigns.size) await db.collection(COLLECTIONS.simulatedCampaigns).insertMany([...world.campaigns.values()].map((c) => ({ ...c })));
  if (world.customers.size) await db.collection(COLLECTIONS.simulatedCustomers).insertMany([...world.customers.values()].map((c) => ({ ...c })));
  if (world.storefront) await db.collection(COLLECTIONS.simulatedStorefront).insertOne({ ...world.storefront });
}

/** Deletes every record belonging to one run (and only that run). */
export async function deleteRun(db: Db, businessId: string, simulationRunId: string): Promise<void> {
  const f = runFilter(businessId, simulationRunId);
  await Promise.all([
    COLLECTIONS.simulatorState, COLLECTIONS.simulatedProducts, COLLECTIONS.simulatedCampaigns, COLLECTIONS.simulatedCustomers,
    COLLECTIONS.simulatedSessions, COLLECTIONS.simulatedOrders, COLLECTIONS.simulatedShipments, COLLECTIONS.simulatedReviews,
    COLLECTIONS.simulatedStorefront, COLLECTIONS.simulatedMessages, COLLECTIONS.businessEvents, COLLECTIONS.metricSnapshots,
    COLLECTIONS.actionReceipts, COLLECTIONS.anomalies, COLLECTIONS.investigations, COLLECTIONS.diagnoses, COLLECTIONS.detectionFindings,
    COLLECTIONS.detectionObservations, COLLECTIONS.incidents, COLLECTIONS.monitorRuns, COLLECTIONS.monitorState,
    COLLECTIONS.monitoringWindows, COLLECTIONS.monitoringJobs,
    COLLECTIONS.evidence, COLLECTIONS.evidenceDetails, COLLECTIONS.evidenceCollections, COLLECTIONS.evidenceToolRuns,
    COLLECTIONS.planningJobs, COLLECTIONS.plans, COLLECTIONS.planApprovals, COLLECTIONS.agentRuns, COLLECTIONS.agentMissions, COLLECTIONS.actionExecutions, COLLECTIONS.actionOutcomes,
    COLLECTIONS.investigationJobs, COLLECTIONS.investigationCalls, COLLECTIONS.investigationReports, COLLECTIONS.externalSources,
  ].map((c) => db.collection(c).deleteMany(f)));
  await db.collection(COLLECTIONS.simulatorGroundTruth).deleteMany({ simulationRunId });
}

function ignoreDuplicates(error: unknown): void {
  const bulk = error as MongoBulkWriteError;
  if (bulk && typeof bulk === "object" && "writeErrors" in bulk) {
    const errors = Array.isArray(bulk.writeErrors) ? bulk.writeErrors : [bulk.writeErrors];
    if (errors.every((e) => e.code === 11000)) return;
  }
  throw error;
}

async function insertIgnoringDuplicates<T extends object>(db: Db, collection: string, docs: T[]): Promise<void> {
  if (docs.length === 0) return;
  try {
    await db.collection(collection).insertMany(docs.map((d) => ({ ...d })), { ordered: false });
  } catch (error) {
    ignoreDuplicates(error);
  }
}

/**
 * Applies the inventory consumption of a tick atomically. Each product is
 * decremented only if enough stock remains; a failure means a concurrent
 * storefront purchase drained the stock and the caller must regenerate the tick
 * from a fresh world.
 */
export async function applyStockDecrements(db: Db, businessId: string, simulationRunId: string, unitsConsumed: Map<string, number>, updatedAt: string): Promise<void> {
  const products = db.collection<SimulatedProduct>(COLLECTIONS.simulatedProducts);
  const applied: Array<[string, number]> = [];
  for (const [productId, units] of unitsConsumed) {
    if (units <= 0) continue;
    const res = await products.updateOne(
      { businessId, simulationRunId, productId, availableUnits: { $gte: units } },
      { $inc: { availableUnits: -units }, $set: { updatedAt } },
    );
    if (res.matchedCount === 0) {
      // Roll back what this call already applied, then signal a conflict.
      for (const [pid, u] of applied) {
        await products.updateOne({ businessId, simulationRunId, productId: pid }, { $inc: { availableUnits: u } });
      }
      throw new StockConflictError(`Insufficient stock for ${productId} (${units} units) at persistence time`);
    }
    applied.push([productId, units]);
  }
}

/**
 * Persists everything a batch of ticks produced. Events go through the central
 * ingestion service. Writes are idempotent (deterministic IDs + upserts) so a
 * retried batch cannot double count.
 */
export async function persistTickOutputs(db: Db, world: World, outputs: TickOutput[], receivedAt: string): Promise<{ accepted: number; duplicates: number; rejected: number; eventIds: string[] }> {
  const { state } = world;
  const f = runFilter(state.businessId, state.simulationRunId);

  // 1. Inventory first (fails fast on a concurrent stock conflict).
  const consumed = new Map<string, number>();
  for (const o of outputs) for (const [pid, u] of o.unitsConsumed) consumed.set(pid, (consumed.get(pid) ?? 0) + u);
  await applyStockDecrements(db, state.businessId, state.simulationRunId, consumed, receivedAt);

  // 2. Domain records.
  await insertIgnoringDuplicates<SimulatedSession>(db, COLLECTIONS.simulatedSessions, outputs.flatMap((o) => o.sessions));
  await insertIgnoringDuplicates<SimulatedOrder>(db, COLLECTIONS.simulatedOrders, outputs.flatMap((o) => o.orders));
  await insertIgnoringDuplicates<SimulatedReview>(db, COLLECTIONS.simulatedReviews, outputs.flatMap((o) => o.reviews));

  const refundOps: AnyBulkWriteOperation<SimulatedOrder>[] = outputs.flatMap((o) => o.orderRefunds).map((r) => ({
    updateOne: { filter: { businessId: state.businessId, orderId: r.orderId }, update: { $set: { refundedMinor: r.refundedMinor, status: r.status } } },
  }));
  if (refundOps.length) await db.collection<SimulatedOrder>(COLLECTIONS.simulatedOrders).bulkWrite(refundOps, { ordered: false });

  const touchedCustomers = new Set<string>();
  for (const o of outputs) { for (const id of o.touchedCustomerIds) touchedCustomers.add(id); for (const c of o.newCustomers) touchedCustomers.add(c.customerId); }
  const customerOps: AnyBulkWriteOperation<SimulatedCustomer>[] = [...touchedCustomers].flatMap((id) => {
    const c = world.customers.get(id);
    return c ? [{ replaceOne: { filter: { ...f, customerId: id }, replacement: { ...c }, upsert: true } }] : [];
  });
  if (customerOps.length) await db.collection<SimulatedCustomer>(COLLECTIONS.simulatedCustomers).bulkWrite(customerOps, { ordered: false });

  const touchedShipments = new Set<string>();
  for (const o of outputs) { for (const id of o.updatedShipmentIds) touchedShipments.add(id); for (const s of o.newShipments) touchedShipments.add(s.shipmentId); }
  const shipmentOps: AnyBulkWriteOperation<SimulatedShipment>[] = world.shipments
    .filter((s) => touchedShipments.has(s.shipmentId))
    .map((s) => ({ replaceOne: { filter: { businessId: state.businessId, orderId: s.orderId }, replacement: { ...s }, upsert: true } }));
  if (shipmentOps.length) await db.collection<SimulatedShipment>(COLLECTIONS.simulatedShipments).bulkWrite(shipmentOps, { ordered: false });

  // Campaigns: only engine-owned fields, so partner budget/status changes are never clobbered.
  const touchedCampaigns = new Set<string>();
  for (const o of outputs) for (const id of o.touchedCampaignIds) touchedCampaigns.add(id);
  const campaignOps: AnyBulkWriteOperation<SimulatedCampaign>[] = [...touchedCampaigns].flatMap((id) => {
    const c = world.campaigns.get(id);
    return c ? [{ updateOne: { filter: { ...f, campaignId: id }, update: { $set: {
      rollingImpressions: c.rollingImpressions, totals: c.totals, budgetSpentTodayMinor: c.budgetSpentTodayMinor,
      budgetDay: c.budgetDay, updatedAt: c.updatedAt,
    } } } }] : [];
  });
  if (campaignOps.length) await db.collection<SimulatedCampaign>(COLLECTIONS.simulatedCampaigns).bulkWrite(campaignOps, { ordered: false });

  // Drop terminal, fully-processed shipments from the in-memory working set.
  world.shipments = world.shipments.filter((s) => s.nextTransitionAt !== null || s.reviewScheduledAt);

  // 3. Canonical events through the shared ingestion path.
  const ingest = await ingestEvents(outputs.flatMap((o) => o.events), { businessId: state.businessId, db });

  // 4. Engine-owned state fields only (storefront counter and scenario fields are owned elsewhere).
  await db.collection<SimulatorStateDoc>(COLLECTIONS.simulatorState).updateOne(f, { $set: {
    virtualTime: state.virtualTime, tickIndex: state.tickIndex, rng: state.rng, counters: state.counters,
    totals: state.totals, updatedAt: receivedAt, status: state.status,
  } });

  return ingest.result;
}
