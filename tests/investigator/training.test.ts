import { describe, expect, it } from "vitest";
import { sourceDataset, validateSplit } from "@/intelligence/training/source-dataset";
import { compare, score, prediction } from "@/intelligence/training/score";
import { sourceTaskRequest } from "@/intelligence/investigator/source-task";
import { readConsoleStatus } from "@/intelligence/training/console-status";

const cases = sourceDataset();
const answer = (sourceId: string, relation: string) => ({ assessments: [{ sourceId, relation, rationale: "The supplied passage determines this assessment." }] });
describe("training evaluation boundaries", () => {
  it("keeps recorded calls separate from kept examples and requires a version for a passing adapter", () => {
    const expected = { model: "gpt-6-luna", datasetHash: "dataset", fingerprint: "task" };
    const observation = { origin: "mubit_console", task: "normal.source_support.v1", ...expected, mubitTaskId: "ln_observed", observedAt: "2026-10-25T07:05:00.000Z",
      taskUrl: "https://app.mubit.ai/console/projects/project/workloads/ln_observed", trainingStatus: "reviewing_examples", callsObserved: 40,
      keptExamples: 0, rejectedExamples: 0, waitingForReview: 40, reviewQueued: 30, reviewRunning: 2, firstTrainingStarted: false, adapterVersionId: null, evidencePaths: ["capture.png"] };
    expect(readConsoleStatus(observation, expected)).toMatchObject({ callsObserved: 40, keptExamples: 0, firstTrainingStarted: false });
    expect(() => readConsoleStatus({ ...observation, model: "foreign" }, expected)).toThrow("mismatch");
    expect(() => readConsoleStatus({ ...observation, trainingStatus: "passed" }, expected)).toThrow("adapter_identity");
  });
  it("freezes balanced disjoint scene groups and keeps answer labels out of model input", () => {
    validateSplit(cases);
    expect(cases.filter((c) => c.split === "train")).toHaveLength(40);
    expect(cases.filter((c) => c.split === "test")).toHaveLength(24);
    expect(new Set(cases.filter((c) => c.split === "test").map((c) => c.group)).size).toBe(6);
    expect(() => validateSplit([...cases, { ...cases[0], caseId: "different", split: "test" }])).toThrow();
    expect(sourceTaskRequest("model", cases[0].input).input).toEqual(cases[0].input);
    expect(JSON.stringify(sourceTaskRequest("model", cases[0].input))).not.toContain('"expected"');
  });
  it("rejects duplicate or unrecognised assessment identities", () => {
    expect(() => prediction(cases[0], answer("wrong", "supported"))).toThrow("identity");
    expect(() => prediction(cases[0], { assessments: [] })).toThrow("identity");
  });
  it("counts invalid/missing responses as errors and preserves unknown cost", () => {
    const rows = cases.slice(0, 4);
    const scored = score(rows, [{ caseId: rows[0].caseId, output: answer(rows[0].input[0].sourceId, rows[0].expected), latencyMs: 100 },
      { caseId: rows[1].caseId, output: answer("unknown", rows[1].expected) }]);
    expect(scored).toMatchObject({ total: 4, attempted: 2, valid: 1, correct: 1, accuracy: 0.25, costUsd: null, totalTokens: null });
    expect(scored.confusionMatrix.contradictory.invalid_or_missing).toBe(1);
    expect(scored.accuracyWilson95![0]).toBeLessThan(0.25);
    expect(scored.accuracyWilson95![1]).toBeGreaterThan(0.25);
  });
  it("rejects duplicate and out-of-dataset results", () => {
    expect(() => score(cases, [{ caseId: cases[0].caseId }, { caseId: cases[0].caseId }])).toThrow("duplicate");
    expect(() => score(cases, [{ caseId: "foreign" }])).toThrow("unexpected");
  });
  it("requires complete paired evaluation and does not call a tie an improvement", () => {
    const heldout = cases.filter((c) => c.split === "test");
    const outputs = heldout.map((c) => ({ caseId: c.caseId, output: answer(c.input[0].sourceId, c.expected) }));
    expect(() => compare(heldout, outputs.slice(1), outputs)).toThrow("all_cases");
    expect(compare(heldout, outputs, outputs)).toMatchObject({ accuracyDelta: 0, scenes: 6, sceneBootstrap95: [0, 0], improvedInPilot: false });
    const wrong = heldout.map((c) => ({ caseId: c.caseId, output: answer(c.input[0].sourceId, c.expected === "supported" ? "insufficient" : "supported") }));
    expect(compare(heldout, wrong, outputs)).toMatchObject({ accuracyDelta: 1, improvedInPilot: true });
  });
});
