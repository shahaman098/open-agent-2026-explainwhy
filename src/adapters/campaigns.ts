import "server-only";

import { z } from "zod";
import { ActionProposal } from "@normal/contracts";
import { ingestEvents } from "@/ingestion/service";
import { buildSimulatorEvent } from "@/simulator/events";
import type { SimulatedCampaign } from "@/types/domain";
import { COLLECTIONS, findReceipt, resolveContext, saveReceipt } from "@/adapters/_shared";
import { ADAPTER_LIMITS, AdapterError, type ActionContext, type AdapterResult } from "@/adapters/types";

/** Exact params of the canonical `ads.set_daily_budget` action. */
const SetDailyBudgetParams = ActionProposal.options[0].shape.params;
if (ActionProposal.options[0].shape.actionType.value !== "ads.set_daily_budget") {
  throw new Error("@normal/contracts ActionProposal option order changed; update adapter param selection");
}
export type SetDailyBudgetParamsT = z.infer<typeof SetDailyBudgetParams>;

export interface CampaignView {
  campaignId: string;
  name: string;
  platform: SimulatedCampaign["platform"];
  status: SimulatedCampaign["status"];
  dailyBudgetMinor: number;
  currency: "GBP";
  targetCategory: SimulatedCampaign["targetCategory"];
  targetProductIds: string[];
  totals: SimulatedCampaign["totals"];
  updatedAt: string;
}

const toView = (c: SimulatedCampaign): CampaignView => ({
  campaignId: c.campaignId, name: c.name, platform: c.platform, status: c.status, dailyBudgetMinor: c.dailyBudgetMinor,
  currency: c.currency, targetCategory: c.targetCategory, targetProductIds: c.targetProductIds, totals: c.totals, updatedAt: c.updatedAt,
});

/** Read campaign state (no hidden parameters are included). */
export async function readCampaigns(ctx: Pick<ActionContext, "businessId" | "simulationRunId" | "db">): Promise<CampaignView[]> {
  const { db, runId } = await resolveContext(ctx);
  const docs = await db.collection<SimulatedCampaign>(COLLECTIONS.simulatedCampaigns)
    .find({ businessId: ctx.businessId, simulationRunId: runId }, { projection: { _id: 0 } }).sort({ campaignId: 1 }).toArray();
  return docs.map(toView);
}

export async function readCampaign(ctx: Pick<ActionContext, "businessId" | "simulationRunId" | "db">, campaignId: string): Promise<CampaignView | null> {
  const { db, runId } = await resolveContext(ctx);
  const doc = await db.collection<SimulatedCampaign>(COLLECTIONS.simulatedCampaigns)
    .findOne({ businessId: ctx.businessId, simulationRunId: runId, campaignId }, { projection: { _id: 0 } });
  return doc ? toView(doc) : null;
}

/**
 * Executes `ads.set_daily_budget`. Changes the persisted daily budget, reads it
 * back, then emits `campaign.budget_updated` (action_callback). Subsequent ticks
 * pace spend against the new budget.
 */
export async function setDailyBudget(ctx: ActionContext, rawParams: unknown): Promise<AdapterResult<CampaignView>> {
  const params = SetDailyBudgetParams.parse(rawParams);
  const { db, runId } = await resolveContext(ctx);
  const replay = await findReceipt<CampaignView>(db, ctx.businessId, ctx.idempotencyKey);
  if (replay) {
    return { applied: false, emittedEventIds: [], verification: `replayed: ${replay.verification}`, affectedEntityIds: replay.affectedEntityIds, state: replay.state };
  }
  if (params.currency !== "GBP") throw new AdapterError("Simulated business operates in GBP", "currency_mismatch");
  if (params.newDailyBudgetMinor > ADAPTER_LIMITS.maxDailyBudgetMinor) {
    throw new AdapterError(`Daily budget exceeds the server limit of ${ADAPTER_LIMITS.maxDailyBudgetMinor} minor units`, "budget_limit");
  }
  const campaigns = db.collection<SimulatedCampaign>(COLLECTIONS.simulatedCampaigns);
  const current = await campaigns.findOne({ businessId: ctx.businessId, simulationRunId: runId, campaignId: params.campaignId }, { projection: { _id: 0 } });
  if (!current) throw new AdapterError(`Campaign ${params.campaignId} not found`, "campaign_not_found");
  const previous = current.dailyBudgetMinor;
  if (previous > 0 && params.newDailyBudgetMinor > 0) {
    const factor = Math.max(params.newDailyBudgetMinor / previous, previous / params.newDailyBudgetMinor);
    if (factor > ADAPTER_LIMITS.maxBudgetChangeFactor) {
      throw new AdapterError(`Budget change factor ${factor.toFixed(2)} exceeds the limit of ${ADAPTER_LIMITS.maxBudgetChangeFactor}x`, "budget_change_limit");
    }
  }
  const now = new Date().toISOString();
  const res = await campaigns.updateOne(
    { businessId: ctx.businessId, simulationRunId: runId, campaignId: params.campaignId, dailyBudgetMinor: previous },
    { $set: { dailyBudgetMinor: params.newDailyBudgetMinor, status: params.newDailyBudgetMinor > 0 ? "active" : "paused", updatedAt: now } },
  );
  if (res.matchedCount !== 1) throw new AdapterError("Campaign changed concurrently; retry", "conflict", true);

  // Read back before emitting the callback: the event must describe a real change.
  const after = (await campaigns.findOne({ businessId: ctx.businessId, simulationRunId: runId, campaignId: params.campaignId }, { projection: { _id: 0 } }))!;
  if (after.dailyBudgetMinor !== params.newDailyBudgetMinor) throw new AdapterError("Read-back mismatch after budget update", "verification_failed", true);

  const state = (await resolveContext(ctx)).state;
  const event = buildSimulatorEvent("campaign.budget_updated", {
    campaignId: params.campaignId, previousDailyBudgetMinor: previous, newDailyBudgetMinor: params.newDailyBudgetMinor, currency: "GBP", actionId: ctx.actionId,
  }, {
    businessId: ctx.businessId, simulationRunId: runId, occurredAt: state.virtualTime, receivedAt: now,
    sourceRecordId: `${runId}:action:${ctx.idempotencyKey}:budget`, correlationId: ctx.actionId, ingestMethod: "action_callback",
  });
  const ingest = await ingestEvents([event], { businessId: ctx.businessId, db });
  const verification = `campaign ${params.campaignId} dailyBudgetMinor ${previous} -> ${after.dailyBudgetMinor} (read back at ${now})`;
  await saveReceipt(db, {
    businessId: ctx.businessId, simulationRunId: runId, idempotencyKey: ctx.idempotencyKey, actionId: ctx.actionId, toolName: "ads.set_daily_budget",
    emittedEventIds: ingest.result.eventIds, affectedEntityIds: [params.campaignId], verification, state: toView(after), recordedAt: now,
  });
  return { applied: true, emittedEventIds: ingest.result.eventIds, verification, affectedEntityIds: [params.campaignId], state: toView(after) };
}
