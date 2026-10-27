import { describe, expect, it } from "vitest";
import { recallHistoricalMemories, type HistoricalMemory } from "@/integrations/meterless/history";
import { HMEM } from "@/vendor/meterless-hmem";

const scope = { businessId: "nike_demo", simulationRunId: "run_one", investigationId: "current", cutoff: "2026-10-24T12:00:00.000Z", availableBefore: "2026-10-27T12:00:00.000Z" };
const query = "Advertising campaign clicks spend investigation";
const prior: HistoricalMemory = { ...scope, investigationId: "prior", reportId: "prior_report", observedThrough: "2026-10-23T12:00:00.000Z", availableAt: "2026-10-26T12:00:00.000Z", title: query, metrics: ["clicks", "spend"], themes: ["advertising"], summaries: ["Check tracking before changing the budget."] };

describe("Meterless H-MEM application adapter", () => {
  it("runs actual upstream recall with source lineage and an auditable read", () => {
    const recall = recallHistoricalMemories(scope, query, [prior]);
    expect(recall.memories).toHaveLength(1);
    expect(recall.memories[0]).toMatchObject({ source: "investigations:prior", layer: "working", confidence: 0.7, provenance: { refs: ["prior", "prior_report"] } });
    expect(recall.context).toContain("[MEMORY CONTEXT]");
    expect(recall.contextOnly).toBe(true);
    expect(recall.ledger.map((entry) => entry.action)).toEqual(["create", "read"]);
    expect(recallHistoricalMemories(scope, query, [prior])).toEqual(recall);
  });
  it("cannot recall another tenant, another run, itself, invalid dates or future reports", () => {
    const candidates = [
      { ...prior, businessId: "other" }, { ...prior, simulationRunId: "other" }, { ...prior, investigationId: "current" },
      { ...prior, observedThrough: "2026-10-25T00:00:00.000Z" }, { ...prior, availableAt: "2026-10-28T00:00:00.000Z" }, { ...prior, availableAt: "invalid" },
    ];
    expect(recallHistoricalMemories(scope, query, candidates).memories).toEqual([]);
    expect(recallHistoricalMemories(scope, query, candidates).ledger).toEqual([]);
  });
  it("recalls a sparsely worded finding by its canonical investigation subject", () => {
    const title = "Advertising performance deterioration across 5 campaigns";
    const report = { ...prior, title, metrics: ["ctr", "cac_minor"], themes: ["unknown"],
      summaries: ["The incident is not fully explained by available evidence; the primary cause remains unknown."] };
    const recall = recallHistoricalMemories(scope, `${title} ctr cac_minor`, [report]);
    expect(recall.memories[0]?.source).toBe("investigations:prior");
    expect(recallHistoricalMemories(scope, "Shipping delivery delays and carrier performance", [report]).memories).toEqual([]);
  });
  it("preserves the upstream source requirement and exact wrong-feedback penalty", () => {
    const engine = new HMEM({ clock: () => 0 });
    expect(() => engine.add({ content: "A report", source: "" })).toThrow(/source/);
    const memory = engine.add({ content: query, source: "investigations:prior", confidence: 0.7 });
    engine.feedback(memory.id, "wrong");
    expect(engine.store.get(memory.id)?.confidence).toBeCloseTo(0.5);
    expect(engine.store.get(memory.id)?.tags).toContain("review");
  });
});
