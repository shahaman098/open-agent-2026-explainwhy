import { BusinessEvent } from "@explainwhy/contracts";
import { COLLECTIONS } from "@/lib/collections";
import { zetarisConfig } from "@/integrations/zetaris/config";
import { queryZetaris } from "@/integrations/zetaris/client";
import { campaignQuery, verifyCampaignRows } from "@/integrations/zetaris/campaigns";
import { AdvertisingInput, type AdvertisingInputT } from "./advertising";
import { clampToCutoff, compact, measurement, ratio, scopeOf } from "./_shared";
import type { EvidenceDraft, EvidenceTool } from "../types";

export const zetarisCampaignAnalysis: EvidenceTool<AdvertisingInputT> = {
  name: "zetaris_campaign_analysis", title: "Zetaris campaign evidence",
  description: "Read-only Zetaris SQL join of registered advertising observations and campaign catalogue. Tenant, run, time window and affected campaigns are fixed by the server. All returned metrics must match canonical synthetic events; stale or incomplete exports fail closed.",
  category: "advertising", input: AdvertisingInput,
  dataSources: [{ externalSource: "Zetaris SQL API", description: "Federated advertising observations joined to campaign catalogue", origin: "simulated" }],
  async run(ctx, input) {
    const config = zetarisConfig(), window = clampToCutoff(input.window, ctx.cutoff);
    const scope = { businessId: ctx.businessId, simulationRunId: ctx.simulationRunId, window, campaignIds: input.campaignIds };
    const sql = campaignQuery(scope, config);
    const result = await queryZetaris(sql, { config });
    const events = await ctx.db.collection(COLLECTIONS.businessEvents).find({
      ...scopeOf(ctx), type: "ad.metrics_observed", "payload.window.startAt": { $gte: window.startAt }, "payload.window.endAt": { $lte: window.endAt },
      ...(input.campaignIds.length ? { "payload.campaignId": { $in: input.campaignIds } } : {}),
    }, { projection: { _id: 0 } }).limit(5001).toArray();
    const rows = verifyCampaignRows(result.records, events.map((event) => BusinessEvent.parse(event)), scope);
    if (!rows.length) return { evidence: [], resultCount: 0, warnings: [], emptyResult: "Zetaris and the canonical store both contain no campaign observations in this window" };
    const warnings = ["Synthetic business observations queried through Zetaris; not live advertising-account data. The campaign catalogue is descriptive context, not evidence of an incident's cause."];
    if (rows.some((row) => row.campaign_name === null || row.platform === null)) warnings.push("Some observations have no matching registered campaign catalogue row");
    if (!result.receipt.closed) warnings.push("Zetaris query completed but cursor cleanup was not confirmed");
    const evidence: EvidenceDraft[] = [...new Set(rows.map((row) => row.campaign_id))].map((campaignId) => {
      const observations = rows.filter((row) => row.campaign_id === campaignId);
      const sum = (field: "impressions" | "clicks" | "spend_minor" | "attributed_orders" | "attributed_revenue_minor") => observations.reduce((total, row) => total + row[field], 0);
      const impressions = sum("impressions"), clicks = sum("clicks"), spend = sum("spend_minor"), orders = sum("attributed_orders"), revenue = sum("attributed_revenue_minor");
      return {
        key: `zetaris:campaign:${campaignId}`, category: "advertising", title: `Zetaris verified campaign observations: ${campaignId}`, window, dataOrigin: "simulated", warnings,
        observation: `Zetaris joined simulated advertising observations with the campaign catalogue for ${campaignId}. Every observation matches its canonical event and the export covers the requested window. This is an observed comparison source; it does not establish causation.`,
        measurements: compact([measurement("impressions", impressions, "count"), measurement("clicks", clicks, "count"), measurement("ad_spend_minor", spend, "GBP minor units"), measurement("attributed_orders", orders, "count"), measurement("attributed_revenue_minor", revenue, "GBP minor units"), measurement("ctr", ratio(clicks, impressions), "ratio"), measurement("roas", ratio(revenue, spend), "ratio")]),
        sourceRecords: observations.map((row) => ({ collection: COLLECTIONS.businessEvents, recordId: row.event_id })),
        detail: { provider: "Zetaris", query: sql, receipt: result.receipt, relations: { advertising: config.adsRelation, catalogue: config.campaignsRelation }, campaign: { campaignId, name: observations[0].campaign_name, platform: observations[0].platform }, verifiedObservations: observations.length },
      };
    });
    return { evidence, resultCount: rows.length, warnings };
  },
};
