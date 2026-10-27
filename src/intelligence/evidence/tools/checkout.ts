import { z } from "zod";
import { COLLECTIONS } from "@/lib/collections";
import { ToolInputBase, type EvidenceDraft, type EvidenceTool, type ToolContext, type WindowT } from "../types";
import { cap, clampToCutoff, compact, countAndSample, hourlySnapshots, measurement, occurredIn, pc, ratio, round, scopeOf, snapshotRefs, sumCounters } from "./_shared";

export const CheckoutInput = ToolInputBase.extend({}).strict();
export type CheckoutInputT = z.infer<typeof CheckoutInput>;

interface Slice { sessions: number; orders: number; failures: number }
async function slices(ctx: ToolContext, w: WindowT, field: "device" | "channel") {
  const events = ctx.db.collection(COLLECTIONS.businessEvents);
  const [sessions, failures, orders] = await Promise.all([
    events.aggregate<{ _id: string; n: number }>([{ $match: { ...scopeOf(ctx), type: "web.session_started", ...occurredIn(w) } }, { $group: { _id: `$payload.${field}`, n: { $sum: 1 } } }, { $limit: 20 }]).toArray(),
    field === "device" ? events.aggregate<{ _id: string; n: number }>([{ $match: { ...scopeOf(ctx), type: "checkout.failed", ...occurredIn(w) } }, { $group: { _id: "$payload.device", n: { $sum: 1 } } }, { $limit: 20 }]).toArray() : Promise.resolve([]),
    // Orders carry no device/channel; join the canonical session they reference.
    events.aggregate<{ _id: string; n: number }>([
      { $match: { ...scopeOf(ctx), type: "order.completed", ...occurredIn(w) } },
      { $lookup: { from: COLLECTIONS.businessEvents, let: { sid: "$payload.sessionId", biz: "$businessId", run: "$simulationRunId" }, pipeline: [
        { $match: { $expr: { $and: [{ $eq: ["$businessId", "$$biz"] }, { $eq: ["$simulationRunId", "$$run"] }, { $eq: ["$type", "web.session_started"] }, { $eq: ["$payload.sessionId", "$$sid"] }] } } },
        { $project: { _id: 0, v: `$payload.${field}` } }, { $limit: 1 }], as: "s" } },
      { $group: { _id: { $ifNull: [{ $first: "$s.v" }, "unlinked"] }, n: { $sum: 1 } } }, { $limit: 20 },
    ]).toArray(),
  ]);
  const out = new Map<string, Slice>();
  const get = (k: string) => { const v = out.get(k) ?? { sessions: 0, orders: 0, failures: 0 }; out.set(k, v); return v; };
  for (const s of sessions) get(s._id).sessions = s.n;
  for (const o of orders) get(o._id).orders = o.n;
  for (const f of failures) get(f._id).failures = f.n;
  return [...out.entries()].map(([key, v]) => ({ [field]: key, ...v, conversionRate: ratio(v.orders, v.sessions) })).sort((a, b) => b.sessions - a.sessions);
}

export const checkoutAnalysis: EvidenceTool<CheckoutInputT> = {
  name: "checkout_analysis",
  title: "Checkout and conversion analysis",
  description: "Session volume, conversion rate, checkout failures by failure code and device, and purchase completion before versus after. Reads canonical session, checkout.failed and order events plus hourly snapshots.",
  category: "technical",
  dataSources: [
    { collection: COLLECTIONS.businessEvents, description: "web.session_started, checkout.failed and order.completed canonical events", origin: "simulated" },
    { collection: COLLECTIONS.metricSnapshots, description: "persisted hourly global snapshots (sessions, orders)", origin: "simulated" },
  ],
  input: CheckoutInput,
  async run(ctx, input) {
    const window = clampToCutoff(input.window, ctx.cutoff);
    const baseline = input.baselineWindow ? clampToCutoff(input.baselineWindow, ctx.cutoff) : null;
    const warnings: string[] = [];
    const events = ctx.db.collection(COLLECTIONS.businessEvents);
    const codes = (w: WindowT) => events.aggregate<{ _id: string; n: number }>([{ $match: { ...scopeOf(ctx), type: "checkout.failed", ...occurredIn(w) } }, { $group: { _id: "$payload.failureCode", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 20 }]).toArray();
    const [curSnaps, baseSnaps, curCodes, baseCodes, byDevice, byChannel, failureSample, sessionSample] = await Promise.all([
      hourlySnapshots(ctx, window), baseline ? hourlySnapshots(ctx, baseline) : Promise.resolve([]), codes(window), baseline ? codes(baseline) : Promise.resolve([]),
      slices(ctx, window, "device"), slices(ctx, window, "channel"),
      countAndSample(ctx.db, { ...scopeOf(ctx), type: "checkout.failed", ...occurredIn(window) }, input.limit),
      countAndSample(ctx.db, { ...scopeOf(ctx), type: "web.session_started", ...occurredIn(window) }, Math.min(input.limit, 25)),
    ]);
    if (curSnaps.length === 0 && sessionSample.count === 0) return { evidence: [], resultCount: 0, warnings: ["No sessions or snapshots in the requested window"], emptyResult: "No checkout activity in window" };
    const cur = sumCounters(curSnaps), base = sumCounters(baseSnaps);
    const hc = Math.max(1, curSnaps.length), hb = Math.max(1, baseSnaps.length);
    const curFailures = curCodes.reduce((a, c) => a + c.n, 0), baseFailures = baseCodes.reduce((a, c) => a + c.n, 0);
    const curConv = ratio(cur.orders ?? 0, cur.sessions ?? 0), baseConv = baseSnaps.length ? ratio(base.orders ?? 0, base.sessions ?? 0) : null;
    const curFailRate = ratio(curFailures, (cur.sessions ?? 0)), baseFailRate = baseSnaps.length ? ratio(baseFailures, base.sessions ?? 0) : null;
    if (curFailures === 0) warnings.push("No checkout.failed events were recorded in the current window; a zero failure count is a genuine observation, not missing data, only if sessions were recorded");
    if (!baseline) warnings.push("No baseline window supplied; before-versus-after comparison not computed");
    const baseByCode = new Map(baseCodes.map((c) => [c._id, c.n]));

    const observation = [
      `${cur.sessions ?? 0} sessions and ${cur.orders ?? 0} orders over ${hc} h ending ${window.endAt} (conversion ${curConv === null ? "n/a" : (curConv * 100).toFixed(2) + "%"}); ${curFailures} checkout failures (${curFailRate === null ? "n/a" : (curFailRate * 100).toFixed(2) + "% of sessions"}).`,
      baseline ? `Baseline: conversion ${baseConv === null ? "n/a" : (baseConv * 100).toFixed(2) + "%"} (${pc(curConv, baseConv)} change), failures per hour ${pc(curFailures / hc, baseFailures / hb)} change, sessions per hour ${pc((cur.sessions ?? 0) / hc, (base.sessions ?? 0) / hb)} change.` : "",
      curCodes.length ? `Failure codes: ${curCodes.map((c) => `${c._id} ×${c.n}`).join(", ")}.` : "",
      "Simulated storefront records; device and channel slices join orders to their canonical session.",
    ].filter(Boolean).join(" ");

    const evidence: EvidenceDraft = {
      key: "checkout:conversion", category: "technical", title: "Sessions, conversion and checkout failures", observation, window,
      measurements: compact([
        measurement("sessions_per_hour", (cur.sessions ?? 0) / hc, "count/hour", baseSnaps.length ? (base.sessions ?? 0) / hb : undefined),
        measurement("orders_per_hour", (cur.orders ?? 0) / hc, "count/hour", baseSnaps.length ? (base.orders ?? 0) / hb : undefined),
        measurement("conversion_rate", curConv, "ratio", baseConv), measurement("checkout_failures", curFailures, "count", baseline ? baseFailures : undefined),
        measurement("checkout_failures_per_hour", curFailures / hc, "count/hour", baseline ? baseFailures / hb : undefined),
        measurement("checkout_failure_rate", curFailRate, "ratio", baseFailRate),
      ]),
      sourceRecords: [...snapshotRefs(curSnaps), ...snapshotRefs(baseSnaps), ...failureSample.sample, ...sessionSample.sample],
      detail: { hours: { current: hc, baseline: baseline ? hb : null },
        failureCodes: curCodes.map((c) => ({ code: c._id, count: c.n, baselineCount: baseline ? baseByCode.get(c._id) ?? 0 : null })),
        byDevice: cap(byDevice, 20), byChannel: cap(byChannel, 20), failureEventsInWindow: failureSample.count, sessionEventsInWindow: sessionSample.count,
        conversionRatePerHour: round(curConv ?? 0, 4) },
      warnings, dataOrigin: "simulated",
    };
    return { evidence: [evidence], resultCount: curSnaps.length + curCodes.length + byDevice.length, warnings };
  },
};
