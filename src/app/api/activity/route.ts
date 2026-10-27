import type { Document } from "mongodb";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { businessIdFrom, guardDevRoute, handleRouteError } from "@/lib/route-helpers";

type Kind = "monitoring" | "incident" | "tool" | "agent" | "decision" | "business";
type Clock = "recorded" | "simulation";
interface ActivityItem { id: string; at: string; clock: Clock; kind: Kind; source: string; title: string; detail: string; status: string; href: string | null }

const label = (value: unknown) => String(value ?? "").replaceAll(/[._]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const timestamp = (value: unknown) => {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
};
const text = (value: unknown) => typeof value === "string" ? value : "";
const number = (value: unknown) => typeof value === "number" ? value : 0;
const investigationLink = (id: unknown) => typeof id === "string" && id ? `/dashboard/investigations/${encodeURIComponent(id)}` : null;

/** Read-only, run-scoped presentation of persisted operations. No provider or simulator work is triggered here. */
export async function GET(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    const businessId = businessIdFrom(request);
    const simulationRunId = new URL(request.url).searchParams.get("simulationRunId");
    if (!simulationRunId || !/^[a-z0-9_]{1,64}$/.test(simulationRunId)) return Response.json({ error: { message: "A valid simulation run is required." } }, { status: 400 });
    const db = await getDb();
    const scope = { businessId, simulationRunId };
    const read = (collection: string, sort: Document, limit: number, projection: Document) => db.collection(collection).find(scope, { projection: { _id: 0, ...projection } }).sort(sort).limit(limit).toArray();
    const [scans, monitorJobs, incidents, collections, tools, jobs, calls, planning, approvals, executions, business] = await Promise.all([
      read(COLLECTIONS.monitorRuns, { lastScannedAt: -1 }, 40, { scanId: 1, lastScannedAt: 1, asOf: 1, "summary.findings.active": 1 }),
      db.collection(COLLECTIONS.monitoringJobs).find({ ...scope, status: { $in: ["pending", "running", "failed"] } }, { projection: { _id: 0, jobKey: 1, status: 1, createdAt: 1, windowEnd: 1, attempts: 1 } }).sort({ createdAt: -1 }).limit(40).toArray(),
      read(COLLECTIONS.incidents, { lastTriggeredAt: -1 }, 60, { incidentId: 1, investigationId: 1, title: 1, status: 1, onsetAt: 1, lastTriggeredAt: 1, severity: 1 }),
      read(COLLECTIONS.evidenceCollections, { startedAt: -1 }, 40, { collectionId: 1, investigationId: 1, status: 1, startedAt: 1, completedAt: 1, completedTools: 1, failedTools: 1 }),
      read(COLLECTIONS.evidenceToolRuns, { startedAt: -1 }, 160, { toolRunId: 1, investigationId: 1, tool: 1, status: 1, startedAt: 1, durationMs: 1, resultCount: 1, sourceRecordCount: 1, emptyResult: 1, error: 1 }),
      read(COLLECTIONS.investigationJobs, { updatedAt: -1 }, 50, { jobId: 1, investigationId: 1, status: 1, stage: 1, createdAt: 1, updatedAt: 1, callCount: 1 }),
      read(COLLECTIONS.investigationCalls, { startedAt: -1 }, 160, { callId: 1, investigationId: 1, task: 1, status: 1, startedAt: 1, metadata: 1, error: 1 }),
      read(COLLECTIONS.planningJobs, { updatedAt: -1 }, 50, { jobId: 1, investigationId: 1, status: 1, stage: 1, updatedAt: 1, planId: 1 }),
      read(COLLECTIONS.planApprovals, { "approval.reviewedAt": -1 }, 50, { planId: 1, "approval.approvalId": 1, "approval.decision": 1, "approval.reviewedAt": 1, "approval.approvedActionIds": 1 }),
      read(COLLECTIONS.actionExecutions, { "execution.startedAt": -1 }, 80, { "execution.executionId": 1, "execution.toolName": 1, "execution.status": 1, "execution.startedAt": 1, "execution.error.message": 1 }),
      db.collection(COLLECTIONS.businessEvents).aggregate<{ _id: { type: string; source: string }; count: number; latest: string }>([
        { $match: scope },
        { $group: { _id: { type: "$type", source: "$source" }, count: { $sum: 1 }, latest: { $max: "$occurredAt" } } },
        { $sort: { latest: -1 } }, { $limit: 80 },
      ]).toArray(),
    ]);
    const items: ActivityItem[] = [];
    const add = (id: string, atValue: unknown, clock: Clock, kind: Kind, source: string, title: string, detail: string, status: string, href: string | null = null) => {
      const at = timestamp(atValue);
      if (at) items.push({ id, at, clock, kind, source, title, detail, status, href });
    };

    for (const row of scans) add(`scan:${row.scanId ?? row.lastScannedAt}`, row.lastScannedAt, "recorded", "monitoring", "Monitor", "Anomaly scan completed", `${number(row.summary?.findings?.active)} active findings`, "completed", "/dashboard/monitoring");
    for (const row of monitorJobs) add(`monitor-job:${row.jobKey}`, row.createdAt, "recorded", "monitoring", "Monitor", "Scheduled monitoring job", `${label(row.status)} · window ending ${text(row.windowEnd).slice(0, 16).replace("T", " ")} UTC`, text(row.status), "/dashboard/monitoring");
    for (const row of incidents) add(`incident:${row.incidentId}`, row.onsetAt ?? row.lastTriggeredAt, "simulation", "incident", "Detection", text(row.title) || "Incident detected", `Consolidated incident · ${label(row.severity?.level)} severity`, text(row.status) || "detected", investigationLink(row.investigationId) ?? "/dashboard/signals");
    for (const row of collections) add(`collection:${row.collectionId}`, row.completedAt ?? row.startedAt, "recorded", "tool", "Evidence", `Evidence collection ${row.status === "running" ? "started" : "finished"}`, `${(row.completedTools?.length ?? 0)} tools completed${row.failedTools?.length ? ` · ${row.failedTools.length} failed` : ""}`, text(row.status) || "running", investigationLink(row.investigationId));
    for (const row of tools) add(`tool:${row.toolRunId}`, row.startedAt, "recorded", "tool", "Tool call", label(row.tool), row.status === "empty" ? "No matching records" : row.status === "failed" ? "Tool failed" : `${number(row.resultCount)} results · ${number(row.sourceRecordCount)} source records${number(row.durationMs) ? ` · ${(number(row.durationMs) / 1000).toFixed(1)}s` : ""}`, text(row.status), investigationLink(row.investigationId));
    for (const row of jobs) add(`job:${row.jobId}`, row.updatedAt ?? row.createdAt, "recorded", "agent", "Investigator", "Investigator status", `${label(row.stage || row.status)} · ${number(row.callCount)} model calls`, text(row.status), investigationLink(row.investigationId));
    for (const row of calls) {
      if (row.task === "system.insufficient_evidence") continue;
      const provider = row.metadata?.provider === "mubit" ? "Mubit" : row.metadata?.provider === "google_direct" ? "Google" : "Model";
      const task = text(row.task).includes("solution_planning") ? "Solution planning" : text(row.task).includes("diagnosis") ? "Root cause diagnosis" : text(row.task).includes("source_support") ? "Source review" : text(row.task) === "external_research" ? "External research" : "Investigation reasoning";
      const duration = number(row.metadata?.latencyMs);
      add(`call:${row.callId}`, row.startedAt, "recorded", "agent", provider, `${provider} agent call · ${task}`, `${label(row.status)}${duration ? ` · ${(duration / 1000).toFixed(1)}s` : ""}`, text(row.status), investigationLink(row.investigationId));
    }
    for (const row of planning) add(`planning:${row.jobId}`, row.updatedAt, "recorded", "agent", "Planner", "Solution planning status", label(row.stage || row.status), text(row.status), investigationLink(row.investigationId));
    for (const row of approvals) add(`approval:${row.approval?.approvalId}`, row.approval?.reviewedAt, "recorded", "decision", "Approval", `Plan ${label(row.approval?.decision)}`, `${row.approval?.approvedActionIds?.length ?? 0} actions approved`, text(row.approval?.decision), "/dashboard/approvals");
    for (const row of executions) add(`execution:${row.execution?.executionId}`, row.execution?.startedAt, "recorded", "decision", "Action", label(row.execution?.toolName) || "Agent action", text(row.execution?.error?.message) || "Approved action execution", text(row.execution?.status), "/dashboard/approvals");
    for (const row of business) add(`business:${row._id.type}:${row._id.source}`, row.latest, "simulation", "business", label(row._id.source), label(row._id.type), `${row.count.toLocaleString()} canonical events in this run`, "recorded");

    items.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
    return Response.json({ businessId, simulationRunId, items, generatedAt: new Date().toISOString() });
  } catch (error) {
    return handleRouteError(error, "activity");
  }
}
