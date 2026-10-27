import "server-only";

import type { BusinessEventT } from "@normal/contracts";
import { COLLECTIONS, RECEIPTS_COLLECTION, findReceipt, resolveContext } from "@/adapters/_shared";
import type { ActionContext } from "@/adapters/types";
import { readCampaign } from "@/adapters/campaigns";
import { readStorefront } from "@/adapters/storefront";
import type { SimulatedMessage } from "@/types/domain";

export interface VerificationReport {
  idempotencyKey: string;
  found: boolean;
  toolName?: string;
  verification?: string;
  /** Does the current persisted state still match what the action wrote? */
  stateMatches: boolean | null;
  callbackEventsPresent: boolean | null;
  details: Record<string, unknown>;
}

/**
 * Independently verifies that an executed action changed actual state: re-reads
 * the affected entity and confirms the callback event(s) exist in the ledger.
 */
export async function verifyAction(ctx: Pick<ActionContext, "businessId" | "simulationRunId" | "db">, idempotencyKey: string): Promise<VerificationReport> {
  const { db } = await resolveContext(ctx);
  const receipt = await findReceipt<Record<string, unknown>>(db, ctx.businessId, idempotencyKey);
  if (!receipt) return { idempotencyKey, found: false, stateMatches: null, callbackEventsPresent: null, details: {} };
  const events = await db.collection<BusinessEventT>(COLLECTIONS.businessEvents)
    .find({ businessId: ctx.businessId, eventId: { $in: receipt.emittedEventIds } }, { projection: { _id: 0 } }).toArray();
  const callbackEventsPresent = events.length === receipt.emittedEventIds.length;
  let stateMatches: boolean | null = null;
  const details: Record<string, unknown> = { receiptsCollection: RECEIPTS_COLLECTION, eventsFound: events.length, eventsExpected: receipt.emittedEventIds.length };

  switch (receipt.toolName) {
    case "ads.set_daily_budget": {
      const expected = receipt.state as { campaignId: string; dailyBudgetMinor: number };
      const current = await readCampaign({ ...ctx, simulationRunId: receipt.simulationRunId }, expected.campaignId);
      stateMatches = current?.dailyBudgetMinor === expected.dailyBudgetMinor;
      details.currentDailyBudgetMinor = current?.dailyBudgetMinor;
      details.expectedDailyBudgetMinor = expected.dailyBudgetMinor;
      break;
    }
    case "storefront.publish_banner": {
      const view = await readStorefront({ ...ctx, simulationRunId: receipt.simulationRunId });
      stateMatches = receipt.affectedEntityIds.every((id) => view.banners.some((b) => b.bannerId === id));
      details.bannerIds = view.banners.map((b) => b.bannerId);
      break;
    }
    case "customer.send_delay_notice": {
      const expected = (receipt.state as { messages: Array<{ messageId: string }> }).messages.map((m) => m.messageId);
      const count = await db.collection<SimulatedMessage>(COLLECTIONS.simulatedMessages).countDocuments({ businessId: ctx.businessId, messageId: { $in: expected } });
      stateMatches = count === expected.length;
      details.messagesFound = count;
      break;
    }
  }
  return { idempotencyKey, found: true, toolName: receipt.toolName, verification: receipt.verification, stateMatches, callbackEventsPresent, details };
}
