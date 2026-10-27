import { z } from "zod";
import type { AnomalyT, InvestigationT } from "@normal/contracts";
import { COLLECTIONS } from "@/lib/collections";
import type { IncidentDoc } from "@/intelligence/detection/persistence";
import { ToolInputBase, type EvidenceCategory, type EvidenceDraft, type EvidenceTool } from "../types";
import { cap } from "./_shared";

export const HistoricalInput = ToolInputBase.extend({
  /** Same-run history is the default scope; other runs of the same business are opt-in and labelled as such. */
  includeOtherRuns: z.boolean().default(false),
}).strict();
export type HistoricalInputT = z.infer<typeof HistoricalInput>;

const THEME_CATEGORY: Record<string, EvidenceCategory> = { sales: "sales", traffic: "sales", advertising: "advertising", conversion: "technical", fulfilment: "fulfillment", inventory: "inventory", reputation: "reviews", demand: "social" };
const jaccard = (a: Set<string>, b: Set<string>) => { const inter = [...a].filter((x) => b.has(x)).length; const uni = new Set([...a, ...b]).size; return uni === 0 ? 0 : inter / uni; };

export const historicalIncidents: EvidenceTool<HistoricalInputT> = {
  name: "historical_incidents",
  title: "Historical incident retrieval",
  description: "Earlier Normal investigations and incidents for this business with similar observed metrics and themes, plus any recorded diagnoses or plans. Returns an explicit empty result when none exist; never invents past incidents.",
  category: "technical",
  dataSources: [
    { collection: COLLECTIONS.investigations, description: "canonical investigations", origin: "normal_internal" },
    { collection: COLLECTIONS.incidents, description: "correlated incident records (themes, affected entities, status)", origin: "normal_internal" },
    { collection: COLLECTIONS.anomalies, description: "canonical anomalies (metrics)", origin: "normal_internal" },
    { collection: COLLECTIONS.diagnoses, description: "recorded diagnoses, if any", origin: "normal_internal" },
    { collection: COLLECTIONS.plans, description: "recorded proposed plans, if any", origin: "normal_internal" },
  ],
  input: HistoricalInput,
  async run(ctx, input) {
    const { db } = ctx;
    const scope = { businessId: ctx.businessId, ...(input.includeOtherRuns ? {} : { simulationRunId: ctx.simulationRunId }) };
    const current = await db.collection<InvestigationT & { simulationRunId: string }>(COLLECTIONS.investigations).findOne({ businessId: ctx.businessId, investigationId: ctx.investigationId }, { projection: { _id: 0 } });
    const currentAnomalies = current ? await db.collection<AnomalyT>(COLLECTIONS.anomalies).find({ businessId: ctx.businessId, anomalyId: { $in: current.anomalyIds } }, { projection: { _id: 0, metric: 1 } }).toArray() : [];
    const currentMetrics = new Set(currentAnomalies.map((a) => a.metric));
    const currentIncident = await db.collection<IncidentDoc>(COLLECTIONS.incidents).findOne({ businessId: ctx.businessId, investigationId: ctx.investigationId }, { projection: { _id: 0, themes: 1 } });
    const currentThemes = new Set(currentIncident?.themes ?? []);

    const prior = await db.collection<InvestigationT & { simulationRunId: string }>(COLLECTIONS.investigations)
      .find({ ...scope, investigationId: { $ne: ctx.investigationId }, startedAt: { $lt: ctx.cutoff } }, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(Math.min(input.limit, 50)).toArray();
    if (prior.length === 0) {
      return { evidence: [], resultCount: 0, warnings: [], emptyResult: `No earlier investigations exist for ${input.includeOtherRuns ? "this business" : "this simulation run"} before ${ctx.cutoff}; there are no prior diagnoses or recorded actions to compare against.` };
    }
    const [incidents, anomalies, diagnoses, plans] = await Promise.all([
      db.collection<IncidentDoc>(COLLECTIONS.incidents).find({ businessId: ctx.businessId, investigationId: { $in: prior.map((p) => p.investigationId) } }, { projection: { _id: 0, history: 0, links: 0 } }).toArray(),
      db.collection<AnomalyT>(COLLECTIONS.anomalies).find({ businessId: ctx.businessId, anomalyId: { $in: prior.flatMap((p) => p.anomalyIds) } }, { projection: { _id: 0, anomalyId: 1, metric: 1, direction: 1, severity: 1 } }).toArray(),
      db.collection(COLLECTIONS.diagnoses).find({ businessId: ctx.businessId, investigationId: { $in: prior.map((p) => p.investigationId) } }, { projection: { _id: 0, diagnosisId: 1, investigationId: 1, primaryCause: 1, summary: 1, createdAt: 1 } }).limit(50).toArray(),
      db.collection(COLLECTIONS.plans).find({ businessId: ctx.businessId, investigationId: { $in: prior.map((p) => p.investigationId) } }, { projection: { _id: 0, planId: 1, investigationId: 1, status: 1, objective: 1, createdAt: 1 } }).limit(50).toArray(),
    ]);
    const anomalyBy = new Map(anomalies.map((a) => [a.anomalyId, a]));
    const incidentBy = new Map(incidents.map((i) => [i.investigationId as string, i]));
    const rows = prior.map((p) => {
      const metrics = new Set(p.anomalyIds.map((id) => anomalyBy.get(id)?.metric).filter((m): m is AnomalyT["metric"] => Boolean(m)));
      const inc = incidentBy.get(p.investigationId);
      const themes = new Set(inc?.themes ?? []);
      return { investigationId: p.investigationId, simulationRunId: p.simulationRunId, title: p.title, status: p.status, startedAt: p.startedAt, updatedAt: p.updatedAt,
        metrics: [...metrics], themes: [...themes], incidentId: inc?.incidentId ?? null, incidentStatus: inc?.status ?? null, severity: inc?.severity ?? null, affected: inc?.affected ?? null,
        metricSimilarity: Math.round(jaccard(currentMetrics, metrics) * 100) / 100, themeSimilarity: Math.round(jaccard(currentThemes, themes) * 100) / 100,
        diagnoses: diagnoses.filter((d) => d.investigationId === p.investigationId), plans: plans.filter((pl) => pl.investigationId === p.investigationId) };
    }).sort((a, b) => b.metricSimilarity + b.themeSimilarity - (a.metricSimilarity + a.themeSimilarity));
    const top = rows[0]!;
    const category = THEME_CATEGORY[incidentBy.get(top.investigationId)?.primaryTheme ?? ""] ?? "technical";
    const evidence: EvidenceDraft = {
      key: "historical:investigations", category, title: `${rows.length} earlier investigation(s) for comparison`,
      observation: `${rows.length} earlier investigation(s) found${input.includeOtherRuns ? " across runs of this business" : " in this simulation run"}; the closest shares ${top.metricSimilarity} of its metrics and ${top.themeSimilarity} of its themes ("${top.title}", ${top.status}). ${diagnoses.length} recorded diagnosis(es) and ${plans.length} recorded plan(s) exist for them${diagnoses.length + plans.length === 0 ? " — no prior diagnosis or action outcome is available" : ""}. Similarity is pattern overlap, not evidence that the same cause applies.`,
      measurements: [{ metric: "prior_investigations", value: rows.length, unit: "count" }, { metric: "closest_metric_similarity", value: top.metricSimilarity, unit: "jaccard" }, { metric: "closest_theme_similarity", value: top.themeSimilarity, unit: "jaccard" },
        { metric: "prior_diagnoses", value: diagnoses.length, unit: "count" }, { metric: "prior_plans", value: plans.length, unit: "count" }],
      sourceRecords: [...rows.map((r) => ({ collection: COLLECTIONS.investigations, recordId: r.investigationId })), ...rows.filter((r) => r.incidentId).map((r) => ({ collection: COLLECTIONS.incidents, recordId: r.incidentId! }))],
      detail: { currentMetrics: [...currentMetrics], currentThemes: [...currentThemes], investigations: cap(rows, input.limit), scope: input.includeOtherRuns ? "business" : "run" },
      warnings: input.includeOtherRuns ? ["Results include other simulation runs of the same business; those runs may have different seeds and timelines"] : [],
      dataOrigin: "normal_internal",
    };
    return { evidence: [evidence], resultCount: rows.length, warnings: evidence.warnings };
  },
};
