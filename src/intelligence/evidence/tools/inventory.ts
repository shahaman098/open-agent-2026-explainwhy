import { z } from "zod";
import { COLLECTIONS } from "@/lib/collections";
import { MAX_ENTITY_IDS, ToolInputBase, type EvidenceDraft, type EvidenceTool, type ToolContext, type WindowT } from "../types";
import { cap, clampToCutoff, compact, countAndSample, labelFor, measurement, occurredIn, round, scopeOf } from "./_shared";

export const InventoryInput = ToolInputBase.extend({
  productIds: z.array(z.string().min(1).max(64)).max(MAX_ENTITY_IDS).default([]),
}).strict();
export type InventoryInputT = z.infer<typeof InventoryInput>;

interface LevelRow { _id: string; first: number; last: number; min: number; changes: number; stockoutEvents: number; lastEventId: string; lastAt: string }
async function levels(ctx: ToolContext, w: WindowT, productIds: string[]) {
  return ctx.db.collection(COLLECTIONS.businessEvents).aggregate<LevelRow>([
    { $match: { ...scopeOf(ctx), type: "inventory.level_changed", occurredAt: { $lt: w.endAt }, ...(productIds.length ? { "payload.productId": { $in: productIds } } : {}) } },
    { $sort: { occurredAt: 1, eventId: 1 } },
    { $group: { _id: "$payload.productId", last: { $last: "$payload.availableUnits" }, lastEventId: { $last: "$eventId" }, lastAt: { $last: "$occurredAt" },
      inWindow: { $push: { $cond: [{ $gte: ["$occurredAt", w.startAt] }, { u: "$payload.availableUnits" }, "$$REMOVE"] } } } },
    { $project: { last: 1, lastEventId: 1, lastAt: 1, changes: { $size: "$inWindow" }, first: { $ifNull: [{ $first: "$inWindow.u" }, "$last"] }, min: { $ifNull: [{ $min: "$inWindow.u" }, "$last"] },
      stockoutEvents: { $size: { $filter: { input: "$inWindow", as: "e", cond: { $eq: ["$$e.u", 0] } } } } } },
    { $sort: { last: 1, _id: 1 } }, { $limit: 100 },
  ]).toArray();
}

async function demand(ctx: ToolContext, w: WindowT, productIds: string[]) {
  const rows = await ctx.db.collection(COLLECTIONS.businessEvents).aggregate<{ _id: string; orders: number }>([
    { $match: { ...scopeOf(ctx), type: "order.completed", ...occurredIn(w) } }, { $unwind: "$payload.productIds" },
    ...(productIds.length ? [{ $match: { "payload.productIds": { $in: productIds } } }] : []),
    { $group: { _id: "$payload.productIds", orders: { $sum: 1 } } }, { $limit: 100 },
  ]).toArray();
  return new Map(rows.map((r) => [r._id, r.orders]));
}

export const inventoryAnalysis: EvidenceTool<InventoryInputT> = {
  name: "inventory_analysis",
  title: "Inventory analysis",
  description: "Available inventory at the window end, stockout events, depletion during the window and order velocity versus baseline per product. Reads canonical inventory.level_changed, order.completed and out-of-stock checkout.failed events.",
  category: "inventory",
  dataSources: [
    { collection: COLLECTIONS.businessEvents, description: "inventory.level_changed canonical events (available/reserved units)", origin: "simulated" },
    { collection: COLLECTIONS.businessEvents, description: "order.completed product lines and checkout.failed with failureCode out_of_stock", origin: "simulated" },
  ],
  input: InventoryInput,
  async run(ctx, input) {
    const window = clampToCutoff(input.window, ctx.cutoff);
    const baseline = input.baselineWindow ? clampToCutoff(input.baselineWindow, ctx.cutoff) : null;
    const warnings: string[] = [];
    const hc = Math.max(1, (Date.parse(window.endAt) - Date.parse(window.startAt)) / 3_600_000), hb = baseline ? Math.max(1, (Date.parse(baseline.endAt) - Date.parse(baseline.startAt)) / 3_600_000) : 1;
    const [rows, curDemand, baseDemand, stockoutFailures, sample] = await Promise.all([
      levels(ctx, window, input.productIds), demand(ctx, window, input.productIds), baseline ? demand(ctx, baseline, input.productIds) : Promise.resolve(new Map<string, number>()),
      countAndSample(ctx.db, { ...scopeOf(ctx), type: "checkout.failed", "payload.failureCode": "out_of_stock", ...occurredIn(window) }, Math.min(input.limit, 25)),
      countAndSample(ctx.db, { ...scopeOf(ctx), type: "inventory.level_changed", ...occurredIn(window), ...(input.productIds.length ? { "payload.productId": { $in: input.productIds } } : {}) }, input.limit),
    ]);
    if (rows.length === 0) return { evidence: [], resultCount: 0, warnings: ["No inventory level events recorded for the requested products before the window end"], emptyResult: "No inventory observations" };
    const products = rows.map((r) => {
      const label = labelFor(ctx, r._id);
      const cur = curDemand.get(r._id) ?? 0, base = baseline ? baseDemand.get(r._id) ?? 0 : null;
      return { productId: r._id, name: label.name, category: label.category, availableUnitsAtWindowEnd: r.last, availableUnitsAtWindowStart: r.first, minimumUnitsInWindow: r.min,
        depletionUnits: r.first - r.last, levelChangesInWindow: r.changes, stockoutEventsInWindow: r.stockoutEvents, lastLevelEventId: r.lastEventId, lastLevelAt: r.lastAt,
        ordersPerHour: round(cur / hc, 3), baselineOrdersPerHour: base === null ? null : round(base / hb, 3),
        projectedHoursToStockout: cur > 0 && r.last > 0 ? round(r.last / (cur / hc), 1) : null };
    });
    const stockedOut = products.filter((p) => p.availableUnitsAtWindowEnd === 0), lowStock = products.filter((p) => p.projectedHoursToStockout !== null && p.projectedHoursToStockout < 72);
    const totalDepletion = products.reduce((a, p) => a + Math.max(0, p.depletionUnits), 0);
    warnings.push("A low or zero stock level shows availability, not proof that sales were lost; lost-sale evidence requires out_of_stock checkout failures or demand that exceeded supply.");

    const observation = [
      `${products.length} product(s) observed to ${window.endAt}: ${stockedOut.length} at zero available units, ${lowStock.length} projected to run out within 72 h at current velocity, ${totalDepletion} units depleted in the ${hc} h window, ${stockoutFailures.count} out-of-stock checkout failures.`,
      stockedOut.length ? `Out of stock: ${stockedOut.map((p) => p.name).join(", ")}.` : "No product is currently out of stock.",
      "Simulated inventory records derived from canonical inventory.level_changed events.",
    ].join(" ");

    const evidence: EvidenceDraft = {
      key: "inventory:levels", category: "inventory", title: "Inventory levels, depletion and demand velocity", observation, window,
      measurements: compact([
        measurement("products_observed", products.length, "count"), measurement("products_out_of_stock", stockedOut.length, "count"),
        measurement("products_at_risk_72h", lowStock.length, "count"), measurement("units_depleted_in_window", totalDepletion, "units"),
        measurement("out_of_stock_checkout_failures", stockoutFailures.count, "count"), measurement("inventory_level_events_in_window", sample.count, "count"),
      ]),
      sourceRecords: [...products.map((p) => ({ collection: COLLECTIONS.businessEvents, recordId: p.lastLevelEventId })), ...sample.sample, ...stockoutFailures.sample],
      detail: { hours: { current: hc, baseline: baseline ? hb : null }, products: cap(products, input.limit), outOfStock: stockedOut.map((p) => p.productId), atRisk72h: lowStock.map((p) => p.productId) },
      warnings, dataOrigin: "simulated",
    };
    return { evidence: [evidence], resultCount: products.length, warnings };
  },
};
