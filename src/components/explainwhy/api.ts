/** Client-side API helper and response types shared by the unified dashboard. All data comes from real routes. */
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = "ApiRequestError"; }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiRequestError(body?.error?.message ?? `Request failed (${res.status})`, res.status, body?.error?.code);
  return body as T;
}

export const q = (params: Record<string, string | number | null | undefined>) =>
  Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");

export type Severity = "low" | "medium" | "high" | "critical";
export interface RunsResponse { activeSimulationRunId: string | null; runs: Array<{ simulationRunId: string; virtualTime: string; status: string; seed: number }> }
export interface MonitorStatus {
  lastAsOf: string | null; lastScanAt: string | null; watermark: string | null; jobs?: Record<string, number>; methodA?: { enabled: boolean };
  failedJobs?: Array<{ jobKey: string; lastError: string; attempts: number }>; worker?: { connected: boolean; lastHeartbeatAt: string | null; lastError: string | null };
}
export interface StageCapability {
  id: string; name: string; description: string; implemented: boolean; status: "operational" | "waiting_for_data" | "running" | "failed" | "not_implemented" | "partner_pending";
  summary: string; input: string; output: string; backend: string; link: string | null; metrics: Record<string, number | string | boolean | null>;
}
export interface Capabilities { businessId: string; simulationRunId: string | null; generatedAt: string; detectorVersion: string; tools: Array<{ name: string; title: string; description: string; category: string }>; stages: StageCapability[] }
export interface IncidentRow { incidentId: string; title: string; status: string; polarity: string; primaryTheme: string; severity: { level: Severity; score: number }; findingIds: string[]; anomalyIds: string[]; investigationId: string | null; onsetAt: string; lastTriggeredAt: string; summary: string }
export interface AnomalyRow { anomaly: { anomalyId: string; metric: string; direction: string; severity: Severity; status: string; actualValue: number; baselineValue: number; changePercent: number; detectedAt: string }; finding: { label: string; segmentLabel: string } | null }
export interface InvestigationRow { investigation: { investigationId: string; title: string; status: string; anomalyIds: string[]; evidenceIds: string[]; startedAt: string; updatedAt: string; diagnosisId?: string }; simulationRunId: string; incident: { severity: { level: Severity; score: number }; primaryTheme: string; status: string } | null }
export interface Bundle {
  investigation: { investigationId: string; title: string; status: string; startedAt: string; updatedAt: string; anomalyIds: string[]; evidenceIds: string[]; businessId: string };
  simulationRunId: string; incident: IncidentRow & { affected: { campaigns: string[]; products: string[]; channels: string[]; categories: string[] } } | null;
  anomalies: Array<{ anomalyId: string; metric: string; direction: string; severity: Severity; actualValue: number; baselineValue: number; changePercent: number; currentWindow: { startAt: string; endAt: string }; detectedAt: string }>;
  findings: Array<{ findingId: string; label: string; segmentLabel: string; status: string; severity: { level: Severity; score: number } }>;
  timeWindows: { incident: { startAt: string | null; endAt: string | null } }; affected: { campaigns: string[]; products: string[]; channels: string[]; categories: string[] }; note: string;
}
export interface Measurement { metric: string; value: number; unit: string; baseline?: number }
export interface EvidenceItem {
  evidence: { businessId: string; evidenceId: string; category: string; title: string; observation: string; window?: { startAt: string; endAt: string }; measurements: Measurement[]; sourceRecords: Array<{ collection: string; recordId: string; sourceUrl?: string }>; retrievedAt: string };
  tool: string | null; dataOrigin: string | null; collectionId: string | null; toolRunId: string | null; detail: Record<string, unknown> | null; warnings: string[]; input: Record<string, unknown> | null;
  verification: { passed: boolean; checks: Array<{ name: string; passed: boolean; note: string }>; resolvedSources: number; unresolvedSources: string[] } | null;
  simulationRunId?: string; campaignMetadata?: Array<{ campaignId: string; name: string; platform: string }>;
}
export interface EvidenceList { total: number; items: EvidenceItem[]; investigationStatus: string; latestCollection: CollectionDoc | null }
export interface CollectionDoc { collectionId: string; mode: string; cutoff: string; status: string; startedAt: string; completedAt: string | null; selectedTools: Array<{ tool: string; reason: string; role: string }>; completedTools: string[]; failedTools: string[]; emptyTools: string[]; evidenceIds: string[]; warnings: string[]; attempt: number; windows: { incident: { startAt: string; endAt: string }; baseline: { startAt: string; endAt: string } | null }; error?: string | null }
export interface ToolRun { toolRunId: string; collectionId: string; tool: string; role: string; reason: string; input: Record<string, unknown>; status: "completed" | "failed" | "empty"; startedAt: string; completedAt: string; durationMs: number; resultCount: number; evidenceIds: string[]; sourceRecordCount: number; warnings: string[]; error: string | null; emptyResult: string | null; dataSources: Array<{ collection?: string; externalSource?: string; description: string; origin: string }> }
export interface Trace { investigationStatus: string; evidenceIds: string[]; collections: CollectionDoc[]; toolRuns: ToolRun[] }
export interface CollectionSummary { collectionId: string; status: string; reused: boolean; cutoff: string; evidenceIds: string[]; outcomes: Array<{ tool: string; status: string; durationMs: number; evidenceIds: string[]; error: string | null; emptyResult: string | null }>; warnings: string[] }

export const sevClass = (s: Severity | string) => (s === "critical" ? "danger" : s === "high" ? "warn" : s === "medium" ? "accent" : "");
export const statusClass = (s: StageCapability["status"] | string) => (s === "operational" || s === "completed" ? "ok" : s === "running" ? "accent" : s === "failed" ? "danger" : s === "waiting_for_data" || s === "partial" ? "warn" : "");
export const STATUS_LABEL: Record<string, string> = { operational: "Operational", waiting_for_data: "Waiting for data", running: "Running", failed: "Failed", not_implemented: "Not implemented", partner_pending: "Partner integration pending" };
