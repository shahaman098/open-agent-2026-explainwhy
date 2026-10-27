import "server-only";

import { createHash } from "node:crypto";
import type { Db, Document, AnyBulkWriteOperation } from "mongodb";
import { Anomaly, Investigation, type AnomalyT, type InvestigationT, type MetricSnapshotT } from "@normal/contracts";
import { computeSnapshots, snapshotId } from "@/analytics/metrics";
import { COLLECTIONS } from "@/lib/collections";
import { DETECTOR_VERSION, severityRank, type DetectionConfig } from "@/intelligence/config";
import type { IncidentDraft, IncidentPolarity } from "@/intelligence/detection/correlation";
import type { DetectionRun, Episode, FindingDraft } from "@/intelligence/detection/engine";
import { evidenceQuery, snapshotDimension, type EventQuery, type SourceRef } from "@/intelligence/detection/evidence";
import { SIGNALS_BY_ID } from "@/intelligence/detection/rules";
import type { Evaluation, SignalDef, Trigger } from "@/intelligence/detection/signal";
import { methodFor } from "@/intelligence/detection/signal";
import type { SeverityAssessment } from "@/intelligence/detection/severity";
import { HOUR_MS } from "@/intelligence/signals/rows";
import { parseSegmentKey, type CatalogueView, type Segment, type SeverityLevel, type Theme } from "@/intelligence/types";

const h12 = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

export interface StoredEvaluation {
  windowHours: number;
  window: { startAt: string; endAt: string };
  actual: number | null;
  expected: number | null;
  delta: number | null;
  changePercent: number | null;
  z: number | null;
  currentNumerator: number | null;
  currentDenominator: number | null;
  strength: number;
  checks: Evaluation["checks"];
  thresholds: Trigger & { persistenceHours: number };
  baseline: null | { method: string; cutoff: string; estimator: string; n: number; expected: number | null; spread: number | null;
    samples: Array<{ startAt: string; endAt: string; numerator: number; denominator: number; value: number | null }> };
  details: Record<string, unknown> | null;
}

/** Supplementary detection-evidence record (one per finding episode). Never part of a strict canonical schema. */
export interface FindingDoc {
  schemaVersion: 1;
  businessId: string;
  simulationRunId: string;
  findingId: string;
  anomalyId: string | null;
  incidentId: string | null;
  detectorVersion: string;
  signalId: string;
  label: string;
  family: string;
  theme: Theme;
  canonicalMetric: string | null;
  segment: Segment;
  segmentKey: string;
  segmentLabel: string;
  direction: "increase" | "decrease";
  polarity: "negative" | "positive";
  status: "active" | "resolved";
  onsetAt: string;
  confirmedAt: string;
  lastTriggeredAt: string;
  resolvedAt: string | null;
  severity: SeverityAssessment;
  reason: string;
  evaluation: StoredEvaluation;
  peak: StoredEvaluation;
  windows: Array<{ windowHours: number; onsetAt: string; confirmedAt: string; resolvedAt: string | null; score: number; episodeKey: string }>;
  evidence: { snapshotIds: string[]; baselineSnapshotIds: string[]; baselineDerivation: string; sourceRecords: SourceRef[]; eventQuery: EventQuery };
  firstDetectedAsOf: string;
  lastEvaluatedAsOf: string;
}

export type IncidentStatus = "monitoring" | "investigating" | "resolved" | "merged";

/** Supplementary incident record grouping findings; links to the canonical Investigation when one is opened. */
export interface IncidentDoc {
  schemaVersion: 1;
  businessId: string;
  simulationRunId: string;
  incidentId: string;
  status: IncidentStatus;
  title: string;
  summary: string;
  primaryTheme: Theme;
  themes: Theme[];
  polarity: IncidentPolarity;
  scope: IncidentDraft["scope"];
  affected: IncidentDraft["affected"];
  severity: IncidentDraft["severity"];
  findingIds: string[];
  anomalyIds: string[];
  investigationId: string | null;
  investigationPolicy: { qualifies: boolean; reason: string };
  links: Array<{ from: string; to: string; reason: string }>;
  onsetAt: string;
  lastTriggeredAt: string;
  resolvedAt: string | null;
  reopenCount: number;
  mergedInto: string | null;
  firstSeenAsOf: string;
  lastEvaluatedAsOf: string;
  history: Array<{ asOf: string; status: IncidentStatus; severity: SeverityLevel; score: number; findings: number }>;
}

export interface PersistSummary {
  findings: { active: number; created: number; updated: number; resolved: number };
  anomalies: { canonical: number; created: number; updated: number; resolved: number };
  incidents: { active: number; created: number; updated: number; resolved: number; reopened: number };
  investigations: { created: string[]; linked: string[] };
  snapshots: { computed: number; reused: number };
}

interface Ctx {
  db: Db;
  businessId: string;
  simulationRunId: string;
  asOf: string;
  config: DetectionConfig;
  catalogue: CatalogueView;
  lockToken?: string;
}

function segmentLabel(key: string, catalogue: CatalogueView): string {
  const s = parseSegmentKey(key);
  if (s.kind === "global") return "whole business";
  if (s.kind === "product") return `product ${catalogue.get(s.id!)?.name ?? s.id}`;
  return `${s.kind} ${s.id}`;
}

function store(def: SignalDef, ep: Episode, ev: Evaluation): StoredEvaluation {
  const trigger = def.triggers[ep.triggerIndex];
  const p = def.persistenceHours;
  const persistenceHours = typeof p === "number" ? p : (p?.[ep.windowHours] ?? (def.kind === "custom" ? 2 : ep.windowHours >= 72 ? 6 : ep.windowHours >= 24 ? 2 : 3));
  return {
    windowHours: ep.windowHours, window: ev.window, actual: ev.actual, expected: ev.expected, delta: ev.delta, changePercent: ev.changePercent, z: ev.z,
    currentNumerator: ev.currentNumerator, currentDenominator: ev.currentDenominator, strength: ev.strength, checks: ev.checks,
    thresholds: { ...trigger, persistenceHours },
    baseline: ev.baseline ? { method: ev.baseline.method, cutoff: ev.baseline.cutoff, estimator: ev.baseline.estimator, n: ev.baseline.n,
      expected: ev.baseline.expected, spread: ev.baseline.spread, samples: ev.baseline.samples } : null,
    details: ev.details ?? null,
  };
}

function fmt(v: number | null, unit: string): string {
  if (v === null) return "n/a";
  if (unit === "rate") return `${(v * 100).toFixed(2)}%`;
  if (unit === "minor") return `£${(v / 100).toFixed(2)}`;
  if (unit === "hours") return `${v.toFixed(1)}h`;
  if (unit === "stars") return `${v.toFixed(2)}★`;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

export function describeFinding(def: SignalDef, f: FindingDraft, ev: StoredEvaluation, catalogue: CatalogueView): string {
  const where = segmentLabel(f.segment, catalogue);
  const window = ev.windowHours > 0 ? `${ev.windowHours}h window ending ${ev.window.endAt}` : `at ${ev.window.endAt}`;
  const change = ev.changePercent !== null ? ` (${ev.changePercent > 0 ? "+" : ""}${ev.changePercent.toFixed(1)}%)` : "";
  const z = ev.z !== null ? `, z ${ev.z.toFixed(2)}` : "";
  const base = ev.baseline ? `; baseline ${ev.baseline.estimator}, n=${ev.baseline.n}, cutoff ${ev.baseline.cutoff}` : "";
  const t = ev.thresholds;
  return `${def.label} for ${where}, ${window}: observed ${fmt(ev.actual, def.unit)} vs expected ${fmt(ev.expected, def.unit)}${change}${z}${base}. `
    + `Rule: ${t.direction} ≥${Math.round(t.minRelChange * 100)}% with |z| ≥${t.minZ} for ≥${t.persistenceHours} consecutive hours. `
    + "This is an observation, not a diagnosis.";
}

async function ensureSnapshots(ctx: Ctx, windows: Array<{ startAt: string; endAt: string; dimension: Record<string, string | undefined> }>, counter: PersistSummary["snapshots"]): Promise<string[]> {
  const ids = windows.map((w) => snapshotId({ businessId: ctx.businessId, simulationRunId: ctx.simulationRunId, dimension: w.dimension }, w.startAt, w.endAt));
  const col = ctx.db.collection<MetricSnapshotT & { simulationRunId: string }>(COLLECTIONS.metricSnapshots);
  const found = await col.find({ businessId: ctx.businessId, snapshotId: { $in: ids } }, { projection: { snapshotId: 1, rates: 1 } }).toArray();
  // Existing v1 snapshots may predate checkout rates. Refresh global windows before a new canonical
  // checkout anomaly cites them; their stable IDs and source event windows remain unchanged.
  const existing = new Set(found.filter((d) => d.rates?.checkoutFailureRate !== undefined && d.rates?.couponFailureRate !== undefined).map((d) => d.snapshotId));
  for (let i = 0; i < windows.length; i++) if (Object.values(windows[i].dimension).some(Boolean) && found.some((d) => d.snapshotId === ids[i])) existing.add(ids[i]);
  const missing = windows.filter((_, i) => !existing.has(ids[i]));
  counter.reused += windows.length - missing.length;
  for (let i = 0; i < missing.length; i += 4) {
    const batch = missing.slice(i, i + 4);
    const snaps = await Promise.all(batch.map(async (w) => (await computeSnapshots({
      businessId: ctx.businessId, simulationRunId: ctx.simulationRunId, startAt: w.startAt, endAt: w.endAt, bucket: "window",
      dimension: Object.fromEntries(Object.entries(w.dimension).filter(([, v]) => v)), virtualTime: ctx.asOf,
    }, ctx.db))[0]));
    if (snaps.length) {
      await col.bulkWrite(snaps.map((s) => ({ replaceOne: { filter: { businessId: s.businessId, snapshotId: s.snapshotId }, replacement: { ...s, simulationRunId: ctx.simulationRunId }, upsert: true } })), { ordered: false });
      counter.computed += snaps.length;
    }
  }
  return ids;
}

const overlaps = (a0: string, a1: string | null, b0: string, b1: string | null, asOf: string) =>
  Date.parse(a0) <= Date.parse(b1 ?? asOf) && Date.parse(b0) <= Date.parse(a1 ?? asOf);

/**
 * Persists a detection run: findings + canonical anomalies (with MetricSnapshot evidence), observations, incidents and
 * canonical investigations. Idempotent for a given (run, asOf): IDs are stable and earlier records are reconciled by
 * overlap, so repeating a scan updates records in place instead of duplicating them.
 */
export async function persistDetection(ctx: Ctx, run: DetectionRun, drafts: IncidentDraft[]): Promise<PersistSummary> {
  const { db, businessId, simulationRunId, asOf, config, catalogue } = ctx;
  const summary: PersistSummary = {
    findings: { active: 0, created: 0, updated: 0, resolved: 0 }, anomalies: { canonical: 0, created: 0, updated: 0, resolved: 0 },
    incidents: { active: 0, created: 0, updated: 0, resolved: 0, reopened: 0 }, investigations: { created: [], linked: [] }, snapshots: { computed: 0, reused: 0 },
  };
  const scope = { businessId, simulationRunId };
  const findingsCol = db.collection<FindingDoc>(COLLECTIONS.detectionFindings);
  const anomaliesCol = db.collection<AnomalyT & { simulationRunId: string }>(COLLECTIONS.anomalies);
  const incidentsCol = db.collection<IncidentDoc>(COLLECTIONS.incidents);
  const investigationsCol = db.collection<InvestigationT & { simulationRunId: string }>(COLLECTIONS.investigations);
  const investigationOps: AnyBulkWriteOperation<InvestigationT & { simulationRunId: string }>[] = [];

  // ---------------------------------------------------------------- findings
  const existing = await findingsCol.find({ ...scope, $or: [{ status: "active" }, { lastTriggeredAt: { $gte: run.replayFrom } }] }, { projection: { _id: 0 } }).toArray();
  const used = new Set<string>();
  const idByKey = new Map<string, string>();
  const docs: FindingDoc[] = [];
  const cooldownMs = config.cooldownHours * HOUR_MS;
  for (const f of [...run.findings].sort((a, b) => a.onsetAt.localeCompare(b.onsetAt) || a.key.localeCompare(b.key))) {
    const def = SIGNALS_BY_ID.get(f.signalId)!;
    const segKey = f.segment;
    const match = existing.find((e) => !used.has(e.findingId) && e.signalId === f.signalId && e.segmentKey === segKey && e.direction === f.direction
      && (overlaps(e.onsetAt, e.resolvedAt, f.onsetAt, f.resolvedAt, asOf)
        || (e.resolvedAt !== null && Date.parse(f.onsetAt) - Date.parse(e.resolvedAt) <= cooldownMs && Date.parse(f.onsetAt) >= Date.parse(e.resolvedAt))));
    if (match) used.add(match.findingId);
    const suffix = match ? match.findingId.replace(/^fnd_/, "") : `${simulationRunId}_${h12(f.key)}`;
    const findingId = `fnd_${suffix}`;
    idByKey.set(f.key, findingId);
    const ev = f.active ? f.primary.latest : f.primary.peak;
    const evaluation = store(def, f.primary, ev.ok ? ev : f.primary.peak);
    const anomalyId = def.canonicalMetric && evaluation.changePercent !== null && evaluation.actual !== null && evaluation.expected !== null ? (match?.anomalyId ?? `anm_${suffix}`) : null;

    let snapshotIds: string[] = []; let baselineSnapshotIds: string[] = []; let baselineDerivation = "baseline snapshots cover the comparison windows directly";
    if (anomalyId) {
      const baseSegment = def.baselineSegment ? def.baselineSegment(segKey) : segKey;
      snapshotIds = await ensureSnapshots(ctx, [{ ...evaluation.window, dimension: snapshotDimension(segKey) }], summary.snapshots);
      // Point-in-time gauge baselines have no window snapshot; every windowed baseline sample gets one.
      const windowed = methodFor(def, f.primary.windowHours) !== "same_hour_point";
      const samples = evaluation.baseline?.samples ?? [];
      if (!windowed) baselineSnapshotIds = [];
      else if (baseSegment.startsWith("rest:")) {
        // Rest-of-catalogue baseline = whole business minus this segment: cite both so it can be recomputed exactly.
        const own = baseSegment.slice(5);
        baselineSnapshotIds = [
          ...(await ensureSnapshots(ctx, samples.map((x) => ({ startAt: x.startAt, endAt: x.endAt, dimension: {} })), summary.snapshots)),
          ...(await ensureSnapshots(ctx, samples.map((x) => ({ startAt: x.startAt, endAt: x.endAt, dimension: snapshotDimension(own) })), summary.snapshots)),
        ];
        baselineDerivation = `baseline = whole-business snapshots minus ${own} snapshots over the same windows`;
      } else {
        baselineSnapshotIds = await ensureSnapshots(ctx, samples.map((x) => ({ startAt: x.startAt, endAt: x.endAt, dimension: snapshotDimension(baseSegment) })), summary.snapshots);
      }
    }
    const query = evidenceQuery(def, businessId, simulationRunId, segKey, evaluation.window);
    const samples = await db.collection(COLLECTIONS.businessEvents).find(query.filter, { projection: { _id: 0, eventId: 1 } }).sort({ occurredAt: -1 }).limit(10).toArray();
    const doc: FindingDoc = {
      schemaVersion: 1, businessId, simulationRunId, findingId, anomalyId, incidentId: match?.incidentId ?? null, detectorVersion: DETECTOR_VERSION,
      signalId: f.signalId, label: f.label, family: f.family, theme: f.theme, canonicalMetric: anomalyId ? f.canonicalMetric : null,
      segment: parseSegmentKey(segKey), segmentKey: segKey, segmentLabel: segmentLabel(segKey, catalogue), direction: f.direction, polarity: f.polarity,
      status: f.active ? "active" : "resolved", onsetAt: f.onsetAt, confirmedAt: f.confirmedAt, lastTriggeredAt: f.lastTriggeredAt, resolvedAt: f.resolvedAt,
      severity: f.severity, reason: describeFinding(def, f, evaluation, catalogue), evaluation, peak: store(def, f.primary, f.primary.peak),
      windows: f.episodes.map((e) => ({ windowHours: e.windowHours, onsetAt: e.onsetAt, confirmedAt: e.confirmedAt, resolvedAt: e.resolvedAt, score: e.severity.score, episodeKey: e.key })),
      evidence: {
        snapshotIds, baselineSnapshotIds, baselineDerivation,
        sourceRecords: [
          ...[...snapshotIds, ...baselineSnapshotIds].map((id): SourceRef => ({ collection: COLLECTIONS.metricSnapshots, recordId: id })),
          ...samples.map((e): SourceRef => ({ collection: COLLECTIONS.businessEvents, recordId: e.eventId as string })),
        ],
        eventQuery: query,
      },
      firstDetectedAsOf: match?.firstDetectedAsOf ?? asOf, lastEvaluatedAsOf: asOf,
    };
    docs.push(doc);
    if (match) summary.findings.updated++; else summary.findings.created++;
    if (doc.status === "active") summary.findings.active++;
    if (doc.status === "resolved" && match?.status === "active") summary.findings.resolved++;
  }
  // Earlier active findings that this replay no longer reports are closed (never silently dropped).
  const stale = existing.filter((e) => !used.has(e.findingId) && e.status === "active");
  for (const e of stale) {
    docs.push({ ...e, status: "resolved", resolvedAt: asOf, lastEvaluatedAsOf: asOf, reason: `${e.reason} Closed at ${asOf}: no longer observed by the detector.` });
    summary.findings.resolved++;
  }

  // -------------------------------------------------------------- incidents
  const docByKey = new Map(docs.map((d) => [d.findingId, d]));
  const existingIncidents = await incidentsCol.find({ ...scope, $or: [{ status: { $in: ["monitoring", "investigating"] } },
    { resolvedAt: { $gte: new Date(Date.parse(asOf) - (config.cooldownHours + config.resolvedRetentionHours) * HOUR_MS).toISOString() } }] }, { projection: { _id: 0 } }).toArray();
  const usedIncidents = new Set<string>();
  const incidentDocs: IncidentDoc[] = [];
  const retentionMs = config.resolvedRetentionHours * HOUR_MS;
  for (const draft of [...drafts].sort((a, b) => a.onsetAt.localeCompare(b.onsetAt) || a.seedKey.localeCompare(b.seedKey))) {
    const memberIds = draft.findingKeys.map((k) => idByKey.get(k)!).filter(Boolean);
    const matches = existingIncidents.filter((i) => !usedIncidents.has(i.incidentId) && i.findingIds.some((id) => memberIds.includes(id)))
      .sort((a, b) => a.onsetAt.localeCompare(b.onsetAt) || a.incidentId.localeCompare(b.incidentId));
    let target: IncidentDoc | undefined = matches[0];
    let reopened = false;
    if (!target) {
      target = existingIncidents.find((i) => !usedIncidents.has(i.incidentId) && i.status === "resolved" && i.resolvedAt !== null
        && i.primaryTheme === draft.primaryTheme && i.polarity === draft.polarity && i.scope.kind === draft.scope.kind
        && Date.parse(draft.onsetAt) - Date.parse(i.resolvedAt) <= cooldownMs && Date.parse(draft.onsetAt) >= Date.parse(i.resolvedAt));
      reopened = Boolean(target);
    }
    // A brand-new incident that is already over (and too old to matter) is recorded but never opens an investigation.
    if (!target && !draft.active && Date.parse(asOf) - Date.parse(draft.resolvedAt ?? asOf) > retentionMs) continue;
    for (const m of matches.slice(1)) { usedIncidents.add(m.incidentId); incidentDocs.push({ ...m, status: "merged", mergedInto: target!.incidentId, lastEvaluatedAsOf: asOf }); }
    if (target) usedIncidents.add(target.incidentId);
    const incidentId = target?.incidentId ?? `inc_${simulationRunId}_${h12(draft.seedKey)}`;
    const findingIds = [...new Set([...(target?.findingIds ?? []), ...memberIds])];
    const memberDocs = memberIds.map((id) => docByKey.get(id)!).filter(Boolean);
    const anomalyIds = [...new Set([...(target?.anomalyIds ?? []), ...memberDocs.map((d) => d.anomalyId).filter((x): x is string => Boolean(x))])];
    const canonicalActive = memberDocs.some((d) => d.anomalyId && d.status === "active");
    const sevOk = severityRank(draft.severity.level) >= severityRank(config.investigationMinSeverity);
    const nonCanonical = [...new Set(memberDocs.filter((d) => !d.anomalyId).map((d) => d.signalId))];
    const policy = !draft.active ? { qualifies: false, reason: "incident already resolved" }
      : !sevOk ? { qualifies: false, reason: `severity ${draft.severity.level} below ${config.investigationMinSeverity}: monitoring only` }
      : !canonicalActive ? { qualifies: false, reason: `no canonical Anomaly metric covers ${nonCanonical.join(", ")}` }
      : { qualifies: true, reason: `severity ${draft.severity.level} with ${anomalyIds.length} canonical anomal${anomalyIds.length === 1 ? "y" : "ies"}` };

    let investigationId = target?.investigationId ?? null;
    if (!investigationId && policy.qualifies) {
      investigationId = `inv_${incidentId.replace(/^inc_/, "")}`;
      const investigation = Investigation.parse({
        schemaVersion: 1, businessId, investigationId, anomalyIds, status: "open", title: draft.title, evidenceIds: [], startedAt: asOf, updatedAt: asOf,
      });
      investigationOps.push({ updateOne: { filter: { businessId, investigationId }, update: { $setOnInsert: { ...investigation, simulationRunId } }, upsert: true } });
      summary.investigations.created.push(investigationId);
    } else if (investigationId) {
      const inv = await investigationsCol.findOne({ businessId, investigationId }, { projection: { _id: 0 } });
      if (inv) {
        const merged = [...new Set([...inv.anomalyIds, ...anomalyIds])];
        if (merged.length !== inv.anomalyIds.length) {
          investigationOps.push({ updateOne: { filter: { businessId, investigationId }, update: { $set: { anomalyIds: merged, updatedAt: asOf } } } });
          summary.investigations.linked.push(investigationId);
        }
      }
    }
    const status: IncidentStatus = !draft.active ? "resolved" : investigationId ? "investigating" : "monitoring";
    const history = [...(target?.history ?? [])];
    const entry = { asOf, status, severity: draft.severity.level, score: draft.severity.score, findings: findingIds.length };
    if (history.at(-1)?.asOf === asOf) history[history.length - 1] = entry; else history.push(entry);
    incidentDocs.push({
      schemaVersion: 1, businessId, simulationRunId, incidentId, status, title: draft.title, summary: draft.summary, primaryTheme: draft.primaryTheme,
      themes: draft.themes, polarity: draft.polarity, scope: draft.scope, affected: draft.affected, severity: draft.severity, findingIds, anomalyIds,
      investigationId, investigationPolicy: policy, links: draft.links.map((l) => ({ from: idByKey.get(l.from) ?? l.from, to: idByKey.get(l.to) ?? l.to, reason: l.reason })),
      onsetAt: target && target.onsetAt < draft.onsetAt ? target.onsetAt : draft.onsetAt, lastTriggeredAt: draft.lastTriggeredAt, resolvedAt: draft.resolvedAt,
      reopenCount: (target?.reopenCount ?? 0) + (reopened ? 1 : 0), mergedInto: null, firstSeenAsOf: target?.firstSeenAsOf ?? asOf, lastEvaluatedAsOf: asOf,
      history: history.slice(-200),
    });
    for (const d of memberDocs) d.incidentId = incidentId;
    if (!target) summary.incidents.created++; else summary.incidents.updated++;
    if (reopened) summary.incidents.reopened++;
    if (status !== "resolved") summary.incidents.active++;
    if (status === "resolved" && target && target.status !== "resolved") summary.incidents.resolved++;
  }
  for (const i of existingIncidents.filter((x) => !usedIncidents.has(x.incidentId) && x.status !== "resolved" && x.status !== "merged")) {
    incidentDocs.push({ ...i, status: "resolved", resolvedAt: asOf, lastEvaluatedAsOf: asOf,
      history: [...i.history, { asOf, status: "resolved" as const, severity: i.severity.level, score: i.severity.score, findings: i.findingIds.length }].slice(-200) });
    summary.incidents.resolved++;
  }

  // --------------------------------------------------------------- write out
  const incidentById = new Map(incidentDocs.map((i) => [i.incidentId, i]));
  const anomalyDocs = docs.filter((d) => d.anomalyId);
  const prior = new Map((await anomaliesCol.find({ businessId, anomalyId: { $in: anomalyDocs.map((d) => d.anomalyId!) } }, { projection: { _id: 0 } }).toArray()).map((a) => [a.anomalyId, a]));
  const anomalyOps: Document[] = [];
  for (const d of anomalyDocs) {
    const before = prior.get(d.anomalyId!);
    const incident = d.incidentId ? incidentById.get(d.incidentId) : undefined;
    const status = before?.status === "dismissed" ? "dismissed" : d.status === "resolved" ? "resolved" : incident?.investigationId ? "investigating" : "new";
    const samples = d.evaluation.baseline?.samples ?? [];
    const anomaly = Anomaly.parse({
      schemaVersion: 1, businessId, anomalyId: d.anomalyId, metric: d.canonicalMetric, direction: d.direction, severity: d.severity.level,
      currentWindow: d.evaluation.window,
      baselineWindow: samples.length ? { startAt: samples.map((s) => s.startAt).sort()[0], endAt: samples.map((s) => s.endAt).sort().at(-1)! } : d.evaluation.window,
      actualValue: d.evaluation.actual, baselineValue: d.evaluation.expected, changePercent: d.evaluation.changePercent,
      sourceSnapshotIds: [...d.evidence.snapshotIds, ...d.evidence.baselineSnapshotIds], detectorVersion: DETECTOR_VERSION, status, detectedAt: d.confirmedAt,
    });
    anomalyOps.push({ replaceOne: { filter: { businessId, anomalyId: anomaly.anomalyId }, replacement: { ...anomaly, simulationRunId }, upsert: true } });
    summary.anomalies.canonical++;
    if (!before) summary.anomalies.created++; else summary.anomalies.updated++;
    if (status === "resolved" && before && before.status !== "resolved") summary.anomalies.resolved++;
  }
  const obs = docs.filter((d) => d.status === "active" || d.resolvedAt === asOf || d.lastTriggeredAt === asOf);
  // Evidence snapshots are deterministic and can safely survive a failed attempt.
  // Publish the linked incident graph atomically, fencing a worker whose run lease expired.
  const session = db.client.startSession();
  try {
    await session.withTransaction(async () => {
      if (ctx.lockToken) {
        const owned = await db.collection(COLLECTIONS.monitorState).updateOne(
          { ...scope, "lock.token": ctx.lockToken, "lock.expiresAt": { $gt: new Date().toISOString() } },
          { $set: { persistenceFence: asOf } }, { session },
        );
        if (!owned.matchedCount) throw new Error("Monitoring lease lost before persistence");
      }
      if (investigationOps.length) await investigationsCol.bulkWrite(investigationOps, { session });
      if (docs.length) await findingsCol.bulkWrite(docs.map((d) => ({ replaceOne: { filter: { ...scope, findingId: d.findingId }, replacement: d, upsert: true } })), { session });
      if (incidentDocs.length) await incidentsCol.bulkWrite(incidentDocs.map((d) => ({ replaceOne: { filter: { ...scope, incidentId: d.incidentId }, replacement: d, upsert: true } })), { session });
      if (anomalyOps.length) await anomaliesCol.bulkWrite(anomalyOps as never, { session });
  if (obs.length) {
    await db.collection(COLLECTIONS.detectionObservations).bulkWrite(obs.map((d) => ({
      replaceOne: { filter: { businessId, observationId: `${d.findingId}@${asOf}` }, upsert: true, replacement: {
        businessId, simulationRunId, observationId: `${d.findingId}@${asOf}`, findingId: d.findingId, anomalyId: d.anomalyId, incidentId: d.incidentId, asOf,
        status: d.status, severity: d.severity, evaluation: d.evaluation, detectorVersion: DETECTOR_VERSION,
      } },
    })), { session });
  }
    }, { writeConcern: { w: "majority" } });
  } finally { await session.endSession(); }
  return summary;
}
