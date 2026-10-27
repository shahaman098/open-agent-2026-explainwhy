import "server-only";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { DocDb } from "@/lib/docstore/client";
import { COLLECTIONS } from "@/lib/collections";
import { computeSnapshots } from "@/analytics/metrics";
import { canonicalJson } from "@/intelligence/evidence/provenance";
import { ANALYSIS_VERSION, type AnalysisFact, type AnalysisPacket, type AnalysisScopeT } from "./schema";

// Deliberately exclude analysis output tables: model writes must never trigger themselves.
export const OBSERVED_COLLECTIONS = [COLLECTIONS.businessEvents, COLLECTIONS.simulatedOrders, COLLECTIONS.simulatedCampaigns, COLLECTIONS.simulatedShipments, COLLECTIONS.simulatedProducts, COLLECTIONS.simulatorState, COLLECTIONS.incidents, COLLECTIONS.investigations] as const;
export const checksum = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

/** PostgreSQL tuple versions catch inserts, updates without updatedAt, and deletes. No raw rows enter the fingerprint. */
export async function sourceRevision(db: Db, scope: AnalysisScopeT): Promise<string> {
  const store: unknown = db;
  if (!(store instanceof DocDb)) throw new Error("Automatic dashboard analysis requires the configured Postgres document store");
  const revisions = await Promise.all(OBSERVED_COLLECTIONS.map(async name => {
    const collection = store.collection(name); await collection.ready();
    const result = await store.client.pool.query(`select count(*)::int as count, md5(coalesce(string_agg(id || ':' || xmin::text, ',' order by id), '')) as revision from ${collection.table} where doc->>'businessId' = $1 and doc->>'simulationRunId' = $2`, [scope.businessId, scope.simulationRunId]);
    return [name, result.rows[0]];
  }));
  return checksum(revisions);
}
export const packetFingerprint = (packet: AnalysisPacket, model: string) => checksum({ version: ANALYSIS_VERSION, model, packet });
const pounds = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value / 100);
const num = (value: number) => value.toLocaleString("en-GB");
const rate = (value: number | null | undefined) => value == null ? "Unavailable" : `${(value * 100).toFixed(2)}%`;

export async function buildAnalysisPacket(db: Db, scope: AnalysisScopeT): Promise<AnalysisPacket> {
  // Observable fields only. Never provide scenario names, seeded causes, latent quality or simulator parameters.
  const state = await db.collection(COLLECTIONS.simulatorState).findOne(scope, { projection: { _id: 0, virtualTime: 1, virtualStartAt: 1 } });
  if (!state?.virtualTime || !state.virtualStartAt) throw new Error("No observable run clock is available");
  const endAt = String(state.virtualTime), startMs = Math.max(Date.parse(String(state.virtualStartAt)), Date.parse(endAt) - 86_400_000);
  if (startMs >= Date.parse(endAt)) throw new Error("No completed observation window is available");
  const startAt = new Date(startMs).toISOString(), baselineMs = startMs - (Date.parse(endAt) - startMs);
  const baselineStartAt = baselineMs >= Date.parse(String(state.virtualStartAt)) ? new Date(baselineMs).toISOString() : null;
  const query = { ...scope, dimension: {}, bucket: "window" as const, virtualTime: endAt };
  const [currentRows, previousRows, campaigns, products, orders, shipments, investigations] = await Promise.all([
    computeSnapshots({ ...query, startAt, endAt }, db),
    baselineStartAt ? computeSnapshots({ ...query, startAt: baselineStartAt, endAt: startAt }, db) : Promise.resolve([]),
    db.collection(COLLECTIONS.simulatedCampaigns).find(scope, { projection: { _id: 0, campaignId: 1, status: 1, dailyBudgetMinor: 1 } }).sort({ campaignId: 1 }).toArray(),
    db.collection(COLLECTIONS.simulatedProducts).find(scope, { projection: { _id: 0, productId: 1, availableUnits: 1, priceMinor: 1 } }).sort({ productId: 1 }).toArray(),
    db.collection(COLLECTIONS.simulatedOrders).find({ ...scope, placedAt: { $gte: startAt, $lt: endAt } }, { projection: { _id: 0, orderId: 1, netRevenueMinor: 1, status: 1 } }).sort({ orderId: 1 }).toArray(),
    db.collection(COLLECTIONS.simulatedShipments).find(scope, { projection: { _id: 0, orderId: 1, status: 1 } }).sort({ orderId: 1 }).toArray(),
    db.collection(COLLECTIONS.investigations).find(scope, { projection: { _id: 0, investigationId: 1, title: 1, status: 1 } }).sort({ startedAt: -1, investigationId: 1 }).limit(8).toArray(),
  ]);
  const current = currentRows[0], previous = previousRows[0];
  if (!current) throw new Error("No canonical observations available");
  const facts: AnalysisFact[] = [];
  const add = (id: string, label: string, value: number | null | undefined, before: number | null | undefined, format: (n: number) => string, explanation: string, source: string = COLLECTIONS.businessEvents) => {
    facts.push({ id, label, current: value == null ? "Unavailable" : format(value), previous: before == null ? null : format(before), changePercent: value != null && before != null && before !== 0 ? Math.round((value / before - 1) * 1000) / 10 : null, source, explanation });
  };
  add("revenue", "Net revenue", current.counters.revenueMinor, previous?.counters.revenueMinor, pounds, "Sum of completed-order canonical events, net of order discounts; refunds are separate.");
  add("orders", "Completed orders", current.counters.orders, previous?.counters.orders, num, "Completed-order event count in equal-length windows.");
  add("sessions", "Website sessions", current.counters.sessions, previous?.counters.sessions, num, "Session-start event count; a lower count is not evidence of customer intent.");
  add("conversion", "Order conversion", current.rates.conversionRate, previous?.rates.conversionRate, rate, "Completed orders divided by sessions. Observation only; not a causal attribution.");
  add("ad_spend", "Advertising spend", current.counters.adSpendMinor, previous?.counters.adSpendMinor, pounds, "Sum of recorded campaign observations.");
  add("ctr", "Advertising click-through rate", current.rates.ctr, previous?.rates.ctr, rate, "Clicks divided by impressions across campaigns; not proof that advertising caused a revenue change.");
  add("checkout", "Checkout failures", current.counters.checkoutFailures ?? 0, previous ? previous.counters.checkoutFailures ?? 0 : null, num, "Recorded checkout.failed events, not all abandoned sessions.");
  add("coupon", "Coupon rejections", current.counters.couponFailures ?? 0, previous ? previous.counters.couponFailures ?? 0 : null, num, "Checkout failures whose recorded failure code is coupon_rejected.");
  add("deliveries", "Late delivery rate", current.rates.lateDeliveryRate, previous?.rates.lateDeliveryRate, rate, "Based on promises already due; an incomplete delivery cohort limits interpretation.");
  add("stock", "Products out of stock now", products.filter(item => item.availableUnits === 0).length, null, num, "Current inventory records; availability alone does not prove lost sales.", COLLECTIONS.simulatedProducts);
  add("budget", "Active daily campaign budgets", campaigns.filter(item => item.status === "active").reduce((sum, item) => sum + Number(item.dailyBudgetMinor), 0), null, pounds, "Configured daily budgets, not realised spend.", COLLECTIONS.simulatedCampaigns);
  add("order_ledger", "Order ledger total", orders.reduce((sum, item) => sum + Number(item.netRevenueMinor), 0), null, pounds, "Same-window order-record total. Compare with canonical net revenue to identify data inconsistencies.", COLLECTIONS.simulatedOrders);
  add("shipment_records", "Delayed shipment records now", shipments.filter(item => item.status === "delayed").length, null, num, "Current delayed status across this run, separate from the due-date cohort rate.", COLLECTIONS.simulatedShipments);
  return { scope, window: { startAt, endAt, baselineStartAt }, facts, investigations: investigations.map(item => ({ investigationId: String(item.investigationId), title: String(item.title), status: String(item.status) })), limitations: ["Synthetic operational data in GBP; public NVIDIA quarterly USD financials are excluded.", "Model interpretations suggest checks, not an accepted causal diagnosis or permission to execute an action.", baselineStartAt ? "Comparisons use the preceding equal-length window." : "No full preceding window is available; do not infer a trend."] };
}
