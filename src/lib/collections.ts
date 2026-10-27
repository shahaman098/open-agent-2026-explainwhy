import "server-only";

import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";

/** Every MongoDB collection this stage writes to. Names are stable API for the partner. */
export const COLLECTIONS = {
  businesses: "businesses",
  referenceProducts: "reference_products",
  referenceFinancials: "reference_financials",
  simulatorState: "simulator_state",
  simulatorGroundTruth: "simulator_ground_truth",
  simulatedProducts: "simulated_products",
  simulatedCustomers: "simulated_customers",
  simulatedSessions: "simulated_sessions",
  simulatedOrders: "simulated_orders",
  simulatedCampaigns: "simulated_campaigns",
  simulatedShipments: "simulated_shipments",
  simulatedReviews: "simulated_reviews",
  simulatedStorefront: "simulated_storefront",
  simulatedMessages: "simulated_messages",
  businessEvents: "business_events",
  metricSnapshots: "metric_snapshots",
  plans: "plans",
  diagnoses: "diagnoses",
  evidence: "evidence",
  actionReceipts: "action_receipts",
  anomalies: "anomalies",
  investigations: "investigations",
  detectionFindings: "detection_findings",
  detectionObservations: "detection_observations",
  incidents: "incidents",
  monitorRuns: "monitor_runs",
  monitorState: "monitor_state",
  monitoringWindows: "monitoring_windows",
  monitoringJobs: "monitoring_jobs",
  monitoringWorkers: "monitoring_workers",
  evidenceCollections: "evidence_collections",
  evidenceToolRuns: "evidence_tool_runs",
  evidenceDetails: "evidence_details",
  investigationJobs: "investigation_jobs",
  investigationCalls: "investigation_calls",
  investigationReports: "investigation_reports",
  externalSources: "external_sources",
  planningJobs: "planning_jobs",
  planApprovals: "plan_approvals",
  agentRuns: "agent_runs",
  agentMissions: "agent_missions",
  actionExecutions: "action_executions",
  actionOutcomes: "action_outcomes",
  businessOutcomeAssessments: "business_outcome_assessments",
  outcomeFeedback: "outcome_feedback",
} as const;

let indexesReady: Promise<void> | undefined;

/**
 * Creates every index the services rely on. Idempotent (createIndex is a no-op
 * when the index exists) and memoised per process so request handlers can call
 * it freely.
 */
export function ensureIndexes(db?: Db): Promise<void> {
  if (!indexesReady) {
    indexesReady = (async () => {
      const d = db ?? (await getDb());
      await Promise.all([
        d.collection(COLLECTIONS.businesses).createIndex({ businessId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.referenceProducts).createIndex({ referenceProductId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.referenceFinancials).createIndex({ referenceId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.simulatorState).createIndex({ businessId: 1, simulationRunId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.simulatorGroundTruth).createIndex({ simulationRunId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.simulatedProducts).createIndex({ businessId: 1, simulationRunId: 1, productId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.simulatedCustomers).createIndex({ businessId: 1, simulationRunId: 1, customerId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.simulatedSessions).createIndex({ businessId: 1, simulationRunId: 1, sessionId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.simulatedSessions).createIndex({ businessId: 1, simulationRunId: 1, startedAt: -1 }),
        d.collection(COLLECTIONS.simulatedOrders).createIndex({ businessId: 1, orderId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.simulatedOrders).createIndex(
          { businessId: 1, idempotencyKey: 1 },
          { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
        ),
        d.collection(COLLECTIONS.simulatedOrders).createIndex({ businessId: 1, simulationRunId: 1, placedAt: -1 }),
        d.collection(COLLECTIONS.simulatedCampaigns).createIndex({ businessId: 1, simulationRunId: 1, campaignId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.simulatedShipments).createIndex({ businessId: 1, orderId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.simulatedShipments).createIndex({ businessId: 1, simulationRunId: 1, status: 1, nextTransitionAt: 1 }),
        d.collection(COLLECTIONS.simulatedReviews).createIndex({ businessId: 1, reviewId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.simulatedStorefront).createIndex({ businessId: 1, simulationRunId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.simulatedMessages).createIndex({ businessId: 1, messageId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.businessEvents).createIndex(
          { businessId: 1, "provenance.connectorId": 1, "provenance.sourceRecordId": 1 },
          { unique: true, name: "uniq_business_connector_source" },
        ),
        d.collection(COLLECTIONS.businessEvents).createIndex({ businessId: 1, eventId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.businessEvents).createIndex({ businessId: 1, occurredAt: -1, type: 1 }),
        d.collection(COLLECTIONS.businessEvents).createIndex({ businessId: 1, simulationRunId: 1, type: 1, occurredAt: 1 }),
        d.collection(COLLECTIONS.businessEvents).createIndex({ businessId: 1, "payload.orderId": 1, type: 1 }),
        d.collection(COLLECTIONS.businessEvents).createIndex({ businessId: 1, simulationRunId: 1, type: 1, "payload.promisedAt": 1 }),
        d.collection(COLLECTIONS.metricSnapshots).createIndex({ businessId: 1, snapshotId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.metricSnapshots).createIndex({ businessId: 1, "window.startAt": -1 }),
        d.collection(COLLECTIONS.plans).createIndex({ businessId: 1, planId: 1, planVersion: 1 }, { unique: true }),
        d.collection(COLLECTIONS.diagnoses).createIndex({ businessId: 1, diagnosisId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.evidence).createIndex({ businessId: 1, investigationId: 1 }),
        d.collection(COLLECTIONS.evidence).createIndex({ businessId: 1, evidenceId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.evidenceCollections).createIndex({ collectionId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.evidenceCollections).createIndex({ businessId: 1, simulationRunId: 1, investigationId: 1, startedAt: -1 }),
        d.collection(COLLECTIONS.evidenceToolRuns).createIndex({ toolRunId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.evidenceToolRuns).createIndex({ businessId: 1, investigationId: 1, collectionId: 1, startedAt: 1 }),
        d.collection(COLLECTIONS.evidenceDetails).createIndex({ businessId: 1, evidenceId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.actionReceipts).createIndex({ businessId: 1, idempotencyKey: 1 }, { unique: true }),
        d.collection(COLLECTIONS.anomalies).createIndex({ businessId: 1, anomalyId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.anomalies).createIndex({ businessId: 1, simulationRunId: 1, detectedAt: -1 }),
        d.collection(COLLECTIONS.anomalies).createIndex({ businessId: 1, simulationRunId: 1, status: 1, severity: 1 }),
        d.collection(COLLECTIONS.investigations).createIndex({ businessId: 1, investigationId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.investigations).createIndex({ businessId: 1, simulationRunId: 1, startedAt: -1 }),
        d.collection(COLLECTIONS.detectionFindings).createIndex({ businessId: 1, simulationRunId: 1, findingId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.detectionFindings).createIndex({ businessId: 1, simulationRunId: 1, signalId: 1, segmentKey: 1, direction: 1, status: 1 }),
        d.collection(COLLECTIONS.detectionFindings).createIndex({ businessId: 1, simulationRunId: 1, incidentId: 1 }),
        d.collection(COLLECTIONS.detectionObservations).createIndex({ businessId: 1, observationId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.detectionObservations).createIndex({ businessId: 1, findingId: 1, asOf: -1 }),
        d.collection(COLLECTIONS.incidents).createIndex({ businessId: 1, simulationRunId: 1, incidentId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.incidents).createIndex({ businessId: 1, simulationRunId: 1, status: 1, lastTriggeredAt: -1 }),
        d.collection(COLLECTIONS.monitorRuns).createIndex({ businessId: 1, simulationRunId: 1, asOf: 1 }, { unique: true }),
        d.collection(COLLECTIONS.monitorRuns).createIndex({ businessId: 1, simulationRunId: 1, lastScannedAt: -1 }),
        d.collection(COLLECTIONS.monitorState).createIndex({ businessId: 1, simulationRunId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.monitoringWindows).createIndex({ windowKey: 1 }, { unique: true }),
        d.collection(COLLECTIONS.monitoringWindows).createIndex({ businessId: 1, simulationRunId: 1, windowEnd: 1 }),
        d.collection(COLLECTIONS.monitoringJobs).createIndex({ jobKey: 1 }, { unique: true }),
        d.collection(COLLECTIONS.monitoringJobs).createIndex({ businessId: 1, simulationRunId: 1, windowEnd: 1, status: 1 }),
        d.collection(COLLECTIONS.monitoringJobs).createIndex({ status: 1, nextAttemptAt: 1, leaseUntil: 1 }),
        d.collection(COLLECTIONS.monitoringWorkers).createIndex({ workerId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.businessOutcomeAssessments).createIndex({ assessmentId: 1 }, { unique: true }),
        d.collection(COLLECTIONS.businessOutcomeAssessments).createIndex({ businessId: 1, simulationRunId: 1, planId: 1, planVersion: 1, actionId: 1, "window.startAt": 1 }, { unique: true }),
        d.collection(COLLECTIONS.outcomeFeedback).createIndex({ businessId: 1, simulationRunId: 1, assessmentId: 1 }, { unique: true }),
      ]);
    })().catch((error: unknown) => {
      indexesReady = undefined;
      throw error;
    });
  }
  return indexesReady;
}
