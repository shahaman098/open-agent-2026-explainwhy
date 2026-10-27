import "server-only";

import { z } from "zod";
import { ActionProposal, type BusinessEventT } from "@normal/contracts";
import { ingestEvents } from "@/ingestion/service";
import { buildSimulatorEvent } from "@/simulator/events";
import type { SimulatedMessage, SimulatedOrder, SimulatedShipment } from "@/types/domain";
import { COLLECTIONS, findReceipt, resolveContext, saveReceipt } from "@/adapters/_shared";
import { ADAPTER_LIMITS, AdapterError, type ActionContext, type AdapterResult } from "@/adapters/types";

const SendDelayNoticeParams = ActionProposal.options[1].shape.params;
if (ActionProposal.options[1].shape.actionType.value !== "customer.send_delay_notice") {
  throw new Error("@normal/contracts ActionProposal option order changed; update adapter param selection");
}
export type SendDelayNoticeParamsT = z.infer<typeof SendDelayNoticeParams>;

export interface DelayNoticeOutcome {
  messages: Array<Pick<SimulatedMessage, "messageId" | "orderId" | "customerId" | "deliveryStatus" | "inbox">>;
  skippedOrderIds: string[];
}

const TEMPLATES: Record<string, (orderId: string, promisedAt: string) => string> = {
  default: (orderId, promisedAt) => `[Demo test inbox] Your Nike (simulated) order ${orderId} is running late. It was promised for ${promisedAt}; we'll update you as soon as it ships.`,
};

/**
 * Executes `customer.send_delay_notice`. Messages are written to a fake test
 * inbox collection only — no email is sent and no real customer exists.
 * Emits one `customer.message_sent` per message after the write is read back.
 */
export async function sendDelayNotice(ctx: ActionContext, rawParams: unknown): Promise<AdapterResult<DelayNoticeOutcome>> {
  const params = SendDelayNoticeParams.parse(rawParams);
  const { db, runId, state } = await resolveContext(ctx);
  const replay = await findReceipt<DelayNoticeOutcome>(db, ctx.businessId, ctx.idempotencyKey);
  if (replay) return { applied: false, emittedEventIds: [], verification: `replayed: ${replay.verification}`, affectedEntityIds: replay.affectedEntityIds, state: replay.state };

  const cap = Math.min(params.maxRecipients, ADAPTER_LIMITS.maxDelayNoticeRecipients);
  const orderIds = [...new Set(params.orderIds)];
  const orders = await db.collection<SimulatedOrder>(COLLECTIONS.simulatedOrders)
    .find({ businessId: ctx.businessId, simulationRunId: runId, orderId: { $in: orderIds } }, { projection: { _id: 0 } }).toArray();
  const shipments = await db.collection<SimulatedShipment>(COLLECTIONS.simulatedShipments)
    .find({ businessId: ctx.businessId, simulationRunId: runId, orderId: { $in: orderIds } }, { projection: { _id: 0 } }).toArray();
  const shipmentByOrder = new Map(shipments.map((s) => [s.orderId, s]));
  const known = new Map(orders.map((o) => [o.orderId, o]));
  const skippedOrderIds = orderIds.filter((id) => !known.has(id));
  const recipients = orderIds.filter((id) => known.has(id)).slice(0, cap);
  if (recipients.length === 0) throw new AdapterError("None of the requested orders exist in this run", "no_recipients");

  const now = new Date().toISOString();
  const render = TEMPLATES[params.templateId] ?? TEMPLATES.default;
  const messages: SimulatedMessage[] = recipients.map((orderId, i) => {
    const order = known.get(orderId)!;
    const shipment = shipmentByOrder.get(orderId);
    return {
      businessId: ctx.businessId, simulationRunId: runId, messageId: `msg_${runId}_${ctx.idempotencyKey.replace(/[^a-zA-Z0-9]/g, "")}_${i}`,
      orderId, customerId: order.customerId, templateId: params.templateId, actionId: ctx.actionId, deliveryStatus: "sent",
      inbox: "demo_test_inbox", body: render(orderId, shipment?.promisedAt ?? "unknown"), sentAt: state.virtualTime,
    };
  });
  try {
    await db.collection(COLLECTIONS.simulatedMessages).insertMany(messages.map((m) => ({ ...m })), { ordered: false });
  } catch (error) {
    const e = error as { code?: number; writeErrors?: unknown };
    if (e.code !== 11000 && !("writeErrors" in e)) throw error;
  }
  // Read back: only messages that actually exist get a callback event.
  const stored = await db.collection<SimulatedMessage>(COLLECTIONS.simulatedMessages)
    .find({ businessId: ctx.businessId, messageId: { $in: messages.map((m) => m.messageId) } }, { projection: { _id: 0 } }).toArray();
  if (stored.length !== messages.length) throw new AdapterError("Read-back mismatch after writing messages", "verification_failed", true);

  const events: BusinessEventT[] = stored.map((m) => buildSimulatorEvent("customer.message_sent", {
    messageId: m.messageId, orderId: m.orderId, customerId: m.customerId, templateId: m.templateId, deliveryStatus: m.deliveryStatus, actionId: ctx.actionId,
  }, {
    businessId: ctx.businessId, simulationRunId: runId, occurredAt: state.virtualTime, receivedAt: now,
    sourceRecordId: `${runId}:action:${ctx.idempotencyKey}:msg:${m.messageId}`, correlationId: m.orderId, ingestMethod: "action_callback",
  }));
  const ingest = await ingestEvents(events, { businessId: ctx.businessId, db });
  const outcome: DelayNoticeOutcome = {
    messages: stored.map((m) => ({ messageId: m.messageId, orderId: m.orderId, customerId: m.customerId, deliveryStatus: m.deliveryStatus, inbox: m.inbox })),
    skippedOrderIds,
  };
  const verification = `${stored.length} delay notice(s) written to demo_test_inbox for orders [${recipients.join(", ")}]; ${skippedOrderIds.length} unknown order(s) skipped`;
  await saveReceipt(db, {
    businessId: ctx.businessId, simulationRunId: runId, idempotencyKey: ctx.idempotencyKey, actionId: ctx.actionId, toolName: "customer.send_delay_notice",
    emittedEventIds: ingest.result.eventIds, affectedEntityIds: recipients, verification, state: outcome, recordedAt: now,
  });
  return { applied: true, emittedEventIds: ingest.result.eventIds, verification, affectedEntityIds: recipients, state: outcome };
}

/** Reads the fake inbox (for verification and UI). */
export async function readTestInbox(ctx: Pick<ActionContext, "businessId" | "simulationRunId" | "db">, limit = 50): Promise<SimulatedMessage[]> {
  const { db, runId } = await resolveContext(ctx);
  return db.collection<SimulatedMessage>(COLLECTIONS.simulatedMessages)
    .find({ businessId: ctx.businessId, simulationRunId: runId }, { projection: { _id: 0 } }).sort({ sentAt: -1 }).limit(limit).toArray();
}
