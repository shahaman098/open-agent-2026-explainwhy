import {
  BusinessEvent, DiagnosisModelOutput, PlanHandoff, ProposedPlan,
  planReferenceErrors,
} from './index';

// Ingestion: validate untrusted JSON before writing to MongoDB.
export function parseIncomingEvent(body: unknown) {
  return BusinessEvent.parse(body);
}

// Diagnosis: the LLM must NOT mint trusted IDs. Add those server-side only.
export function parseModelDiagnosis(content: string) {
  return DiagnosisModelOutput.parse(JSON.parse(content));
}

// Handoff: your partner can validate the complete API response.
export function parsePlanHandoff(body: unknown) {
  const handoff = PlanHandoff.parse(body);
  const errors = planReferenceErrors(handoff.plan, handoff.diagnosis, handoff.evidence);
  if (errors.length) throw new Error(`Invalid plan references: ${errors.join('; ')}`);
  return handoff;
}

export function parseProposedPlan(body: unknown) {
  return ProposedPlan.parse(body);
}
