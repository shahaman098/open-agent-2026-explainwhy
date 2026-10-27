import type { Db } from "mongodb";
import { COLLECTIONS } from "@/lib/collections";
import type { SimulatedCampaign } from "@/types/domain";

/** Campaign labels for operator-facing views, kept outside the detector data boundary. */
export async function campaignDisplayNames(
  db: Db,
  businessId: string,
  refs: readonly { campaignId: string; simulationRunId: string }[],
): Promise<Map<string, string>> {
  const campaignIds = [...new Set(refs.map((ref) => ref.campaignId))];
  const runIds = [...new Set(refs.map((ref) => ref.simulationRunId))];
  if (!campaignIds.length || !runIds.length) return new Map();
  const docs = await db.collection<Pick<SimulatedCampaign, "campaignId" | "name" | "simulationRunId">>(COLLECTIONS.simulatedCampaigns)
    .find({ businessId, simulationRunId: { $in: runIds }, campaignId: { $in: campaignIds } }, { projection: { _id: 0, campaignId: 1, name: 1, simulationRunId: 1 } }).toArray();
  return new Map(docs.map((campaign) => [`${campaign.simulationRunId}:${campaign.campaignId}`, campaign.name]));
}

/** Presentation metadata only; this lookup must stay outside the detector and evidence retrieval boundary. */
export async function campaignDisplayMetadata(db: Db, businessId: string, simulationRunId: string, campaignIds: readonly string[]) {
  const ids = [...new Set(campaignIds)].slice(0, 100);
  if (!ids.length) return new Map<string, Pick<SimulatedCampaign, "campaignId" | "name" | "platform">>();
  const docs = await db.collection<Pick<SimulatedCampaign, "campaignId" | "name" | "platform">>(COLLECTIONS.simulatedCampaigns)
    .find({ businessId, simulationRunId, campaignId: { $in: ids } }, { projection: { _id: 0, campaignId: 1, name: 1, platform: 1 } }).toArray();
  return new Map(docs.map((campaign) => [campaign.campaignId, campaign]));
}
