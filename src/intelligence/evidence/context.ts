import "server-only";
import type { Db } from "mongodb";
import { Anomaly, Investigation, type AnomalyT, type InvestigationT } from "@normal/contracts";
import { COLLECTIONS } from "@/lib/collections";
import type { FindingDoc, IncidentDoc } from "@/intelligence/detection/persistence";
import { loadCatalogue } from "@/intelligence/monitor";
import { loadHorizon } from "@/intelligence/signals/load";
import type { CatalogueLabel } from "@/intelligence/types";
import { HOUR, MAX_BASELINE_HOURS, MAX_WINDOW_HOURS, type WindowT } from "./types";

/** Everything the routing policy and tools may know about an investigation: observable detector output only. */
export interface InvestigationContext {
  db: Db;
  businessId: string;
  simulationRunId: string;
  investigation: InvestigationT;
  incident: IncidentDoc | null;
  anomalies: AnomalyT[];
  findings: Array<Pick<FindingDoc, "findingId" | "signalId" | "theme" | "family" | "direction" | "polarity" | "segment" | "segmentKey" | "status" | "severity" | "canonicalMetric">>;
  themes: Set<string>;
  signalIds: Set<string>;
  metrics: Set<string>;
  affected: { campaigns: string[]; products: string[]; channels: string[]; categories: string[] };
  severity: "low" | "medium" | "high" | "critical";
  polarity: "negative" | "positive" | "mixed";
  /** Latest fully observed hour; the data cutoff of a collection. */
  cutoff: string;
  historyStart: string;
  incidentWindow: WindowT;
  baselineWindow: WindowT | undefined;
  catalogue: Map<string, CatalogueLabel>;
}

const SEVERITY_ORDER = ["low", "medium", "high", "critical"] as const;

export async function loadInvestigationContext(db: Db, investigationId: string, scope: { businessId: string; simulationRunId?: string }): Promise<InvestigationContext | null> {
  const raw = await db.collection(COLLECTIONS.investigations).findOne({ investigationId, ...scope }, { projection: { _id: 0 } });
  if (!raw) return null;
  const { simulationRunId, ...canonical } = raw as unknown as InvestigationT & { simulationRunId: string };
  const investigation = Investigation.parse(canonical);
  const { businessId } = investigation;
  const [incident, anomalyDocs, horizon, catalogue] = await Promise.all([
    db.collection<IncidentDoc>(COLLECTIONS.incidents).findOne({ businessId, simulationRunId, investigationId }, { projection: { _id: 0, history: 0 } }),
    db.collection(COLLECTIONS.anomalies).find({ businessId, simulationRunId, anomalyId: { $in: investigation.anomalyIds } }, { projection: { _id: 0, simulationRunId: 0 } }).toArray(),
    loadHorizon(db, businessId, simulationRunId),
    loadCatalogue(db, businessId, simulationRunId),
  ]);
  if (!horizon) return null;
  const anomalies = anomalyDocs.map((d) => Anomaly.parse(d));
  const findings = incident
    ? await db.collection<FindingDoc>(COLLECTIONS.detectionFindings).find({ businessId, simulationRunId, findingId: { $in: incident.findingIds } },
      { projection: { _id: 0, findingId: 1, signalId: 1, theme: 1, family: 1, direction: 1, polarity: 1, segment: 1, segmentKey: 1, status: 1, severity: 1, canonicalMetric: 1 } }).toArray()
    : [];
  const cutoff = horizon.watermark;
  const onset = incident?.onsetAt ?? anomalies.reduce((a, x) => (x.currentWindow.startAt < a ? x.currentWindow.startAt : a), anomalies[0]?.currentWindow.startAt ?? cutoff);
  const lastSeen = anomalies.reduce((a, x) => (x.currentWindow.endAt > a ? x.currentWindow.endAt : a), incident?.lastTriggeredAt ?? onset);
  let end = lastSeen > cutoff ? cutoff : lastSeen;
  if (end <= onset) end = new Date(Math.min(Date.parse(cutoff), Date.parse(onset) + HOUR)).toISOString();
  const start = new Date(Math.max(Date.parse(onset), Date.parse(end) - MAX_WINDOW_HOURS * HOUR)).toISOString();
  const incidentWindow: WindowT = { startAt: start, endAt: end };
  const length = Math.max(24 * HOUR, Math.min(MAX_BASELINE_HOURS * HOUR, Date.parse(end) - Date.parse(start)));
  const baseStart = new Date(Math.max(Date.parse(horizon.historyStart), Date.parse(start) - length)).toISOString();
  const baselineWindow = Date.parse(start) - Date.parse(baseStart) >= HOUR ? { startAt: baseStart, endAt: start } : undefined;
  const severity = (incident?.severity.level ?? anomalies.map((a) => a.severity).sort((a, b) => SEVERITY_ORDER.indexOf(b) - SEVERITY_ORDER.indexOf(a))[0] ?? "low") as InvestigationContext["severity"];
  return {
    db, businessId, simulationRunId, investigation, incident, anomalies, findings,
    themes: new Set(findings.map((f) => f.theme)), signalIds: new Set(findings.map((f) => f.signalId)), metrics: new Set(anomalies.map((a) => a.metric)),
    affected: incident?.affected ?? { campaigns: [], products: [], channels: [], categories: [] },
    severity, polarity: incident?.polarity ?? (findings.some((f) => f.polarity === "negative") || findings.length === 0 ? "negative" : "positive"),
    cutoff, historyStart: horizon.historyStart, incidentWindow, baselineWindow, catalogue,
  };
}
