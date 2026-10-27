import "server-only";
import type { Db } from "mongodb";
import { z } from "zod";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { DETECTOR_VERSION } from "@/intelligence/config";
import { listTools } from "@/intelligence/evidence/registry";
import { monitorStatus } from "@/intelligence/monitor";

export type StageStatus = "operational" | "waiting_for_data" | "running" | "failed" | "not_implemented" | "partner_pending";
export interface StageCapability {
  id: "observe" | "detect" | "retrieve" | "investigate" | "plan" | "approve" | "execute" | "verify" | "learn";
  name: string; description: string; implemented: boolean; status: StageStatus; summary: string;
  input: string; output: string; backend: string; link: string | null; metrics: Record<string, number | string | boolean | null>;
}

const Query = z.object({ businessId: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/).default("nike_demo"), simulationRunId: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/).optional() }).strict();

/** Reports what is genuinely operational. Future stages are identified by implementation metadata, never by placeholder presence. */
export async function getCapabilities(input: unknown, dbOverride?: Db) {
  const q = Query.parse(input);
  const db = dbOverride ?? (await getDb());
  const scope = { businessId: q.businessId, ...(q.simulationRunId ? { simulationRunId: q.simulationRunId } : {}) };
  const [events, snapshots, investigations, incidents, anomalies, collections, latestCollection, evidence, diagnoses, plans, monitor] = await Promise.all([
    db.collection(COLLECTIONS.businessEvents).countDocuments(scope, { limit: 1_000_000 }),
    db.collection(COLLECTIONS.metricSnapshots).countDocuments(scope),
    db.collection(COLLECTIONS.investigations).countDocuments(scope),
    db.collection(COLLECTIONS.incidents).countDocuments({ ...scope, status: { $in: ["monitoring", "investigating"] } }),
    db.collection(COLLECTIONS.anomalies).countDocuments(scope),
    db.collection(COLLECTIONS.evidenceCollections).countDocuments(scope),
    db.collection(COLLECTIONS.evidenceCollections).findOne(scope, { sort: { startedAt: -1 }, projection: { _id: 0, status: 1, startedAt: 1, completedAt: 1, failedTools: 1, completedTools: 1 } }),
    db.collection(COLLECTIONS.evidence).countDocuments(scope),
    db.collection(COLLECTIONS.diagnoses).countDocuments(scope),
    db.collection(COLLECTIONS.plans).countDocuments(scope),
    q.simulationRunId ? monitorStatus(q.businessId, q.simulationRunId, db) : Promise.resolve(null),
  ]);
  const tools = listTools();
  const jobs = monitor?.jobs ?? {};
  const detectStatus: StageStatus = !q.simulationRunId ? (anomalies + investigations > 0 || events > 0 ? "operational" : "waiting_for_data")
    : (monitor?.failedJobs?.length ? "failed" : (jobs.running ?? 0) + (jobs.pending ?? 0) > 0 ? "running" : monitor?.lastAsOf ? "operational" : events > 0 ? "waiting_for_data" : "waiting_for_data");
  const retrieveStatus: StageStatus = latestCollection?.status === "running" ? "running" : latestCollection?.status === "failed" ? "failed" : investigations === 0 ? "waiting_for_data" : "operational";
  const stages: StageCapability[] = [
    { id: "observe", name: "Observe", description: "The Nike digital twin generates sessions, orders, ads, deliveries and reviews; ingestion validates and persists canonical events and hourly metric snapshots.",
      implemented: true, status: events > 0 ? "operational" : "waiting_for_data", summary: events > 0 ? `${events.toLocaleString("en-GB")} canonical events, ${snapshots.toLocaleString("en-GB")} metric snapshots` : "No events persisted for this scope yet",
      input: "Simulator ticks / connector webhooks", output: "business_events, metric_snapshots", backend: "src/simulator, src/ingestion, src/analytics", link: "/dev/simulator", metrics: { events, snapshots } },
    { id: "detect", name: "Detect", description: "Durable monitoring jobs (direct trigger and Change Stream worker) run the detector: baselines, seven rule families, correlation, severity; canonical anomalies and investigations are persisted.",
      implemented: true, status: detectStatus, summary: monitor ? `Analysed to ${monitor.lastAsOf ?? "—"}; jobs ${JSON.stringify(jobs)}; worker ${monitor.worker.connected ? "connected" : "not connected"}; direct trigger ${monitor.methodA.enabled ? "enabled" : "disabled"}` : `${anomalies} anomalies, ${investigations} investigations in scope`,
      input: "metric_snapshots, business_events", output: "anomalies, incidents, investigations", backend: `src/intelligence/detection, src/intelligence/monitoring (${DETECTOR_VERSION})`, link: "/dev/monitor",
      metrics: { anomalies, investigations, activeIncidents: incidents, workerConnected: monitor?.worker.connected ?? null, directTrigger: monitor?.methodA.enabled ?? null, lastAsOf: monitor?.lastAsOf ?? null, pendingJobs: jobs.pending ?? 0, failedJobs: jobs.failed ?? 0 } },
    { id: "retrieve", name: "Retrieve", description: "Deterministic policy selects read-only evidence tools from the observed anomalies; tools query canonical records, compute comparisons, verify provenance and persist canonical Evidence plus execution traces.",
      implemented: true, status: retrieveStatus, summary: `${tools.length} tools registered; ${collections} collection run(s), ${evidence} evidence records in scope${latestCollection ? `; latest ${latestCollection.status}` : ""}`,
      input: "investigations, anomalies, incidents, canonical records", output: "evidence, evidence_details, evidence_tool_runs", backend: "src/intelligence/evidence", link: null,
      metrics: { tools: tools.length, collections, evidence, latestStatus: latestCollection?.status ?? null } },
    { id: "investigate", name: "Investigate", description: "Mubit investigator: hypotheses, supporting/contradicting evidence, further tool calls and a structured DiagnosisModelOutput.", implemented: true, status: diagnoses > 0 ? "operational" : "waiting_for_data",
      summary: `${diagnoses} persisted diagnoses in this scope; durable worker processes operator-started investigations`, input: "Evidence, Investigation", output: "Diagnosis (contracts: DiagnosisModelOutput → Diagnosis)", backend: "src/intelligence/investigator; npm run investigator:work", link: null, metrics: { diagnoses } },
    { id: "plan", name: "Plan", description: "Mubit compares strategies; deterministic validation creates approval-required proposals without executing actions.", implemented: true, status: plans ? "operational" : "waiting_for_data",
      summary: `${plans} plans in scope; open a completed investigation to compare solutions`, input: "Validated Diagnosis, Evidence", output: "ProposedPlan, PlanHandoff", backend: "src/planner; npm run planner:work; GET /api/plans/:id", link: "/dashboard/investigations", metrics: { plans } },
    { id: "approve", name: "Approve", description: "Human approval of proposed actions (PlanApproval).", implemented: true, status: plans ? "operational" : "waiting_for_data", summary: "Review immutable versions and persisted human decisions in Approvals",
      input: "ProposedPlan", output: "PlanApproval", backend: "src/execution; partner PlanReview", link: "/dashboard/approvals", metrics: { plans } },
    { id: "execute", name: "Execute", description: "Agent missions execute approved actions through partner adapters (budget, delay notice, banner) with idempotent receipts.", implemented: true, status: plans ? "operational" : "waiting_for_data",
      summary: "Inspect durable action attempts in Activity; approval and current-state checks required", input: "PlanApproval, ActionProposal", output: "AgentMission, ActionExecution, callback events", backend: "src/execution; src/adapters", link: "/dashboard/activity", metrics: { plans } },
    { id: "verify", name: "Verify", description: "Read-only before/after observation of executed actions, with separate operational and business results.", implemented: true, status: plans ? "operational" : "waiting_for_data", summary: "Evaluate exact approved executions and inspect durable, sourced assessments in Outcomes",
      input: "Approved ActionExecution, receipts, simulated metric events", output: "BusinessOutcomeAssessment", backend: "src/outcomes; POST /api/outcomes/evaluate", link: "/dashboard/outcomes", metrics: {} },
    { id: "learn", name: "Learn", description: "Outcome history for human review and future planning context.", implemented: true, status: plans ? "operational" : "waiting_for_data", summary: "Scoped outcome history is available; no model training or automatic planner adaptation is claimed",
      input: "BusinessOutcomeAssessment", output: "Read-only outcome history", backend: "GET /api/outcomes", link: "/dashboard/outcomes", metrics: {} },
  ];
  return { businessId: q.businessId, simulationRunId: q.simulationRunId ?? null, generatedAt: new Date().toISOString(), detectorVersion: DETECTOR_VERSION, tools, stages };
}
