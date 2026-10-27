import { z } from "zod";
import { COLLECTIONS } from "@/lib/collections";
import { ToolInputBase, type EvidenceDraft, type EvidenceTool, type ToolContext, type WindowT } from "../types";
import { cap, clampToCutoff, compact, countAndSample, dailySeries, hourlySnapshots, labelFor, measurement, occurredIn, pc, pctChange, ratio, round, scopeOf, snapshotRefs, sumCounters } from "./_shared";

export const RevenueInput = ToolInputBase.extend({
  groupBy: z.array(z.enum(["product", "category", "channel"])).max(3).default(["product", "category", "channel"]),
}).strict();
export type RevenueInputT = z.infer<typeof RevenueInput>;

interface Aggregate { sessions: number; orders: number; revenueMinor: number; refundMinor: number; conversion: number | null; aovMinor: number | null }
function aggregate(counters: ReturnType<typeof sumCounters>): Aggregate {
  return { sessions: counters.sessions ?? 0, orders: counters.orders ?? 0, revenueMinor: counters.revenueMinor ?? 0, refundMinor: counters.refundMinor ?? 0,
    conversion: ratio(counters.orders ?? 0, counters.sessions ?? 0), aovMinor: ratio(counters.revenueMinor ?? 0, counters.orders ?? 0) };
}

/** Order-level attribution: an order containing several products counts fully for each (stated in the evidence). */
async function byProduct(ctx: ToolContext, w: WindowT) {
  return ctx.db.collection(COLLECTIONS.businessEvents).aggregate<{ _id: string; orders: number; revenueMinor: number }>([
    { $match: { ...scopeOf(ctx), type: "order.completed", ...occurredIn(w) } },
    { $unwind: "$payload.productIds" },
    { $group: { _id: "$payload.productIds", orders: { $sum: 1 }, revenueMinor: { $sum: "$payload.netRevenueMinor" } } },
    { $sort: { revenueMinor: -1, _id: 1 } }, { $limit: 100 },
  ]).toArray();
}

/** Channel comes from the canonical session event the order references; orders without a session are reported separately. */
async function byChannel(ctx: ToolContext, w: WindowT) {
  return ctx.db.collection(COLLECTIONS.businessEvents).aggregate<{ _id: string; orders: number; revenueMinor: number }>([
    { $match: { ...scopeOf(ctx), type: "order.completed", ...occurredIn(w) } },
    { $lookup: { from: COLLECTIONS.businessEvents, let: { sid: "$payload.sessionId", biz: "$businessId", run: "$simulationRunId" }, pipeline: [
      { $match: { $expr: { $and: [{ $eq: ["$businessId", "$$biz"] }, { $eq: ["$simulationRunId", "$$run"] }, { $eq: ["$type", "web.session_started"] }, { $eq: ["$payload.sessionId", "$$sid"] }] } } },
      { $project: { _id: 0, channel: "$payload.channel" } }, { $limit: 1 },
    ], as: "session" } },
    { $group: { _id: { $ifNull: [{ $first: "$session.channel" }, "unlinked"] }, orders: { $sum: 1 }, revenueMinor: { $sum: "$payload.netRevenueMinor" } } },
    { $sort: { revenueMinor: -1, _id: 1 } }, { $limit: 20 },
  ]).toArray();
}

export const revenueAnalysis: EvidenceTool<RevenueInputT> = {
  name: "revenue_analysis",
  title: "Revenue analysis",
  description: "Revenue, order volume, conversion and average order value over time, by product/category/channel, decomposed against a baseline window. Reads canonical order events and persisted hourly metric snapshots.",
  category: "sales",
  dataSources: [
    { collection: COLLECTIONS.metricSnapshots, description: "persisted hourly global snapshots (sessions, orders, net revenue, refunds)", origin: "simulated" },
    { collection: COLLECTIONS.businessEvents, description: "order.completed and web.session_started canonical events", origin: "simulated" },
  ],
  input: RevenueInput,
  async run(ctx, input) {
    const window = clampToCutoff(input.window, ctx.cutoff);
    const warnings: string[] = [];
    const [curSnaps, baseSnaps] = await Promise.all([hourlySnapshots(ctx, window), input.baselineWindow ? hourlySnapshots(ctx, clampToCutoff(input.baselineWindow, ctx.cutoff)) : Promise.resolve([])]);
    if (curSnaps.length === 0) return { evidence: [], resultCount: 0, warnings: ["No complete hourly metric snapshots exist in the requested window"], emptyResult: "No persisted metrics in window" };
    const cur = aggregate(sumCounters(curSnaps));
    const base = baseSnaps.length ? aggregate(sumCounters(baseSnaps)) : null;
    const hoursCur = curSnaps.length, hoursBase = baseSnaps.length;
    if (base && hoursBase !== hoursCur) warnings.push(`Baseline covers ${hoursBase} h versus ${hoursCur} h current; per-hour rates are compared, totals are not`);
    const perHour = (a: Aggregate, h: number) => ({ revenueMinor: a.revenueMinor / h, orders: a.orders / h, sessions: a.sessions / h });
    const c = perHour(cur, hoursCur), b = base ? perHour(base, hoursBase) : null;

    // Multiplicative decomposition revenue = sessions × conversion × AOV; shares of the log change attributed to each factor.
    let decomposition: Record<string, unknown> | null = null;
    if (b && base && base.conversion && base.aovMinor && cur.conversion && cur.aovMinor && b.sessions > 0 && c.sessions > 0) {
      const lS = Math.log(c.sessions / b.sessions), lC = Math.log(cur.conversion / base.conversion), lA = Math.log(cur.aovMinor / base.aovMinor);
      const total = lS + lC + lA;
      const share = (x: number) => (total === 0 ? 0 : round(x / total, 3));
      decomposition = { method: "log-change shares of hourly revenue = sessions × conversion × average order value", totalChangePercent: pctChange(c.revenueMinor, b.revenueMinor),
        sessions: { changePercent: pctChange(c.sessions, b.sessions), share: share(lS) }, conversion: { changePercent: pctChange(cur.conversion, base.conversion), share: share(lC) },
        averageOrderValue: { changePercent: pctChange(cur.aovMinor, base.aovMinor), share: share(lA) } };
    } else if (base) warnings.push("Decomposition skipped: a factor is zero in one of the windows");

    const [products, channels, orderSample] = await Promise.all([
      input.groupBy.includes("product") || input.groupBy.includes("category") ? byProduct(ctx, window) : Promise.resolve([]),
      input.groupBy.includes("channel") ? byChannel(ctx, window) : Promise.resolve([]),
      countAndSample(ctx.db, { ...scopeOf(ctx), type: "order.completed", ...occurredIn(window) }, input.limit),
    ]);
    const baseProducts = base && products.length && input.baselineWindow ? await byProduct(ctx, clampToCutoff(input.baselineWindow, ctx.cutoff)) : [];
    const baseByProduct = new Map(baseProducts.map((p) => [p._id, p]));
    const categories = new Map<string, { orders: number; revenueMinor: number }>();
    const productRows = products.map((p) => {
      const label = labelFor(ctx, p._id);
      const cat = categories.get(label.category) ?? { orders: 0, revenueMinor: 0 };
      cat.orders += p.orders; cat.revenueMinor += p.revenueMinor; categories.set(label.category, cat);
      const prior = baseByProduct.get(p._id);
      return { productId: p._id, name: label.name, category: label.category, orders: p.orders, orderLevelRevenueMinor: p.revenueMinor,
        baselineOrdersPerHour: prior ? round(prior.orders / hoursBase, 3) : null, ordersPerHour: round(p.orders / hoursCur, 3) };
    });
    if (orderSample.count !== cur.orders) warnings.push(`Snapshot order total (${cur.orders}) differs from event count (${orderSample.count}); snapshots are hourly-complete, events are exact`);

    const observation = [
      `Over ${hoursCur} h ending ${window.endAt}: ${cur.orders} orders, net revenue £${(cur.revenueMinor / 100).toFixed(2)}, ${cur.sessions} sessions, conversion ${cur.conversion === null ? "n/a" : (cur.conversion * 100).toFixed(2) + "%"}.`,
      base && b ? `Baseline (${hoursBase} h): hourly revenue ${pc(c.revenueMinor, b.revenueMinor)} change, hourly orders ${pc(c.orders, b.orders)}, hourly sessions ${pc(c.sessions, b.sessions)}.` : "No baseline window supplied.",
      decomposition ? `Decomposition: sessions share ${(decomposition.sessions as { share: number }).share}, conversion share ${(decomposition.conversion as { share: number }).share}, AOV share ${(decomposition.averageOrderValue as { share: number }).share} of the revenue change.` : "",
      "Values are simulated business records; this describes what changed, not why.",
    ].filter(Boolean).join(" ");

    const evidence: EvidenceDraft = {
      key: "revenue:summary", category: "sales", title: "Revenue, orders and conversion versus baseline", observation, window,
      measurements: compact([
        measurement("net_revenue_minor", cur.revenueMinor, "GBP minor units", base?.revenueMinor),
        measurement("net_revenue_minor_per_hour", c.revenueMinor, "GBP minor units/hour", b?.revenueMinor),
        measurement("orders", cur.orders, "count", base?.orders), measurement("orders_per_hour", c.orders, "count/hour", b?.orders),
        measurement("sessions", cur.sessions, "count", base?.sessions), measurement("sessions_per_hour", c.sessions, "count/hour", b?.sessions),
        measurement("conversion_rate", cur.conversion, "ratio", base?.conversion), measurement("average_order_value_minor", cur.aovMinor, "GBP minor units", base?.aovMinor),
        measurement("refund_minor", cur.refundMinor, "GBP minor units", base?.refundMinor),
      ]),
      sourceRecords: [...snapshotRefs(curSnaps), ...snapshotRefs(baseSnaps), ...orderSample.sample],
      detail: {
        hours: { current: hoursCur, baseline: hoursBase }, decomposition,
        dailyRevenueMinor: dailySeries(curSnaps, (x) => x.revenueMinor), dailyOrders: dailySeries(curSnaps, (x) => x.orders),
        baselineDailyRevenueMinor: dailySeries(baseSnaps, (x) => x.revenueMinor),
        byProduct: cap(productRows, input.limit), attributionNote: "Product and channel revenue is order-level: a multi-product order counts in full for each product it contains.",
        byCategory: [...categories.entries()].map(([category, v]) => ({ category, ...v })).sort((x, y) => y.revenueMinor - x.revenueMinor),
        byChannel: channels.map((ch) => ({ channel: ch._id, orders: ch.orders, revenueMinor: ch.revenueMinor })),
        orderEventsInWindow: orderSample.count,
      },
      warnings, dataOrigin: "simulated",
    };
    return { evidence: [evidence], resultCount: curSnaps.length + products.length + channels.length, warnings };
  },
};
