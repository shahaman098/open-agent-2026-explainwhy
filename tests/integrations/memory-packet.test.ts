import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { COLLECTIONS } from "@/lib/collections";
import { loadVerifiedEvidence, validateReferences } from "@/intelligence/investigator/validation";
import { recallHistoricalMemories } from "@/integrations/meterless/history";

const scope = { businessId: "nike_demo", simulationRunId: "run_one", investigationId: "current" };
const cutoff = "2026-10-24T12:00:00.000Z", availableBefore = "2026-10-27T12:00:00.000Z";
const query = "Advertising campaign clicks spend investigation";
const memory = recallHistoricalMemories({ ...scope, cutoff, availableBefore }, query, [{ ...scope, investigationId: "prior", title: query, metrics: ["clicks"], themes: ["advertising"], summaries: [], reportId: "prior_report", observedThrough: "2026-10-23T00:00:00.000Z", availableAt: "2026-10-26T00:00:00.000Z" }]);
const evidence = { schemaVersion: 1, ...scope, evidenceId: "historical_evidence", category: "technical", title: "History", observation: "Prior report for context only", measurements: [], sourceRecords: [{ collection: COLLECTIONS.investigations, recordId: "prior" }], retrievedAt: availableBefore };

function dbWithRecall(hmem: unknown) {
  return { collection(name: string) {
    return {
      find: () => ({ toArray: async () => name === COLLECTIONS.evidence ? [evidence] : [{ investigationId: "prior" }] }),
      countDocuments: async () => 1,
      findOne: async () => name === COLLECTIONS.evidenceDetails ? { detail: { hmem } } : null,
    };
  } } as unknown as Db;
}

describe("Historical memory reinjection boundary", () => {
  it("reinjects eligible H-MEM context without promoting it to current causal evidence", async () => {
    const packet = await loadVerifiedEvidence(dbWithRecall(memory), scope, [evidence.evidenceId], cutoff, availableBefore);
    expect(packet.historicalMemory).toHaveLength(1);
    expect(packet.historicalMemory?.[0].context).toContain(query);
    expect(packet.evidence).toEqual([]);
    expect(() => validateReferences([evidence.evidenceId], packet.evidence)).toThrow(/unknown/);
  });
  it("rejects a recall generated after the queued job's knowledge boundary", async () => {
    const future = { ...memory, scope: { ...memory.scope, availableBefore: "2026-10-28T00:00:00.000Z" } };
    expect((await loadVerifiedEvidence(dbWithRecall(future), scope, [evidence.evidenceId], cutoff, availableBefore)).historicalMemory).toEqual([]);
  });
  it("ignores old, missing or cross-tenant memory metadata", async () => {
    for (const invalid of [null, { contextOnly: true }, { ...memory, scope: { ...memory.scope, businessId: "other" } }]) {
      expect((await loadVerifiedEvidence(dbWithRecall(invalid), scope, [evidence.evidenceId], cutoff, availableBefore)).historicalMemory).toEqual([]);
    }
  });
});
