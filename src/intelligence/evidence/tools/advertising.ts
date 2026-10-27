import { z } from "zod";
import { campaignBreakdown, type CampaignBreakdownRow } from "@/analytics/metrics";
import { COLLECTIONS } from "@/lib/collections";
import { MAX_ENTITY_IDS, ToolInputBase, type EvidenceDraft, type EvidenceTool, type ToolContext, type WindowT } from "../types";
import { cap, clampToCutoff, compact, countAndSample, measurement, occurredIn, pc, pctChange, ratio, round, scopeOf } from "./_shared";
import { campaignTrends } from './campaign-trends';

export const AdvertisingInput = ToolInputBase.extend({
  campaignIds: z.array(z.string().min(1).max(64)).max(MAX_ENTITY_IDS).default([]),
}).strict();
export type AdvertisingInputT = z.infer<typeof AdvertisingInput>;

async function paidSessions(ctx: ToolContext, w: WindowT) {
  const rows = await ctx.db.collection(COLLECTIONS.businessEvents).aggregate<{ _id: string; sessions: number }>([
    { $match: { ...scopeOf(ctx), type: "web.session_started", "payload.campaignId": { $exists: true }, ...occurredIn(w) } },
    { $group: { _id: "$payload.campaignId", sessions: { $sum: 1 } } }, { $limit: 100 },
  ]).toArray();
  return new Map(rows.map((r) => [r._id, r.sessions]));
}

function total(rows: CampaignBreakdownRow[]) {
  const t = rows.reduce((a, r) => ({ impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, spendMinor: a.spendMinor + r.spendMinor,
    attributedOrders: a.attributedOrders + r.attributedOrders, attributedRevenueMinor: a.attributedRevenueMinor + r.attributedRevenueMinor }),
  { impressions: 0, clicks: 0, spendMinor: 0, attributedOrders: 0, attributedRevenueMinor: 0 });
  return { ...t, ctr: ratio(t.clicks, t.impressions), cpaMinor: ratio(t.spendMinor, t.attributedOrders), roas: ratio(t.attributedRevenueMinor, t.spendMinor) };
}

export const advertisingAnalysis: EvidenceTool<AdvertisingInputT> = {
  name: "advertising_analysis",
  title: "Advertising analysis",
  description: "Impressions, clicks, CTR, spend, CPA, ROAS, frequency and attributed sessions per campaign, comparing affected campaigns with the rest and with a baseline window. Reads canonical ad.metrics_observed and web.session_started events.",
  category: "advertising",
  dataSources: [
    { collection: COLLECTIONS.businessEvents, description: "ad.metrics_observed hourly campaign observations (deduplicated per campaign/window)", origin: "simulated" },
    { collection: COLLECTIONS.businessEvents, description: "web.session_started events carrying a campaignId", origin: "simulated" },
  ],
  input: AdvertisingInput,
  async run(ctx, input) {
    const window = clampToCutoff(input.window, ctx.cutoff);
    const baseline = input.baselineWindow ? clampToCutoff(input.baselineWindow, ctx.cutoff) : null;
    const warnings: string[] = [];
    const [cur, base, curSessions, baseSessions] = await Promise.all([
      campaignBreakdown(ctx.businessId, ctx.simulationRunId, window.startAt, window.endAt, ctx.db),
      baseline ? campaignBreakdown(ctx.businessId, ctx.simulationRunId, baseline.startAt, baseline.endAt, ctx.db) : Promise.resolve([] as CampaignBreakdownRow[]),
      paidSessions(ctx, window), baseline ? paidSessions(ctx, baseline) : Promise.resolve(new Map<string, number>()),
    ]);
    if (cur.length === 0) return { evidence: [], resultCount: 0, warnings: ["No advertising observations in the requested window"], emptyResult: "No ad.metrics_observed events in window" };
    const hc = Math.max(1, (Date.parse(window.endAt) - Date.parse(window.startAt)) / 3_600_000), hb = baseline ? Math.max(1, (Date.parse(baseline.endAt) - Date.parse(baseline.startAt)) / 3_600_000) : 1;
    const baseBy = new Map(base.map((r) => [r.campaignId, r]));
    const unknown = input.campaignIds.filter((id) => !cur.some((r) => r.campaignId === id));
    if (unknown.length) warnings.push(`No observations for requested campaigns: ${unknown.join(", ")}`);
    const affectedIds = new Set(input.campaignIds.length ? input.campaignIds : cur.map((r) => r.campaignId));

    const rows = cur.map((r) => {
      const b = baseBy.get(r.campaignId);
      return { campaignId: r.campaignId, affected: affectedIds.has(r.campaignId),
        impressions: r.impressions, clicks: r.clicks, spendMinor: r.spendMinor, attributedOrders: r.attributedOrders, attributedRevenueMinor: r.attributedRevenueMinor,
        ctr: r.ctr, baselineCtr: b?.ctr ?? null, ctrChangePercent: pctChange(r.ctr, b?.ctr ?? null),
        costPerAcquisitionMinor: r.costPerAcquisitionMinor, baselineCostPerAcquisitionMinor: b?.costPerAcquisitionMinor ?? null,
        roas: r.roas, baselineRoas: b?.roas ?? null, averageFrequency: r.averageFrequency, baselineAverageFrequency: b?.averageFrequency ?? null,
        frequencyChangePercent: pctChange(r.averageFrequency, b?.averageFrequency ?? null),
        attributedSessions: curSessions.get(r.campaignId) ?? 0, baselineAttributedSessions: baseSessions.get(r.campaignId) ?? null,
        attributedSessionsPerHour: round((curSessions.get(r.campaignId) ?? 0) / hc, 3), baselineAttributedSessionsPerHour: b ? round((baseSessions.get(r.campaignId) ?? 0) / hb, 3) : null,
        spendPerHourMinor: round(r.spendMinor / hc, 1), baselineSpendPerHourMinor: b ? round(b.spendMinor / hb, 1) : null };
    });
    const affected = total(cur.filter((r) => affectedIds.has(r.campaignId))), others = total(cur.filter((r) => !affectedIds.has(r.campaignId)));
    const affectedBase = total(base.filter((r) => affectedIds.has(r.campaignId)));
    const all = total(cur), allBase = total(base);

    const sample = await countAndSample(ctx.db, { ...scopeOf(ctx), type: "ad.metrics_observed", "payload.window.startAt": { $gte: window.startAt, $lt: window.endAt },
      ...(input.campaignIds.length ? { "payload.campaignId": { $in: input.campaignIds } } : {}) }, input.limit);
    const sessionSample = await countAndSample(ctx.db, { ...scopeOf(ctx), type: "web.session_started", "payload.campaignId": { $exists: true }, ...occurredIn(window) }, Math.min(input.limit, 25));
    if (!base.length) warnings.push("No baseline window supplied or no baseline observations; changes are not computed");

    const observation = [
      `${affectedIds.size} campaign(s) analysed over ${hc} h ending ${window.endAt}: CTR ${all.ctr === null ? "n/a" : (all.ctr * 100).toFixed(2) + "%"}, spend £${(all.spendMinor / 100).toFixed(2)}, ${all.attributedOrders} attributed orders, CPA ${all.cpaMinor === null ? "n/a" : "£" + (all.cpaMinor / 100).toFixed(2)}, ROAS ${all.roas === null ? "n/a" : all.roas.toFixed(2)}.`,
      base.length ? `Versus baseline: CTR ${pc(all.ctr, allBase.ctr)}, hourly spend ${pc(all.spendMinor / hc, allBase.spendMinor / hb)}, hourly attributed orders ${pc(all.attributedOrders / hc, allBase.attributedOrders / hb)}.` : "",
      input.campaignIds.length && others.impressions > 0 ? `Affected campaigns CTR ${affected.ctr === null ? "n/a" : (affected.ctr * 100).toFixed(2) + "%"} versus other campaigns ${others.ctr === null ? "n/a" : (others.ctr * 100).toFixed(2) + "%"}.` : "",
      "Observations are simulated ad-platform records; frequency and CTR describe exposure and response, not intent.",
    ].filter(Boolean).join(" ");

    const evidence: EvidenceDraft = {
      key: "advertising:campaigns", category: "advertising", title: "Campaign performance versus baseline and peers", observation, window,
      measurements: compact([
        measurement("ctr", all.ctr, "ratio", allBase.ctr), measurement("affected_ctr", affected.ctr, "ratio", affectedBase.ctr), measurement("other_campaigns_ctr", others.ctr, "ratio"),
        measurement("impressions", all.impressions, "count", base.length ? allBase.impressions : undefined), measurement("clicks", all.clicks, "count", base.length ? allBase.clicks : undefined),
        measurement("ad_spend_minor_per_hour", all.spendMinor / hc, "GBP minor units/hour", base.length ? allBase.spendMinor / hb : undefined),
        measurement("attributed_orders_per_hour", all.attributedOrders / hc, "count/hour", base.length ? allBase.attributedOrders / hb : undefined),
        measurement("cost_per_acquisition_minor", all.cpaMinor, "GBP minor units", allBase.cpaMinor), measurement("roas", all.roas, "ratio", allBase.roas),
        measurement("average_frequency", cur.reduce((a, r) => a + (r.averageFrequency ?? 0), 0) / cur.length, "impressions/user", base.length ? base.reduce((a, r) => a + (r.averageFrequency ?? 0), 0) / base.length : undefined),
        measurement("attributed_sessions_per_hour", [...curSessions.values()].reduce((a, b) => a + b, 0) / hc, "count/hour", base.length ? [...baseSessions.values()].reduce((a, b) => a + b, 0) / hb : undefined),
      ]),
      sourceRecords: [...sample.sample, ...sessionSample.sample],
      detail: { hours: { current: hc, baseline: baseline ? hb : null }, campaigns: cap(rows, input.limit), affected, others, affectedBaseline: affectedBase, observationEventsInWindow: sample.count, attributedSessionEventsInWindow: sessionSample.count },
      warnings, dataOrigin: "simulated",
    };
    // Campaign comparisons and chronology must reach the canonical packet, not just UI-only detail.
    const trend = await campaignTrends(ctx, { startAt: baseline?.startAt ?? window.startAt, endAt: window.endAt });
    const comparisons: EvidenceDraft[] = rows.filter(r => r.affected).slice(0, MAX_ENTITY_IDS).map(r => {
      const days = trend.filter(d => d.campaignId === r.campaignId);
      const selectedDays = days.length <= 8 ? days : [...days.slice(0, 2), ...days.slice(-6)];
      const peers = rows.filter(p => p.campaignId !== r.campaignId).slice(0, MAX_ENTITY_IDS);
      const fmt = (n: number | null) => n === null ? 'unavailable' : String(round(n));
      const observation = [
        `Simulated campaign ${r.campaignId}: CTR ${fmt(r.ctr)} versus ${fmt(r.baselineCtr)} baseline; average frequency ${fmt(r.averageFrequency)} versus ${fmt(r.baselineAverageFrequency)}; ROAS ${fmt(r.roas)} versus ${fmt(r.baselineRoas)}; CPA in GBP minor units ${fmt(r.costPerAcquisitionMinor)} versus ${fmt(r.baselineCostPerAcquisitionMinor)}; attributed sessions/hour ${r.attributedSessionsPerHour} versus ${fmt(r.baselineAttributedSessionsPerHour)}.`,
        `Observed daily sequence (UTC; boundary days may mix baseline and incident hours): ${selectedDays.map(d => `${d.day}: ${d.hours} observed hours, CTR ${fmt(d.ctr)}, frequency ${d.averageFrequency}, spend GBP minor ${d.spendMinor}, attributed orders ${d.attributedOrders}`).join('; ')}.`,
        `Contemporaneous campaign comparisons: ${peers.map(p => `${p.campaignId}: CTR ${fmt(p.ctr)} vs ${fmt(p.baselineCtr)}, frequency ${fmt(p.averageFrequency)} vs ${fmt(p.baselineAverageFrequency)}, ROAS ${fmt(p.roas)} vs ${fmt(p.baselineRoas)}`).join('; ')}. These peers are not assumed unaffected controls.`,
        'Ratios and trends are computed from canonical campaign/hour observations; no creative-level or audience-level attribution is available, and chronology alone does not establish causation.',
      ].join(' ');
      return {
        key: `advertising:campaign:${r.campaignId}`, category: 'advertising', title: `Campaign comparison and daily chronology: ${r.campaignId}`,
        observation, window, dataOrigin: 'simulated', warnings,
        measurements: compact([measurement('ctr', r.ctr, 'ratio', r.baselineCtr),
          measurement('average_frequency', r.averageFrequency, 'impressions/user', r.baselineAverageFrequency),
          measurement('roas', r.roas, 'ratio', r.baselineRoas),
          measurement('cost_per_acquisition_minor', r.costPerAcquisitionMinor, 'GBP minor units', r.baselineCostPerAcquisitionMinor),
          measurement('attributed_sessions_per_hour', r.attributedSessionsPerHour, 'count/hour', r.baselineAttributedSessionsPerHour)]),
        sourceRecords: [...selectedDays.flatMap(d => d.sourceRecords), ...sample.sample],
        detail: { campaigns: [r], daily: selectedDays, hours: { current: hc, baseline: baseline ? hb : null } },
      };
    });
    return { evidence: [evidence, ...comparisons], resultCount: rows.length, warnings };
  },
};
