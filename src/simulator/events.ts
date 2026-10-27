import { BusinessEvent, eventBusinessRules, type BusinessEventT } from "@normal/contracts";
import { CONNECTOR_ID } from "@/simulator/config";

export type EventPayloadFor<T extends BusinessEventT["type"]> = Extract<BusinessEventT, { type: T }>["payload"];

export interface EventEnvelopeInput {
  businessId: string;
  simulationRunId: string;
  occurredAt: string;
  receivedAt: string;
  /** Deterministic source identity; also drives the eventId. */
  sourceRecordId: string;
  correlationId?: string;
  ingestMethod?: "simulation" | "action_callback";
}

/**
 * Builds and validates a canonical simulator event. Every event emitted by the
 * simulator passes BusinessEvent.parse() and eventBusinessRules() here, before
 * it is handed to the shared ingestion service (which validates again).
 */
export function buildSimulatorEvent<T extends BusinessEventT["type"]>(
  type: T,
  payload: EventPayloadFor<T>,
  input: EventEnvelopeInput,
): BusinessEventT {
  const candidate = {
    schemaVersion: 1 as const,
    businessId: input.businessId,
    eventId: `ev_${input.sourceRecordId}`,
    source: "simulator" as const,
    type,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    provenance: {
      sourceRecordId: input.sourceRecordId,
      connectorId: CONNECTOR_ID,
      simulated: true,
      ingestMethod: input.ingestMethod ?? ("simulation" as const),
    },
    simulationRunId: input.simulationRunId,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    payload,
  };
  const event = BusinessEvent.parse(candidate);
  const ruleErrors = eventBusinessRules(event);
  if (ruleErrors.length > 0) {
    throw new Error(`Simulator produced an event violating business rules (${type}): ${ruleErrors.join("; ")}`);
  }
  return event;
}
