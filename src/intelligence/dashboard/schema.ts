import { z } from "zod";

export const ANALYSIS_VERSION = "local-dashboard-v4";
export const AnalysisScope = z.object({ businessId: z.string().regex(/^[a-z0-9_]{1,64}$/), simulationRunId: z.string().regex(/^[a-z0-9_]{1,64}$/) }).strict();
export type AnalysisScopeT = z.infer<typeof AnalysisScope>;
const prose = (min: number, max: number) => z.string().min(min).max(max).regex(/^[^0-9%£$€]*$/, "Keep numeric values in fact cards");
export const AnalysisOutput = z.object({
  headline: prose(5, 110),
  summary: prose(10, 600),
  findings: z.array(z.object({ factId: z.string().min(1).max(80), interpretation: prose(8, 260) }).strict()).min(1).max(4),
  nextChecks: z.array(z.object({ topic: z.enum(["advertising", "checkout", "fulfilment", "inventory", "data_quality"]), reason: prose(8, 260), factIds: z.array(z.string().min(1).max(80)).min(1).max(3) }).strict()).min(1).max(3),
}).strict();
export type AnalysisOutputT = z.infer<typeof AnalysisOutput>;
export interface AnalysisFact {
  id: string; label: string; current: string; previous: string | null; changePercent: number | null;
  source: string; explanation: string;
}
export interface AnalysisPacket {
  scope: AnalysisScopeT;
  window: { startAt: string; endAt: string; baselineStartAt: string | null };
  facts: AnalysisFact[];
  investigations: Array<{ investigationId: string; title: string; status: string }>;
  limitations: string[];
}

/** References and numerical statements are controlled locally; prose remains a model interpretation. */
export function validateAnalysis(value: unknown, packet: AnalysisPacket): AnalysisOutputT {
  const output = AnalysisOutput.parse(value), ids = new Set(packet.facts.map(fact => fact.id));
  const refs = [...output.findings.map(item => item.factId), ...output.nextChecks.flatMap(item => item.factIds)];
  if (refs.some(id => !ids.has(id))) throw new Error("Analysis cited an unknown fact");
  const prose = [output.headline, output.summary, ...output.findings.map(item => item.interpretation), ...output.nextChecks.map(item => item.reason)].join(" ");
  if (/\d|[%£$€]/.test(prose)) throw new Error("Keep numeric values in the provided fact cards, not generated prose");
  if (/\b(?:caused by|proven cause|confirmed cause|definitely caused|definitively|guaranteed|root cause is)\b/i.test(prose)) throw new Error("An operational summary cannot establish a causal diagnosis");
  if (new Set(output.findings.map(item => item.factId)).size !== output.findings.length) throw new Error("Duplicate finding");
  return output;
}

export const ModelDecision = z.object({
  focus: z.enum(["revenue", "acquisition", "checkout", "fulfilment", "inventory", "steady", "data_quality"]),
  findingIds: z.array(z.string()).min(1).max(4),
  nextChecks: z.array(z.object({ topic: z.enum(["advertising", "checkout", "fulfilment", "inventory", "data_quality"]), factIds: z.array(z.string()).min(1).max(3) }).strict()).min(1).max(3),
  note: z.string().max(400).nullable(),
}).strict();
export type ModelDecisionT = z.infer<typeof ModelDecision>;
export function decisionSchema(packet: AnalysisPacket) {
  const ids = packet.facts.map(fact => fact.id);
  if (!ids.length) throw new Error("No facts available for analysis");
  const factId = z.enum(ids as [string, ...string[]]);
  return ModelDecision.extend({ findingIds: z.array(factId).min(1).max(4), nextChecks: z.array(z.object({ topic: z.enum(["advertising", "checkout", "fulfilment", "inventory", "data_quality"]), factIds: z.array(factId).min(1).max(3) }).strict()).min(1).max(3) });
}
const HEADLINES: Record<ModelDecisionT["focus"], string> = {
  revenue: "Revenue needs a closer look", acquisition: "Check acquisition alongside conversion", checkout: "Review the checkout funnel", fulfilment: "Check delivery performance", inventory: "Review product availability", steady: "Keep monitoring the operating picture", data_quality: "Check data consistency before interpreting the change",
};
const CHECKS: Record<ModelDecisionT["nextChecks"][number]["topic"], string> = {
  advertising: "Compare campaign response and traffic with conversion before changing advertising budgets.",
  checkout: "Inspect checkout failure codes and compare conversion across paid and non-paid traffic.",
  fulfilment: "Review promises already due and delayed orders before attributing a sales change to delivery.",
  inventory: "Check availability alongside demand and out-of-stock checkout failures.",
  data_quality: "Reconcile canonical events with operational records before relying on a changed total.",
};
/** Nemotron selects priorities; code renders comparisons and next-check wording from the cited facts. */
export function renderDecision(value: unknown, packet: AnalysisPacket) {
  const decision = decisionSchema(packet).parse(value);
  if (new Set(decision.findingIds).size !== decision.findingIds.length) throw new Error("Duplicate finding");
  const noteAccepted = !!decision.note && decision.note.length >= 10 && !/\d|[%£$€]|\b(?:caused by|proven|confirmed cause|definitely|root cause|certainly|guaranteed)\b/i.test(decision.note);
  const output: AnalysisOutputT = {
    headline: HEADLINES[decision.focus],
    summary: noteAccepted ? decision.note! : "Nemotron prioritized the observations below from the current database snapshot. Compare the linked records before attributing a cause or choosing a response.",
    findings: decision.findingIds.map(factId => {
      const fact = packet.facts.find(item => item.id === factId)!;
      const direction = fact.changePercent === null ? null : fact.changePercent > 0 ? "higher" : fact.changePercent < 0 ? "lower" : "unchanged";
      return { factId, interpretation: direction ? `The recorded ${fact.label.toLowerCase()} is ${direction} than in the preceding equal-length window. ${fact.explanation}` : fact.explanation };
    }),
    nextChecks: decision.nextChecks.map(check => ({ ...check, reason: CHECKS[check.topic] })),
  };
  return { decision, noteAccepted, output: validateAnalysis(output, packet) };
}
