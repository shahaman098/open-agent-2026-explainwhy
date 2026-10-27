import { z } from "zod";
import { COLLECTIONS } from "@/lib/collections";
import { ToolInputBase, type EvidenceDraft, type EvidenceTool, type ToolContext, type WindowT } from "../types";
import { cap, clampToCutoff, compact, countAndSample, dailySeries, hourlySnapshots, measurement, occurredIn, pc, ratio, round, scopeOf, snapshotRefs, sumCounters } from "./_shared";

export const ShippingInput = ToolInputBase.extend({}).strict();
export type ShippingInputT = z.infer<typeof ShippingInput>;

async function statusCounts(ctx: ToolContext, w: WindowT) {
  const rows = await ctx.db.collection(COLLECTIONS.businessEvents).aggregate<{ _id: string; n: number; orders: number; avgDelayMinutes: number | null }>([
    { $match: { ...scopeOf(ctx), type: "delivery.status_changed", ...occurredIn(w) } },
    { $group: { _id: "$payload.status", n: { $sum: 1 }, orderSet: { $addToSet: "$payload.orderId" }, avgDelayMinutes: { $avg: "$payload.delayMinutes" } } },
    { $project: { n: 1, avgDelayMinutes: 1, orders: { $size: "$orderSet" } } }, { $limit: 10 },
  ]).toArray();
  return Object.fromEntries(rows.map((r) => [r._id, { events: r.n, orders: r.orders, avgDelayMinutes: r.avgDelayMinutes === null ? null : round(r.avgDelayMinutes, 0) }]));
}

/** Shipped orders whose promise has passed before the cutoff and that have no delivered event yet: the open backlog. */
async function openBacklog(ctx: ToolContext, cutoff: string, limit: number) {
  const [result] = await ctx.db.collection(COLLECTIONS.businessEvents).aggregate<{ total: Array<{ count: number }>; rows: Array<{ orderId: string; eventId: string; promisedAt: string }> }>([
    { $match: { ...scopeOf(ctx), type: "delivery.status_changed", occurredAt: { $lt: cutoff }, "payload.status": "shipped", "payload.promisedAt": { $lt: cutoff } } },
    { $lookup: { from: COLLECTIONS.businessEvents, let: { oid: "$payload.orderId", biz: "$businessId", run: "$simulationRunId" }, pipeline: [
      { $match: { $expr: { $and: [{ $lt: ["$occurredAt", cutoff] }, { $eq: ["$businessId", "$$biz"] }, { $eq: ["$simulationRunId", "$$run"] }, { $eq: ["$payload.orderId", "$$oid"] }, { $eq: ["$type", "delivery.status_changed"] }, { $in: ["$payload.status", ["delivered", "lost"]] }] } } },
      { $limit: 1 }, { $project: { _id: 0, status: "$payload.status" } }], as: "terminal" } },
    { $match: { terminal: { $size: 0 } } },
    { $group: { _id: "$payload.orderId", eventId: { $first: "$eventId" }, promisedAt: { $min: "$payload.promisedAt" } } },
    { $facet: {
      total: [{ $count: "count" }],
      rows: [{ $sort: { promisedAt: 1, _id: 1 } }, { $limit: Math.min(limit, 200) },
        { $project: { _id: 0, orderId: "$_id", eventId: 1, promisedAt: 1 } }],
    } },
  ]).toArray();
  return { count: result?.total[0]?.count ?? 0, rows: result?.rows ?? [] };
}

export const shippingAnalysis: EvidenceTool<ShippingInputT> = {
  name: "shipping_analysis",
  title: "Shipping analysis",
  description: "Due-date cohort late-delivery rate versus baseline, delivery status transitions, lost parcels, average recorded delay and the open backlog past promise. Uses the existing cohort-aware shipping metrics; never an event-ratio delay rate.",
  category: "fulfillment",
  dataSources: [
    { collection: COLLECTIONS.metricSnapshots, description: "persisted hourly global snapshots: shipments due (promise in hour) and delayedShipments (not delivered by promise)", origin: "simulated" },
    { collection: COLLECTIONS.businessEvents, description: "delivery.status_changed canonical events (shipped, delivered, delayed, lost)", origin: "simulated" },
  ],
  input: ShippingInput,
  async run(ctx, input) {
    const window = clampToCutoff(input.window, ctx.cutoff);
    const baseline = input.baselineWindow ? clampToCutoff(input.baselineWindow, ctx.cutoff) : null;
    const warnings: string[] = [];
    const [curSnaps, baseSnaps, curStatus, baseStatus, delayedSample, backlog] = await Promise.all([
      hourlySnapshots(ctx, window), baseline ? hourlySnapshots(ctx, baseline) : Promise.resolve([]), statusCounts(ctx, window), baseline ? statusCounts(ctx, baseline) : Promise.resolve({}),
      countAndSample(ctx.db, { ...scopeOf(ctx), type: "delivery.status_changed", "payload.status": { $in: ["delayed", "lost"] }, ...occurredIn(window) }, input.limit),
      openBacklog(ctx, ctx.cutoff, input.limit),
    ]);
    if (curSnaps.length === 0 && delayedSample.count === 0 && backlog.count === 0) return { evidence: [], resultCount: 0, warnings: ["No shipping observations in the requested window"], emptyResult: "No delivery activity in window" };
    const cur = sumCounters(curSnaps), base = sumCounters(baseSnaps);
    const curRate = ratio(cur.delayedShipments ?? 0, cur.shipments ?? 0), baseRate = baseSnaps.length ? ratio(base.delayedShipments ?? 0, base.shipments ?? 0) : null;
    if ((cur.shipments ?? 0) === 0) warnings.push("No delivery promises fell due inside the window; the cohort late rate is undefined rather than zero");
    if ((cur.shipments ?? 0) > 0 && (cur.shipments ?? 0) < 20) warnings.push(`Only ${cur.shipments} promises matured in the window; the late rate is statistically weak`);
    if (!baseline) warnings.push("No baseline window supplied");
    const delayed = curStatus.delayed ?? { events: 0, orders: 0, avgDelayMinutes: null }, lost = curStatus.lost ?? { events: 0, orders: 0, avgDelayMinutes: null };

    const observation = [
      `Cohort of ${cur.shipments ?? 0} promises due in the ${curSnaps.length} h ending ${window.endAt}: ${cur.delayedShipments ?? 0} not delivered by promise (late rate ${curRate === null ? "undefined" : (curRate * 100).toFixed(1) + "%"}).`,
      baseline ? `Baseline late rate ${baseRate === null ? "undefined" : (baseRate * 100).toFixed(1) + "%"} on ${base.shipments ?? 0} promises (${pc(curRate, baseRate)} change).` : "",
      `${delayed.orders} order(s) received a delayed status${delayed.avgDelayMinutes !== null ? ` (average recorded delay ${delayed.avgDelayMinutes} min)` : ""}, ${lost.orders} lost; ${backlog.count} shipped order(s) are past promise with no delivered or lost event at the cutoff.`,
      "Simulated fulfilment records; cohort membership is by promise due date, so immature promises never read as healthy.",
    ].filter(Boolean).join(" ");

    const evidence: EvidenceDraft = {
      key: "shipping:cohort", category: "fulfillment", title: "Delivery promise cohort and delayed orders", observation, window,
      measurements: compact([
        measurement("promises_due", cur.shipments ?? 0, "count", baseSnaps.length ? base.shipments ?? 0 : undefined),
        measurement("late_deliveries", cur.delayedShipments ?? 0, "count", baseSnaps.length ? base.delayedShipments ?? 0 : undefined),
        measurement("late_delivery_rate", curRate, "ratio", baseRate), measurement("orders_marked_delayed", delayed.orders, "count", baseline ? (baseStatus as Record<string, { orders: number }>).delayed?.orders ?? 0 : undefined),
        measurement("orders_lost", lost.orders, "count", baseline ? (baseStatus as Record<string, { orders: number }>).lost?.orders ?? 0 : undefined),
        measurement("average_recorded_delay_minutes", delayed.avgDelayMinutes, "minutes"), measurement("open_backlog_past_promise", backlog.count, "count"),
      ]),
      sourceRecords: [...snapshotRefs(curSnaps), ...snapshotRefs(baseSnaps), ...delayedSample.sample, ...backlog.rows.map((b) => ({ collection: COLLECTIONS.businessEvents, recordId: b.eventId }))],
      detail: { hours: { current: curSnaps.length, baseline: baseSnaps.length || null }, statusTransitions: curStatus, baselineStatusTransitions: baseStatus,
        dailyPromisesDue: dailySeries(curSnaps, (c) => c.shipments), dailyLate: dailySeries(curSnaps, (c) => c.delayedShipments),
        backlogPastPromise: cap(backlog.rows, input.limit), delayedOrLostEventsInWindow: delayedSample.count },
      warnings, dataOrigin: "simulated",
    };
    return { evidence: [evidence], resultCount: curSnaps.length + backlog.count + delayedSample.count, warnings };
  },
};
