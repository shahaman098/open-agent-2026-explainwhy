import "server-only";
import { z } from "zod";
import { BusinessEvent, type BusinessEventT } from "@explainwhy/contracts";
import type { WindowT } from "@/intelligence/evidence/types";
import { quoteRelation, type ZetarisConfig } from "./config";

const ScopeId = z.string().regex(/^[a-z0-9_]{1,64}$/);
const EntityId = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/);
const Integer = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
export const CampaignRow = z.object({
  event_id: EntityId, business_id: ScopeId, simulation_run_id: ScopeId, campaign_id: EntityId,
  window_start: z.string().datetime({ offset: true }), window_end: z.string().datetime({ offset: true }),
  impressions: Integer, clicks: Integer, spend_minor: Integer, attributed_orders: Integer, attributed_revenue_minor: Integer,
  campaign_name: z.string().max(300).nullable(), platform: z.enum(["meta_ads", "google_ads"]).nullable(),
});
export type CampaignRowT = z.infer<typeof CampaignRow>;
export interface CampaignScope { businessId: string; simulationRunId: string; window: WindowT; campaignIds: string[] }

export function campaignQuery(scope: CampaignScope, config: Pick<ZetarisConfig, "adsRelation" | "campaignsRelation">) {
  ScopeId.parse(scope.businessId); ScopeId.parse(scope.simulationRunId);
  const start = new Date(z.string().datetime({ offset: true }).parse(scope.window.startAt)).toISOString();
  const end = new Date(z.string().datetime({ offset: true }).parse(scope.window.endAt)).toISOString();
  if (end <= start) throw new Error("Zetaris window must be positive");
  if (scope.campaignIds.length > 20) throw new Error("Too many campaign selectors");
  const ids = scope.campaignIds.map((id) => `'${EntityId.parse(id)}'`).join(", ");
  return `SELECT a.event_id, a.business_id, a.simulation_run_id, a.campaign_id, a.window_start, a.window_end, a.impressions, a.clicks, a.spend_minor, a.attributed_orders, a.attributed_revenue_minor, c.campaign_name, c.platform
FROM ${quoteRelation(config.adsRelation)} a
LEFT JOIN ${quoteRelation(config.campaignsRelation)} c ON a.business_id = c.business_id AND a.simulation_run_id = c.simulation_run_id AND a.campaign_id = c.campaign_id
WHERE a.business_id = '${scope.businessId}' AND a.simulation_run_id = '${scope.simulationRunId}'
AND a.window_start >= '${start}' AND a.window_end <= '${end}'${ids ? ` AND a.campaign_id IN (${ids})` : ""}
ORDER BY a.window_start, a.campaign_id, a.event_id LIMIT 5001`;
}

/** Verify every returned value against the immutable event before using it as evidence. */
export function verifyCampaignRows(input: unknown[], events: BusinessEventT[], scope: CampaignScope): CampaignRowT[] {
  const rows = input.map((row) => CampaignRow.parse(row));
  const byId = new Map(events.map((event) => [event.eventId, BusinessEvent.parse(event)]));
  const ids = new Set<string>(), windows = new Set<string>();
  for (const row of rows) {
    if (row.business_id !== scope.businessId || row.simulation_run_id !== scope.simulationRunId ||
      Date.parse(row.window_start) < Date.parse(scope.window.startAt) || Date.parse(row.window_end) > Date.parse(scope.window.endAt) || Date.parse(row.window_start) >= Date.parse(row.window_end) ||
      (scope.campaignIds.length && !scope.campaignIds.includes(row.campaign_id))) throw new Error("Zetaris returned a row outside the investigation scope");
    const key = `${row.campaign_id}:${new Date(row.window_start).toISOString()}`;
    if (ids.has(row.event_id) || windows.has(key)) throw new Error("Zetaris returned duplicate campaign observations");
    ids.add(row.event_id); windows.add(key);
    const event = byId.get(row.event_id);
    if (!event || event.type !== "ad.metrics_observed" || event.businessId !== scope.businessId || event.simulationRunId !== scope.simulationRunId) throw new Error("Zetaris source event is missing or outside scope");
    if (!event.provenance.simulated) throw new Error("This Zetaris evidence tool accepts synthetic observations only");
    const p = event.payload;
    if (p.campaignId !== row.campaign_id || Date.parse(p.window.startAt) !== Date.parse(row.window_start) || Date.parse(p.window.endAt) !== Date.parse(row.window_end) || p.currency !== "GBP" ||
      p.impressions !== row.impressions || p.clicks !== row.clicks || p.spendMinor !== row.spend_minor || p.attributedOrders !== row.attributed_orders || p.attributedRevenueMinor !== row.attributed_revenue_minor) throw new Error("Zetaris row differs from its canonical source event");
  }
  // Missing rows would make a stale export look like a fall in sales. Reject incomplete exports.
  if (events.length !== rows.length || events.some((event) => !ids.has(event.eventId))) throw new Error("Zetaris export is incomplete for the requested window; refresh the registered data");
  return rows;
}
