import "server-only";

import { z } from "zod";
import { ActionProposal } from "@normal/contracts";
import { ingestEvents } from "@/ingestion/service";
import { buildSimulatorEvent } from "@/simulator/events";
import type { SimulatedStorefront, StorefrontBanner } from "@/types/domain";
import { COLLECTIONS, findReceipt, resolveContext, saveReceipt } from "@/adapters/_shared";
import { ADAPTER_LIMITS, AdapterError, type ActionContext, type AdapterResult } from "@/adapters/types";

const PublishBannerParams = ActionProposal.options[2].shape.params;
if (ActionProposal.options[2].shape.actionType.value !== "storefront.publish_banner") {
  throw new Error("@normal/contracts ActionProposal option order changed; update adapter param selection");
}
export type PublishBannerParamsT = z.infer<typeof PublishBannerParams>;

export interface StorefrontView {
  banners: StorefrontBanner[];
  activeBanners: StorefrontBanner[];
  promotions: SimulatedStorefront["promotions"];
  virtualTime: string;
  updatedAt: string;
}

/** Read storefront configuration; `activeBanners` is evaluated against the run's virtual clock. */
export async function readStorefront(ctx: Pick<ActionContext, "businessId" | "simulationRunId" | "db">): Promise<StorefrontView> {
  const { db, runId, state } = await resolveContext(ctx);
  const doc = await db.collection<SimulatedStorefront>(COLLECTIONS.simulatedStorefront)
    .findOne({ businessId: ctx.businessId, simulationRunId: runId }, { projection: { _id: 0 } });
  const banners = doc?.banners ?? [];
  const now = state.virtualTime;
  return {
    banners, activeBanners: banners.filter((b) => b.startsAt <= now && (!b.expiresAt || b.expiresAt > now)),
    promotions: doc?.promotions ?? [], virtualTime: now, updatedAt: doc?.updatedAt ?? state.updatedAt,
  };
}

/**
 * Executes `storefront.publish_banner`. Persists the banner on the simulated
 * storefront (visible on /demo-store), reads it back, then emits
 * `storefront.banner_published`.
 */
export async function publishBanner(ctx: ActionContext, rawParams: unknown): Promise<AdapterResult<StorefrontView>> {
  const params = PublishBannerParams.parse(rawParams);
  const { db, runId, state } = await resolveContext(ctx);
  const replay = await findReceipt<StorefrontView>(db, ctx.businessId, ctx.idempotencyKey);
  if (replay) return { applied: false, emittedEventIds: [], verification: `replayed: ${replay.verification}`, affectedEntityIds: replay.affectedEntityIds, state: replay.state };

  if (params.message.length > ADAPTER_LIMITS.maxBannerMessageLength) throw new AdapterError("Banner message too long", "message_limit");
  const durationHours = (Date.parse(params.expiresAt) - Date.parse(params.startsAt)) / 3_600_000;
  if (!(durationHours > 0)) throw new AdapterError("expiresAt must be after startsAt", "invalid_window");
  if (durationHours > ADAPTER_LIMITS.maxBannerDurationHours) throw new AdapterError("Banner duration exceeds the server limit", "duration_limit");

  const now = new Date().toISOString();
  const banner: StorefrontBanner = {
    bannerId: params.bannerId, message: params.message, startsAt: params.startsAt, expiresAt: params.expiresAt,
    ...(params.promoCode ? { promoCode: params.promoCode } : {}), actionId: ctx.actionId, publishedAt: state.virtualTime,
  };
  const col = db.collection<SimulatedStorefront>(COLLECTIONS.simulatedStorefront);
  // Replace an existing banner with the same ID, otherwise append.
  const existing = await col.findOne({ businessId: ctx.businessId, simulationRunId: runId, "banners.bannerId": params.bannerId });
  if (existing) {
    await col.updateOne({ businessId: ctx.businessId, simulationRunId: runId, "banners.bannerId": params.bannerId }, { $set: { "banners.$": banner, updatedAt: now } });
  } else {
    await col.updateOne({ businessId: ctx.businessId, simulationRunId: runId }, { $push: { banners: banner }, $set: { updatedAt: now } }, { upsert: true });
  }
  const view = await readStorefront(ctx);
  const stored = view.banners.find((b) => b.bannerId === params.bannerId);
  if (!stored || stored.message !== params.message) throw new AdapterError("Read-back mismatch after publishing banner", "verification_failed", true);

  const event = buildSimulatorEvent("storefront.banner_published", {
    bannerId: params.bannerId, message: params.message, startsAt: params.startsAt, expiresAt: params.expiresAt, actionId: ctx.actionId,
  }, {
    businessId: ctx.businessId, simulationRunId: runId, occurredAt: state.virtualTime, receivedAt: now,
    sourceRecordId: `${runId}:action:${ctx.idempotencyKey}:banner`, correlationId: ctx.actionId, ingestMethod: "action_callback",
  });
  const ingest = await ingestEvents([event], { businessId: ctx.businessId, db });
  const verification = `banner ${params.bannerId} present on storefront (active ${params.startsAt} → ${params.expiresAt}); read back at ${now}`;
  await saveReceipt(db, {
    businessId: ctx.businessId, simulationRunId: runId, idempotencyKey: ctx.idempotencyKey, actionId: ctx.actionId, toolName: "storefront.publish_banner",
    emittedEventIds: ingest.result.eventIds, affectedEntityIds: [params.bannerId], verification, state: view, recordedAt: now,
  });
  return { applied: true, emittedEventIds: ingest.result.eventIds, verification, affectedEntityIds: [params.bannerId], state: view };
}
