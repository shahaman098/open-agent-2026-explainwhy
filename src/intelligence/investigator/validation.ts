import "server-only";
import type { Db } from "mongodb";
import { DiagnosisModelOutput, Evidence, type DiagnosisModelOutputT, type EvidenceT, type MetricSnapshotT } from "@normal/contracts";
import { COLLECTIONS } from "@/lib/collections";
import { resolveSources } from "../evidence/verification";
import { type HypothesisSetT, type ImpactT, type ScopeT, BusinessImpactAssessment } from "./schemas";

export interface EvidencePacket { evidence: EvidenceT[]; limitations: string[] }
export async function loadVerifiedEvidence(db: Db, scope: ScopeT, ids: string[], cutoff: string): Promise<EvidencePacket> {
  const docs = await db.collection(COLLECTIONS.evidence).find({ ...scope, evidenceId: { $in: [...new Set(ids)] } }, { projection: { _id: 0 } }).toArray();
  const evidence: EvidenceT[] = [], limitations: string[] = [];
  for (const doc of docs) {
    const { simulationRunId: _run, ...raw } = doc; void _run;
    const e = Evidence.parse(raw);
    if (e.window && (e.window.endAt > cutoff || e.window.startAt >= e.window.endAt)) { limitations.push(`${e.evidenceId}: temporal boundary failed`); continue; }
    let boundaryValid = true;
    for (const collection of [COLLECTIONS.investigations, COLLECTIONS.anomalies]) {
      const refs = [...new Set(e.sourceRecords.filter((r) => r.collection === collection).map((r) => r.recordId))];
      if (refs.length) {
        const field = collection === COLLECTIONS.investigations ? "investigationId" : "anomalyId";
        const count = await db.collection(collection).countDocuments({ businessId: scope.businessId, simulationRunId: scope.simulationRunId, [field]: { $in: refs } });
        if (count !== refs.length) boundaryValid = false;
      }
    }
    if (!boundaryValid) { limitations.push(`${e.evidenceId}: referenced document outside run`); continue; }
    const resolved = await resolveSources(db, scope, e.sourceRecords);
    if (resolved.unresolved.length || !resolved.resolved) { limitations.push(`${e.evidenceId}: source resolution failed`); continue; }
    // Published references are dated independently of simulation time and remain context-only.
    if (e.sourceRecords.some((r) => r.collection.startsWith("reference_"))) { limitations.push(`${e.evidenceId}: public reference excluded from causal evidence`); continue; }
    const revenue = e.measurements.find((m) => m.metric === "net_revenue_minor_per_hour");
    if (revenue && e.window) {
      const snapshots = await db.collection<MetricSnapshotT & { simulationRunId: string }>(COLLECTIONS.metricSnapshots).find({ businessId: scope.businessId, simulationRunId: scope.simulationRunId, snapshotId: { $in: e.sourceRecords.filter((r) => r.collection === COLLECTIONS.metricSnapshots).map((r) => r.recordId) }, dimension: {}, completeness: "complete" }).toArray();
      const current = snapshots.filter((s) => s.window.startAt >= e.window!.startAt && s.window.endAt <= e.window!.endAt && Date.parse(s.window.endAt) - Date.parse(s.window.startAt) === 3600000);
      const baseline = snapshots.filter((s) => s.window.endAt <= e.window!.startAt && Date.parse(s.window.endAt) - Date.parse(s.window.startAt) === 3600000);
      const mean = (rows: MetricSnapshotT[]) => Math.round(rows.reduce((n, s) => n + s.counters.revenueMinor, 0) / rows.length * 10000) / 10000;
      if (!current.length || Math.abs(mean(current) - revenue.value) > 0.0001 || (revenue.baseline !== undefined && (!baseline.length || Math.abs(mean(baseline) - revenue.baseline) > 0.0001))) { limitations.push(`${e.evidenceId}: aggregate calculation does not match source snapshots`); continue; }
    }
    evidence.push(e);
  }
  for (const id of ids) if (!docs.some((d) => d.evidenceId === id)) limitations.push(`${id}: missing or outside investigation scope`);
  return { evidence, limitations };
}

export function validateReferences(refs: string[], evidence: EvidenceT[]): void {
  if (new Set(refs).size !== refs.length) throw new Error("duplicate_evidence_reference");
  const allowed = new Set(evidence.map((e) => e.evidenceId));
  if (refs.some((id) => !allowed.has(id))) throw new Error("unknown_or_cross_scope_evidence");
}
// Numerics are shown ONLY in deterministic measurements/impact, never in model-authored assertions.
export function rejectNumericalProse(text: string): void {
  if (/\d|[%£$€]/u.test(text)) throw new Error("unsupported_numerical_prose");
  if (/\b(proven|definitively|certainly|definite root cause|conclusively)\b/i.test(text)) throw new Error("overstated_causality");
}
export function validateDiagnosis(input: unknown, evidence: EvidenceT[], history: HypothesisSetT[], limited = false): DiagnosisModelOutputT {
  const d = DiagnosisModelOutput.parse(input);
  // At most seven investigated alternatives plus the explicit unknown fallback.
  if (d.hypotheses.length > 8 || d.summary.length > 2000 || d.missingEvidence.length > 20) throw new Error("unbounded_diagnosis");
  if (!d.requiresReview) throw new Error("review_required");
  if (limited && d.primaryCause !== "unknown") throw new Error("budget_limited_cause");
  if (d.primaryCause !== "unknown" && !d.hypotheses.some((h) => h.cause === d.primaryCause && h.strength !== "weak" && h.evidenceIds.length > 0)) throw new Error("unsupported_primary_cause");
  if (!evidence.length && d.primaryCause !== "unknown") throw new Error("no_evidence");
  const last = history.at(-1)?.hypotheses || [];
  for (const h of d.hypotheses) {
    validateReferences(h.evidenceIds, evidence); validateReferences(h.counterEvidenceIds, evidence);
    if (h.cause !== "unknown" && !h.evidenceIds.length && h.strength !== "weak") throw new Error("unsupported_hypothesis_strength");
    if (h.evidenceIds.some((id) => h.counterEvidenceIds.includes(id))) throw new Error("ambiguous_evidence_role");
    rejectNumericalProse(h.explanation);
    if (h.explanation.length > 2000) throw new Error("unbounded_explanation");
    const known = last.find((p) => p.cause === h.cause);
    if (known?.counterEvidenceIds.some((id) => !h.counterEvidenceIds.includes(id))) throw new Error("missing_contradiction_disclosure");
  }
  for (const h of last.filter((h) => h.counterEvidenceIds.length > 0)) if (!d.hypotheses.some((p) => p.cause === h.cause)) throw new Error("omitted_contradicted_alternative");
  rejectNumericalProse(d.summary);
  for (const m of d.missingEvidence) rejectNumericalProse(m);
  return d;
}
/** Older persisted assessments can contain mixed roles. Preserve contradictions and demote the overlap. */
export function fallbackHypotheses(history: HypothesisSetT[], evidence: EvidenceT[]): DiagnosisModelOutputT["hypotheses"] {
  const allowed = new Set(evidence.map((e) => e.evidenceId));
  return (history.at(-1)?.hypotheses || []).filter((h) => h.cause !== "unknown").map((h) => ({
    cause: h.cause, strength: "weak", explanation: h.explanation,
    evidenceIds: [...new Set(h.evidenceIds)].filter((id) => allowed.has(id) && !h.counterEvidenceIds.includes(id)),
    counterEvidenceIds: [...new Set(h.counterEvidenceIds)].filter((id) => allowed.has(id)),
  }));
}
export function deterministicImpact(evidence: EvidenceT[]): ImpactT {
  // Only the business-wide per-hour revenue measurement; never sum/average overlapping campaign changes.
  const rows = evidence.flatMap((e) => e.measurements.filter((m) => m.metric === "net_revenue_minor_per_hour" && Number.isFinite(m.value) && m.baseline !== undefined && Number.isFinite(m.baseline)).map((m) => ({ e, m })));
  const unique = new Map(rows.map((r) => [JSON.stringify([r.e.window, r.m.value, r.m.baseline]), r]));
  if (unique.size !== 1) return BusinessImpactAssessment.parse({ schemaVersion: 1, status: "unknown", evidenceId: null, metric: null, value: null, baseline: null, delta: null, unit: null, interpretation: "A unique comparable business-wide revenue measurement is unavailable.", limitations: ["No financial loss estimate is justified."] });
  const { e, m } = [...unique.values()][0];
  return BusinessImpactAssessment.parse({ schemaVersion: 1, status: "measured", evidenceId: e.evidenceId, metric: m.metric, value: m.value, baseline: m.baseline, delta: Math.round((m.value - m.baseline!) * 10000) / 10000, unit: m.unit,
    interpretation: "Observed hourly revenue difference relative to baseline; this is not a causal loss estimate.", limitations: ["Simulated operational data.", "Baseline composition and time-window differences may confound the comparison.", "Campaign-level percentages are not added or averaged."] });
}
