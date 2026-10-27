import { RELATIONS, type Relation, type TrainingCase } from "./source-dataset";
import { SourceAssessments } from "../investigator/schemas";

export function prediction(row: TrainingCase, output: unknown): Relation {
  const parsed = SourceAssessments.parse(output);
  if (parsed.assessments.length !== 1 || parsed.assessments[0].sourceId !== row.input[0].sourceId) throw new Error("assessment_identity_mismatch");
  return parsed.assessments[0].relation;
}
export interface ScoredOutput { caseId: string; output?: unknown; latencyMs?: number; totalTokens?: number | null; costUsd?: number | null; error?: string }
export function score(cases: TrainingCase[], outputs: ScoredOutput[]) {
  if (new Set(outputs.map((o) => o.caseId)).size !== outputs.length) throw new Error("duplicate_results");
  if (outputs.some((o) => !cases.some((c) => c.caseId === o.caseId))) throw new Error("unexpected_case");
  const matrix = Object.fromEntries(RELATIONS.map((r) => [r, Object.fromEntries([...RELATIONS, "invalid_or_missing"].map((p) => [p, 0]))])) as Record<Relation, Record<string, number>>;
  const rows = cases.map((c) => {
    const output = outputs.find((o) => o.caseId === c.caseId);
    let predicted: Relation | null = null;
    try { if (output && !output.error) predicted = prediction(c, output.output); } catch { /* Schema/identity failures count against quality. */ }
    matrix[c.expected][predicted || "invalid_or_missing"]++;
    return { caseId: c.caseId, expected: c.expected, predicted, correct: predicted === c.expected };
  });
  const n = cases.length, correct = rows.filter((r) => r.correct).length, p = n ? correct / n : 0, z = 1.96;
  const center = n ? (p + z * z / (2 * n)) / (1 + z * z / n) : 0;
  const radius = n ? z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n) : 0;
  const perClass = RELATIONS.map((r) => {
    const tp = matrix[r][r], fn = Object.values(matrix[r]).reduce((a, b) => a + b, 0) - tp;
    const fp = RELATIONS.filter((s) => s !== r).reduce((a, s) => a + matrix[s][r], 0);
    return { relation: r, support: tp + fn, precision: tp + fp ? tp / (tp + fp) : 0, recall: tp + fn ? tp / (tp + fn) : 0, f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : 0 };
  });
  const latencies = outputs.flatMap((o) => o.latencyMs !== undefined ? [o.latencyMs] : []).sort((a, b) => a - b);
  return { total: n, attempted: outputs.length, valid: rows.filter((r) => r.predicted !== null).length, correct, accuracy: p,
    accuracyWilson95: n ? [Math.max(0, center - radius), Math.min(1, center + radius)] : null,
    macroF1: perClass.reduce((a, r) => a + r.f1, 0) / RELATIONS.length, perClass, confusionMatrix: matrix,
    p50LatencyMs: latencies.length ? latencies[Math.ceil(latencies.length * 0.5) - 1] : null,
    p95LatencyMs: latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : null,
    totalTokens: outputs.length && outputs.every((o) => typeof o.totalTokens === "number") ? outputs.reduce((a, o) => a + o.totalTokens!, 0) : null,
    costUsd: outputs.length && outputs.every((o) => typeof o.costUsd === "number") ? outputs.reduce((a, o) => a + o.costUsd!, 0) : null, rows };
}

/** Pair by exact case identity. Resample whole scenes, never correlated claims as independent incidents. */
export function compare(cases: TrainingCase[], provider: ScoredOutput[], adapter: ScoredOutput[]) {
  const base = score(cases, provider), trained = score(cases, adapter);
  if (!cases.length || base.attempted !== cases.length || trained.attempted !== cases.length) throw new Error("paired_comparison_requires_all_cases");
  const groups = [...new Set(cases.map((c) => c.group))];
  const sceneDeltas = groups.map((group) => {
    const indexes = cases.flatMap((c, i) => c.group === group ? [i] : []);
    return indexes.reduce((sum, i) => sum + Number(trained.rows[i].correct) - Number(base.rows[i].correct), 0) / indexes.length;
  });
  // Fixed seed makes the bootstrap reproducible. This is a small pilot, not a production guarantee.
  let state = 173;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const deltas = Array.from({ length: 10000 }, () => sceneDeltas.reduce((sum) => sum + sceneDeltas[Math.floor(random() * groups.length)], 0) / groups.length).sort((a, b) => a - b);
  const delta = trained.accuracy - base.accuracy;
  const interval = [deltas[249], deltas[9749]];
  const falseSupported = (s: ReturnType<typeof score>) => s.rows.filter((r) => r.expected !== "supported" && r.predicted === "supported").length;
  return { provider: base, adapter: trained, accuracyDelta: delta, sceneBootstrap95: interval, scenes: groups.length,
    providerFalseSupported: falseSupported(base), adapterFalseSupported: falseSupported(trained),
    improvedInPilot: delta > 0 && interval[0] > 0 && trained.valid === cases.length && falseSupported(trained) <= falseSupported(base),
    interpretation: "Predeclared gate: accuracy improves, whole-scene bootstrap lower bound exceeds zero, all adapter responses validate, and false-supported claims do not increase. A six-scene synthetic pilot cannot establish production improvement." };
}
