import "server-only";
import { BusinessEvent, type BusinessEventT } from "@explainwhy/contracts";
import type { SimulatedCampaign } from "@/types/domain";
import type { CampaignScope } from "./campaigns";

export const ADS_COLUMNS = ["event_id", "business_id", "simulation_run_id", "campaign_id", "window_start", "window_end", "impressions", "clicks", "spend_minor", "attributed_orders", "attributed_revenue_minor"] as const;
export const CAMPAIGN_COLUMNS = ["business_id", "simulation_run_id", "campaign_id", "campaign_name", "platform"] as const;
const csv = (columns: readonly string[], rows: Record<string, string | number>[]) => [columns.join(","), ...rows.map((row) => columns.map((key) => `"${String(row[key]).replaceAll('"', '""')}"`).join(","))].join("\n") + "\n";

/** Export a synthetic, scoped snapshot only. Never export customers, sessions, emails or hidden simulator controls. */
export function campaignCsv(events: BusinessEventT[], campaigns: Pick<SimulatedCampaign, "businessId" | "simulationRunId" | "campaignId" | "name" | "platform">[], scope: CampaignScope) {
  const ads = events.map((event) => BusinessEvent.parse(event)).flatMap((event) => {
    if (event.businessId !== scope.businessId || event.simulationRunId !== scope.simulationRunId || event.type !== "ad.metrics_observed" ||
      Date.parse(event.payload.window.startAt) < Date.parse(scope.window.startAt) || Date.parse(event.payload.window.endAt) > Date.parse(scope.window.endAt) ||
      (scope.campaignIds.length && !scope.campaignIds.includes(event.payload.campaignId))) return [];
    if (!event.provenance.simulated) throw new Error("This export accepts synthetic observations only");
    const p = event.payload;
    if (p.currency !== "GBP") throw new Error("This Zetaris advertising export requires GBP observations");
    return [{ event_id: event.eventId, business_id: event.businessId, simulation_run_id: scope.simulationRunId, campaign_id: p.campaignId,
      window_start: new Date(p.window.startAt).toISOString(), window_end: new Date(p.window.endAt).toISOString(), impressions: p.impressions, clicks: p.clicks, spend_minor: p.spendMinor, attributed_orders: p.attributedOrders, attributed_revenue_minor: p.attributedRevenueMinor }];
  });
  const used = new Set(ads.map((row) => row.campaign_id));
  const catalogue = campaigns.filter((campaign) => campaign.businessId === scope.businessId && campaign.simulationRunId === scope.simulationRunId && used.has(campaign.campaignId))
    .map((campaign) => ({ business_id: campaign.businessId, simulation_run_id: campaign.simulationRunId, campaign_id: campaign.campaignId, campaign_name: campaign.name, platform: campaign.platform }));
  if (new Set(catalogue.map((row) => row.campaign_id)).size !== catalogue.length) throw new Error("Duplicate campaign catalogue keys would multiply Zetaris join rows");
  if (catalogue.length !== used.size) throw new Error("Every exported campaign must have a scoped catalogue record");
  return { ads: csv(ADS_COLUMNS, ads), campaigns: csv(CAMPAIGN_COLUMNS, catalogue), counts: { observations: ads.length, campaigns: catalogue.length } };
}
