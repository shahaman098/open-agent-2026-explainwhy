import "server-only";
import { HMEM } from "@/vendor/meterless-hmem";

export const HMEM_UPSTREAM = "1742dec56a66e58eef9dda2d2b865823758ca8cd";
export interface HistoricalMemory {
  businessId: string; simulationRunId: string; investigationId: string; title: string; observedThrough: string; availableAt: string; reportId: string;
  metrics: string[]; themes: string[]; summaries: string[];
}

/** Rehydrate durable canonical history into the actual Meterless H-MEM reference engine.
 * The evidence detail stores the resulting recall/ledger trace. No shared tenant cache or mutable JSON store.
 */
export function recallHistoricalMemories(scope: { businessId: string; simulationRunId: string; investigationId: string; cutoff: string; availableBefore: string }, query: string, candidates: HistoricalMemory[]) {
  let clock = Date.parse(scope.availableBefore);
  const engine = new HMEM({ clock: () => clock, actor: "explainwhy_investigator" });
  const chatId = `${scope.businessId}/${scope.simulationRunId}`;
  for (const prior of candidates.slice(0, 50)) {
    if (prior.businessId !== scope.businessId || prior.simulationRunId !== scope.simulationRunId || prior.investigationId === scope.investigationId ||
      !Number.isFinite(Date.parse(prior.availableAt)) || Date.parse(prior.availableAt) > Date.parse(scope.availableBefore) ||
      !Number.isFinite(Date.parse(prior.observedThrough)) || Date.parse(prior.observedThrough) > Date.parse(scope.cutoff)) continue;
    clock = Date.parse(prior.availableAt);
    engine.add({
      content: `${prior.title}. Themes: ${prior.themes.join(", ")}. Metrics: ${prior.metrics.join(", ")}. ${prior.summaries.join(" ")}`.slice(0, 2000),
      type: "factual", layer: "working", confidence: 0.7, source: `investigations:${prior.investigationId}`,
      provenance: { origin: "document", learnedAt: clock, label: "Prior investigation report, context only", refs: [prior.investigationId, prior.reportId] },
      chatId, goalRunId: scope.simulationRunId, tags: [...prior.themes, ...prior.metrics].slice(0, 20),
    });
  }
  clock = Date.parse(scope.availableBefore);
  const result = engine.query(query.slice(0, 2000), { chatId, topN: 5 });
  return {
    engine: "Meterless H-MEM reference", upstreamCommit: HMEM_UPSTREAM, implementation: "deterministic hash embeddings; canonical Supabase history rehydrated per query",
    scope: { businessId: scope.businessId, simulationRunId: scope.simulationRunId, cutoff: scope.cutoff, availableBefore: scope.availableBefore },
    contextOnly: true as const, context: result.context, trace: result.trace,
    memories: result.memories.map(({ memory, relevance }) => ({ id: memory.id, source: memory.source, content: memory.content, confidence: memory.confidence, layer: memory.layer, relevance, provenance: memory.provenance })),
    ledger: engine.ledger.all().map((entry) => ({ memoryId: entry.memoryId, action: entry.action, actor: entry.actor, timestamp: entry.timestamp })),
  };
}
export type MemoryRecall = ReturnType<typeof recallHistoricalMemories>;

const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");
function isHistoricalMemory(value: unknown): value is HistoricalMemory {
  const m = value as Partial<Record<keyof HistoricalMemory, unknown>> | null;
  return !!m && typeof m === "object" && (["businessId", "simulationRunId", "investigationId", "title", "observedThrough", "availableAt", "reportId"] as const).every((k) => typeof m[k] === "string")
    && strings(m.metrics) && strings(m.themes) && strings(m.summaries);
}
/** Stored history is untrusted at runtime: skip malformed records, and if recall itself fails, degrade to no recall
 * so the ordinary pattern-overlap comparison still returns. */
export function safeRecallHistoricalMemories(scope: Parameters<typeof recallHistoricalMemories>[0], query: string, candidates: unknown[]): { recall: MemoryRecall | null; warning: string | null } {
  const valid = candidates.filter(isHistoricalMemory), skipped = candidates.length - valid.length;
  try {
    return { recall: recallHistoricalMemories(scope, query, valid), warning: skipped ? `${skipped} malformed H-MEM record(s) were skipped` : null };
  } catch {
    return { recall: null, warning: "Meterless H-MEM recall failed; the historical comparison is returned without recalled memories" };
  }
}
