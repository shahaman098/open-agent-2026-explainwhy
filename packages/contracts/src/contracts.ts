/** Normal v1 shared contracts. Runtime schemas use Zod 3.25.x. */
import { z } from 'zod';

// ---------- Shared primitives ----------
export const Id = z.string().min(1);
export const DateTime = z.string().datetime({ offset: true });
export const Rate = z.number().min(0).max(1);
export const Currency = z.enum(['GBP', 'USD', 'EUR']);
export const TimeWindow = z.object({ startAt: DateTime, endAt: DateTime }).strict();
export const SourceReference = z.object({
  collection: z.string().min(1), recordId: Id, sourceUrl: z.string().url().optional(),
}).strict();
export const Source = z.enum([
  'storefront', 'shopify', 'woocommerce', 'meta_ads', 'google_ads', 'ga4',
  'shipping', 'reviews', 'social', 'email', 'finance', 'supplier', 'simulator',
]);
export const Provenance = z.object({
  sourceRecordId: Id,
  connectorId: Id,
  simulated: z.boolean(),
  ingestMethod: z.enum(['webhook', 'poll', 'import', 'simulation', 'action_callback']),
  sourceUrl: z.string().url().optional(),
}).strict();
export const SchemaMeta = { schemaVersion: z.literal(1), businessId: Id };

// ---------- Business profile and integration ----------
export const Business = z.object({
  ...SchemaMeta, name: z.string().min(1), currency: Currency, timezone: z.string().min(1),
  industry: z.string().optional(), createdAt: DateTime,
}).strict();
export const Integration = z.object({
  ...SchemaMeta, integrationId: Id, provider: Source,
  status: z.enum(['pending', 'connected', 'degraded', 'disconnected']),
  scopes: z.array(z.string()), secretReference: z.string().optional(),
  lastSyncedAt: DateTime.optional(), cursor: z.string().optional(),
  lastError: z.string().optional(),
}).strict();

// ---------- Canonical immutable business events ----------
const EventBaseShape = {
  ...SchemaMeta,
  eventId: Id, source: Source, occurredAt: DateTime, receivedAt: DateTime,
  provenance: Provenance, correlationId: Id.optional(), simulationRunId: Id.optional(),
};
const E = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) => z.object({
  ...EventBaseShape, type: z.literal(type), payload,
}).strict();
export const BusinessEvent = z.discriminatedUnion('type', [
  E('web.session_started', z.object({
    sessionId: Id, device: z.enum(['desktop', 'ios', 'android', 'other']),
    channel: z.string(), campaignId: Id.optional(),
  }).strict()),
  E('order.completed', z.object({
    orderId: Id, sessionId: Id.optional(), customerId: Id.optional(), productIds: z.array(Id).min(1),
    grossTotalMinor: z.number().int().nonnegative(), discountMinor: z.number().int().nonnegative(),
    netRevenueMinor: z.number().int().nonnegative(), currency: Currency,
    campaignId: Id.optional(),
  }).strict()),
  E('order.refunded', z.object({
    orderId: Id, refundId: Id, refundMinor: z.number().int().nonnegative(), currency: Currency,
    reason: z.string().optional(),
  }).strict()),
  E('checkout.failed', z.object({
    checkoutId: Id, sessionId: Id, failureCode: z.string().min(1),
    device: z.enum(['desktop', 'ios', 'android', 'other']), couponCode: z.string().optional(),
  }).strict()),
  E('ad.metrics_observed', z.object({
    campaignId: Id, window: TimeWindow, impressions: z.number().int().nonnegative(),
    clicks: z.number().int().nonnegative(), spendMinor: z.number().int().nonnegative(),
    attributedOrders: z.number().int().nonnegative(),
    attributedRevenueMinor: z.number().int().nonnegative(),
    frequency: z.number().nonnegative(), currency: Currency,
  }).strict()),
  E('delivery.status_changed', z.object({
    orderId: Id, status: z.enum(['pending', 'shipped', 'delivered', 'delayed', 'lost']),
    promisedAt: DateTime.optional(), deliveredAt: DateTime.optional(),
    delayMinutes: z.number().int().nonnegative().optional(),
  }).strict()),
  E('review.created', z.object({
    reviewId: Id, productId: Id, orderId: Id.optional(), rating: z.number().int().min(1).max(5),
    text: z.string().min(1),
  }).strict()),
  E('social.mention_observed', z.object({
    mentionId: Id, platform: z.string().min(1), content: z.string().min(1),
    views: z.number().int().nonnegative().optional(),
    productId: Id.optional(), campaignId: Id.optional(),
  }).strict()),
  E('inventory.level_changed', z.object({
    productId: Id, availableUnits: z.number().int().nonnegative(),
    reservedUnits: z.number().int().nonnegative(),
  }).strict()),
  E('campaign.budget_updated', z.object({
    campaignId: Id, previousDailyBudgetMinor: z.number().int().nonnegative(),
    newDailyBudgetMinor: z.number().int().nonnegative(), currency: Currency,
    actionId: Id,
  }).strict()),
  E('customer.message_sent', z.object({
    messageId: Id, orderId: Id, customerId: Id, templateId: Id,
    deliveryStatus: z.enum(['queued', 'sent', 'failed']), actionId: Id,
  }).strict()),
  E('storefront.banner_published', z.object({
    bannerId: Id, message: z.string().min(1), startsAt: DateTime,
    expiresAt: DateTime.optional(), actionId: Id,
  }).strict()),
  E('promotion.created', z.object({
    promoCode: z.string().min(1), productIds: z.array(Id).min(1), percentOff: z.number().min(0).max(100),
    maxRedemptions: z.number().int().positive(), expiresAt: DateTime, actionId: Id,
  }).strict()),
]);
export type BusinessEventT = z.infer<typeof BusinessEvent>;
export const IngestBatch = z.object({ schemaVersion: z.literal(1),
  events: z.array(BusinessEvent).min(1).max(1000),
}).strict();

// ---------- Derived metrics and anomaly detection ----------
export const MetricCounters = z.object({
  sessions: z.number().int().nonnegative(), orders: z.number().int().nonnegative(),
  revenueMinor: z.number().int().nonnegative(), refundMinor: z.number().int().nonnegative(),
  adSpendMinor: z.number().int().nonnegative(), impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(), attributedOrders: z.number().int().nonnegative(),
  shipments: z.number().int().nonnegative(), delayedShipments: z.number().int().nonnegative(),
  reviews: z.number().int().nonnegative(), lowRatingReviews: z.number().int().nonnegative(),
  // Optional for snapshots persisted before checkout metrics were introduced.
  checkoutFailures: z.number().int().nonnegative().optional(), couponFailures: z.number().int().nonnegative().optional(),
}).strict();
export const MetricRates = z.object({
  conversionRate: Rate.nullable(), ctr: Rate.nullable(),
  lateDeliveryRate: Rate.nullable(), lowRatingRate: Rate.nullable(),
  costPerAcquisitionMinor: z.number().int().nonnegative().nullable(),
  checkoutFailureRate: Rate.nullable().optional(), couponFailureRate: Rate.nullable().optional(),
}).strict();
export const MetricSnapshot = z.object({
  ...SchemaMeta, snapshotId: Id, window: TimeWindow, currency: Currency,
  dimension: z.object({ campaignId: Id.optional(), productId: Id.optional(), channel: z.string().optional(),
    device: z.string().optional(),
  }).strict(),
  counters: MetricCounters, rates: MetricRates, computedAt: DateTime,
  completeness: z.enum(['complete', 'partial']),
}).strict();
export const MetricName = z.enum([
  'revenue_minor', 'conversion_rate', 'orders', 'cac_minor', 'ctr',
  'late_delivery_rate', 'low_rating_rate', 'ad_spend_minor',
  'checkout_failure_rate', 'coupon_failure_rate',
]);
export const Anomaly = z.object({
  ...SchemaMeta, anomalyId: Id, metric: MetricName,
  direction: z.enum(['increase', 'decrease']), severity: z.enum(['low', 'medium', 'high', 'critical']),
  currentWindow: TimeWindow, baselineWindow: TimeWindow,
  actualValue: z.number(), baselineValue: z.number(), changePercent: z.number(),
  sourceSnapshotIds: z.array(Id).min(1),
  detectorVersion: z.string().min(1), status: z.enum(['new', 'investigating', 'resolved', 'dismissed']),
  detectedAt: DateTime,
}).strict();

// ---------- Evidence / Investigation / Diagnosis ----------
export const Investigation = z.object({
  ...SchemaMeta, investigationId: Id, anomalyIds: z.array(Id).min(1),
  status: z.enum(['open', 'collecting_evidence', 'diagnosing', 'awaiting_review', 'planned', 'closed']),
  title: z.string().min(1), evidenceIds: z.array(Id),
  diagnosisId: Id.optional(), planId: Id.optional(),
  startedAt: DateTime, updatedAt: DateTime,
}).strict();
export const Evidence = z.object({
  ...SchemaMeta, evidenceId: Id, investigationId: Id,
  category: z.enum(['sales', 'advertising', 'fulfillment', 'reviews', 'social', 'technical', 'inventory']),
  title: z.string().min(1), observation: z.string().min(1),
  window: TimeWindow.optional(),
  measurements: z.array(z.object({ metric: z.string().min(1), value: z.number(),
    unit: z.string().min(1), baseline: z.number().optional(),
  }).strict()),
  sourceRecords: z.array(SourceReference).min(1),
  retrievedAt: DateTime,
}).strict();
export const RootCause = z.enum([
  'ad_fatigue', 'ad_inefficiency', 'delivery_delays', 'product_quality',
  'negative_sentiment', 'checkout_failure', 'discount_failure',
  'stockout', 'viral_demand', 'seasonality', 'unknown',
]);
const Hypothesis = z.object({
  cause: RootCause,
  strength: z.enum(['weak', 'moderate', 'strong']),
  evidenceIds: z.array(Id), counterEvidenceIds: z.array(Id),
  explanation: z.string().min(1),
}).strict();
// Only THIS schema should be requested from the LLM (no server-generated IDs).
export const DiagnosisModelOutput = z.object({
  primaryCause: RootCause, hypotheses: z.array(Hypothesis).min(1),
  summary: z.string().min(1), missingEvidence: z.array(z.string()),
  requiresReview: z.boolean(),
}).strict();
export const Diagnosis = DiagnosisModelOutput.extend({
  ...SchemaMeta, diagnosisId: Id, investigationId: Id,
  modelCallId: Id, taskKey: z.literal('revenue_diagnosis_v1'),
  createdAt: DateTime,
}).strict();

// ---------- Immutable action proposals / partner handoff ----------
export const AgentType = z.enum(['marketing', 'customer_care', 'storefront', 'supplier', 'growth']);
const ActionBaseShape = {
  actionId: Id, agent: AgentType, title: z.string().min(1),
  rationale: z.string().min(1), evidenceIds: z.array(Id),
  dependsOnActionIds: z.array(Id), requiresApproval: z.literal(true),
  risk: z.enum(['low', 'medium', 'high']),
};
const A = <T extends string, P extends z.ZodTypeAny>(actionType: T, params: P) => z.object({
  ...ActionBaseShape, actionType: z.literal(actionType), params,
}).strict();
export const ActionProposal = z.discriminatedUnion('actionType', [
  A('ads.set_daily_budget', z.object({
    campaignId: Id, newDailyBudgetMinor: z.number().int().nonnegative(), currency: Currency,
  }).strict()),
  A('customer.send_delay_notice', z.object({
    orderIds: z.array(Id).min(1), templateId: Id, maxRecipients: z.number().int().positive().max(1000),
  }).strict()),
  A('storefront.publish_banner', z.object({
    bannerId: Id, message: z.string().min(1), startsAt: DateTime, expiresAt: DateTime,
    promoCode: z.string().optional(),
  }).strict()),
  A('marketing.publish_ad', z.object({
    campaignId: Id, creativeAssetId: Id, headline: z.string().min(1),
    destinationUrl: z.string().url(), spendLimitMinor: z.number().int().nonnegative(), currency: Currency,
  }).strict()),
  A('customer.send_promotion_email', z.object({
    customerIds: z.array(Id).min(1), templateId: Id, promoCode: z.string().min(1),
    maxRecipients: z.number().int().positive().max(1000),
  }).strict()),
  A('storefront.create_discount', z.object({
    promoCode: z.string().min(1), productIds: z.array(Id).min(1),
    percentOff: z.number().positive().max(100), maxRedemptions: z.number().int().positive(),
    expiresAt: DateTime,
  }).strict()),
]);
export const SuccessCriterion = z.object({
  metric: MetricName, direction: z.enum(['increase', 'decrease', 'maintain']),
  target: z.number().optional(), measurementWindowMinutes: z.number().int().positive(),
}).strict();
export const ProposedPlan = z.object({
  ...SchemaMeta, planId: Id, planVersion: z.number().int().positive(),
  investigationId: Id, diagnosisId: Id,
  status: z.enum(['proposed', 'awaiting_approval', 'approved', 'partially_approved', 'rejected', 'expired', 'executing', 'completed']),
  objective: z.string().min(1), summary: z.string().min(1),
  actions: z.array(ActionProposal).min(1),
  successCriteria: z.array(SuccessCriterion).min(1),
  createdAt: DateTime, expiresAt: DateTime,
}).strict();
export type ProposedPlanT = z.infer<typeof ProposedPlan>;
export type ActionProposalT = z.infer<typeof ActionProposal>;

// ---------- Approval, orchestration and execution ----------
export const PlanApproval = z.object({
  ...SchemaMeta, approvalId: Id, planId: Id, planVersion: z.number().int().positive(),
  decision: z.enum(['approved', 'rejected', 'changes_requested']),
  approvedActionIds: z.array(Id), rejectedActionIds: z.array(Id),
  reviewedByUserId: Id, reviewedAt: DateTime,
  expiresAt: DateTime, comment: z.string().optional(),
}).strict();
export const AgentMission = z.object({
  ...SchemaMeta, missionId: Id, planId: Id, planVersion: z.number().int().positive(),
  agent: AgentType, actionIds: z.array(Id).min(1), goal: z.string().min(1),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  createdAt: DateTime, updatedAt: DateTime,
}).strict();
export const ActionExecution = z.object({
  ...SchemaMeta, executionId: Id, planId: Id, planVersion: z.number().int().positive(),
  approvalId: Id, actionId: Id, missionId: Id,
  idempotencyKey: Id, status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  attempts: z.number().int().nonnegative(), toolName: z.string().min(1),
  dryRun: z.boolean(), startedAt: DateTime.optional(), finishedAt: DateTime.optional(),
  result: z.object({ providerOperationId: Id.optional(),
    affectedEntityIds: z.array(Id), verification: z.string().min(1),
  }).strict().optional(),
  error: z.object({ code: z.string().min(1), message: z.string().min(1), retryable: z.boolean() }).strict().optional(),
}).strict();
export const ActionOutcome = z.object({
  ...SchemaMeta, outcomeId: Id, executionId: Id, actionId: Id,
  status: z.enum(['verified', 'not_verified', 'monitoring', 'unknown']),
  observedMetricSnapshotIds: z.array(Id), summary: z.string().min(1),
  observedAt: DateTime,
}).strict();

// ---------- Mubit request trace / human feedback / independent evaluation ----------
export const ModelCall = z.object({
  ...SchemaMeta, modelCallId: Id, investigationId: Id.optional(),
  taskKey: z.string().min(1), promptVersion: z.string().min(1),
  instructionsFingerprint: z.string().min(1),
  route: z.literal('mubit'), providerModel: z.string().min(1),
  modelKind: z.enum(['provider', 'adapter']), adapterVersionId: Id.optional(),
  sessionId: Id, inputEvidenceIds: z.array(Id),
  mubitRequestId: z.string().optional(), responseRecordId: Id.optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsdMicros: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(), createdAt: DateTime,
}).strict();
export const ModelCorrection = z.object({
  ...SchemaMeta, correctionId: Id, investigationId: Id, diagnosisId: Id, modelCallId: Id,
  predictedCause: RootCause, correctedCause: RootCause,
  correctedEvidenceIds: z.array(Id), note: z.string().optional(),
  verifiedByUserId: Id, verifiedAt: DateTime,
  ingestionStatus: z.enum(['local_only', 'queued', 'submitted', 'confirmed', 'unsupported']),
}).strict();
export const AdapterRecord = z.object({
  ...SchemaMeta, adapterRecordId: Id, taskKey: z.string().min(1),
  mubitTaskId: z.string().optional(), mubitAdapterVersionId: z.string().optional(),
  status: z.enum(['unknown', 'collecting', 'training', 'testing', 'passed', 'failed']),
  keptExamples: z.number().int().nonnegative().optional(),
  checkedAt: DateTime,
}).strict();
export const EvaluationCase = z.object({
  ...SchemaMeta, evaluationCaseId: Id, datasetId: Id, scenarioId: Id,
  inputEvidenceIds: z.array(Id), groundTruthCause: RootCause,
  split: z.enum(['train', 'validation', 'test']),
}).strict();
export const EvaluationResult = z.object({
  ...SchemaMeta, evaluationResultId: Id, evaluationCaseId: Id,
  modelCallId: Id, modelKind: z.enum(['provider', 'adapter']),
  predictedCause: RootCause, correct: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  costUsdMicros: z.number().int().nonnegative().optional(),
  evaluatedAt: DateTime,
}).strict();

// ---------- Simulator (PRIVATE ground truth never passed to LLM) ----------
export const ScenarioName = z.enum([
  'healthy', 'ad_fatigue', 'delivery_delays', 'negative_reviews',
  'promo_checkout_failure', 'viral_demand',
]);
export const SimulatorRun = z.object({
  ...SchemaMeta, simulationRunId: Id, seed: z.number().int(),
  status: z.enum(['created', 'running', 'paused', 'completed']),
  virtualTime: DateTime, minutesPerTick: z.number().int().positive(),
  activeScenario: ScenarioName, scenarioSeverity: Rate,
  createdAt: DateTime, updatedAt: DateTime,
}).strict();
export const InjectScenarioRequest = z.object({
  simulationRunId: Id, scenario: ScenarioName, severity: Rate,
}).strict();
export const SimulatorTickRequest = z.object({
  simulationRunId: Id, ticks: z.number().int().positive().max(60).default(1),
}).strict();
export const SimulatorTickResponse = z.object({
  simulationRunId: Id, virtualTime: DateTime,
  generatedEventIds: z.array(Id), generatedEventsCount: z.number().int().nonnegative(),
  metricSnapshotIds: z.array(Id),
}).strict();
/** Server-only fixture. NEVER pass this record to the investigation model. */
export const ScenarioGroundTruth = z.object({
  simulationRunId: Id, scenario: ScenarioName,
  actualCauses: z.array(RootCause).min(1),
  hiddenFaultParameters: z.record(z.string(), z.unknown()),
}).strict();

// ---------- API response wrappers ----------
export const ApiError = z.object({ error: z.object({
  code: z.string().min(1), message: z.string().min(1), requestId: Id,
}).strict() }).strict();
export const IngestResult = z.object({
  accepted: z.number().int().nonnegative(), duplicates: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(), eventIds: z.array(Id),
}).strict();
export const PlanHandoff = z.object({
  plan: ProposedPlan, diagnosis: Diagnosis, evidence: z.array(Evidence),
}).strict();

export type BusinessT = z.infer<typeof Business>;
export type IntegrationT = z.infer<typeof Integration>;
export type MetricSnapshotT = z.infer<typeof MetricSnapshot>;
export type AnomalyT = z.infer<typeof Anomaly>;
export type InvestigationT = z.infer<typeof Investigation>;
export type EvidenceT = z.infer<typeof Evidence>;
export type DiagnosisT = z.infer<typeof Diagnosis>;
export type DiagnosisModelOutputT = z.infer<typeof DiagnosisModelOutput>;
export type PlanApprovalT = z.infer<typeof PlanApproval>;
export type AgentMissionT = z.infer<typeof AgentMission>;
export type ActionExecutionT = z.infer<typeof ActionExecution>;
export type ModelCallT = z.infer<typeof ModelCall>;
export type ModelCorrectionT = z.infer<typeof ModelCorrection>;
export type SimulatorRunT = z.infer<typeof SimulatorRun>;
