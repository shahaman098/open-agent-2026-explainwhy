/** Cross-document safeguards not expressible as single Zod object schemas. */
import type {
  ActionProposalT, BusinessEventT, DiagnosisT, EvidenceT, PlanApprovalT, ProposedPlanT,
} from './contracts';

export function eventBusinessRules(event: BusinessEventT): string[] {
  const errors: string[] = [];
  switch (event.type) {
    case 'order.completed':
      if (event.payload.netRevenueMinor !== event.payload.grossTotalMinor - event.payload.discountMinor)
        errors.push('Net revenue must equal gross total minus discounts.');
      break;
    case 'ad.metrics_observed':
      if (event.payload.clicks > event.payload.impressions)
        errors.push('Ad clicks cannot exceed impressions in this simplified dataset.');
      if (event.payload.attributedOrders > event.payload.clicks)
        errors.push('Attributed orders cannot exceed ad clicks in this simplified dataset.');
      break;
    default:
      break;
  }
  if (event.provenance.simulated && event.source !== 'simulator') {
    // Permitted when simulating a real connector; record the provenance truthfully.
  }
  return errors;
}

export function diagnoseReferenceErrors(diagnosis: DiagnosisT, evidence: EvidenceT[]): string[] {
  const errors: string[] = [];
  const available = new Set(evidence.filter(e =>
    e.investigationId === diagnosis.investigationId && e.businessId === diagnosis.businessId
  ).map(e => e.evidenceId));
  for (const hypothesis of diagnosis.hypotheses) {
    for (const id of [...hypothesis.evidenceIds, ...hypothesis.counterEvidenceIds]) {
      if (!available.has(id)) errors.push(`Missing or out-of-scope evidence ${id}.`);
    }
  }
  if (!diagnosis.hypotheses.some(h => h.cause === diagnosis.primaryCause)) {
    errors.push('The primary cause must appear among the hypotheses.');
  }
  return errors;
}

export function planReferenceErrors(plan: ProposedPlanT, diagnosis: DiagnosisT, evidence: EvidenceT[]): string[] {
  const errors: string[] = [];
  if (plan.investigationId !== diagnosis.investigationId || plan.diagnosisId !== diagnosis.diagnosisId ||
      plan.businessId !== diagnosis.businessId) errors.push('Plan/diagnosis ownership mismatch.');
  const seen = new Set<string>();
  const ids = new Set(plan.actions.map(a => a.actionId));
  const allowedEvidence = new Set(evidence.filter(e => e.investigationId === plan.investigationId && e.businessId === plan.businessId).map(e => e.evidenceId));
  for (const action of plan.actions) {
    if (seen.has(action.actionId)) errors.push(`Duplicate action ID ${action.actionId}.`);
    seen.add(action.actionId);
    for (const dependency of action.dependsOnActionIds) {
      if (!ids.has(dependency)) errors.push(`Missing dependency ${dependency}.`);
      if (dependency === action.actionId) errors.push(`Self-dependency ${dependency}.`);
    }
    for (const evidenceId of action.evidenceIds) {
      if (!allowedEvidence.has(evidenceId)) errors.push(`Unknown or cross-business evidence ${evidenceId}.`);
    }
    if (action.actionType === 'ads.set_daily_budget' && action.agent !== 'marketing')
      errors.push(`Ad budget action must use marketing agent: ${action.actionId}.`);
    if (action.actionType === 'customer.send_delay_notice' && action.agent !== 'customer_care')
      errors.push(`Customer notice action must use customer_care agent: ${action.actionId}.`);
    if (action.actionType === 'storefront.publish_banner' && action.agent !== 'storefront')
      errors.push(`Storefront banner action must use storefront agent: ${action.actionId}.`);
    if (action.actionType === 'marketing.publish_ad' && action.agent !== 'marketing')
      errors.push(`Marketing publish action must use marketing agent: ${action.actionId}.`);
    if (action.actionType === 'customer.send_promotion_email' && action.agent !== 'customer_care')
      errors.push(`Promotional email action must use customer_care agent: ${action.actionId}.`);
    if (action.actionType === 'storefront.create_discount' && action.agent !== 'storefront')
      errors.push(`Discount creation action must use storefront agent: ${action.actionId}.`);
  }
  const graph = new Map<string, string[]>(plan.actions.map(a => [a.actionId, a.dependsOnActionIds]));
  const active = new Set<string>(); const complete = new Set<string>();
  function visit(id: string): boolean {
    if (active.has(id)) return true;
    if (complete.has(id)) return false;
    active.add(id);
    for (const dep of graph.get(id) ?? []) if (visit(dep)) return true;
    active.delete(id); complete.add(id); return false;
  }
  if (plan.actions.some(a => visit(a.actionId))) errors.push('Action dependency graph contains a cycle.');
  if (Date.parse(plan.expiresAt) <= Date.parse(plan.createdAt)) errors.push('Plan expires before creation.');
  return errors;
}

export function approvalReferenceErrors(plan: ProposedPlanT, approval: PlanApprovalT): string[] {
  const errors: string[] = [];
  if (approval.businessId !== plan.businessId || approval.planId !== plan.planId ||
      approval.planVersion !== plan.planVersion) errors.push('Approval does not match this exact plan version.');
  const ids = new Set(plan.actions.map(a => a.actionId));
  const selected = new Set(approval.approvedActionIds);
  for (const id of [...approval.approvedActionIds, ...approval.rejectedActionIds]) {
    if (!ids.has(id)) errors.push(`Approval references an unknown action ${id}.`);
  }
  for (const id of approval.rejectedActionIds) if (selected.has(id)) errors.push(`Action ${id} both approved and rejected.`);
  if (approval.decision === 'approved' && approval.approvedActionIds.length === 0)
    errors.push('Approved plan must include at least one action.');
  if (approval.decision !== 'approved' && approval.approvedActionIds.length > 0)
    errors.push('Changes/rejection cannot simultaneously approve executable actions.');
  if (Date.parse(approval.expiresAt) <= Date.parse(approval.reviewedAt))
    errors.push('Approval expiry must be after the review time.');
  return errors;
}
