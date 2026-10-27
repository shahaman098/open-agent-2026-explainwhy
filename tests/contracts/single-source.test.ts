import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Guards the "one authoritative implementation of every canonical schema" rule:
 * nothing outside packages/contracts may declare a second BusinessEvent union,
 * ScenarioName enum or any schema named like a canonical contract.
 */
describe("single source of truth for contracts", () => {
  it("no duplicate canonical schema definitions exist outside packages/contracts", () => {
    const patterns = [
      "discriminatedUnion\\(['\"]type['\"]",
      "export const (BusinessEvent|IngestBatch|IngestResult|MetricSnapshot|SimulatorRun|InjectScenarioRequest|SimulatorTickRequest|SimulatorTickResponse|ScenarioGroundTruth|ScenarioName|PlanHandoff|ProposedPlan|ActionProposal)\\b",
    ];
    for (const pattern of patterns) {
      let out = "";
      try {
        out = execFileSync("grep", ["-rEl", pattern, "src", "tests", "--include=*.ts", "--include=*.tsx"], {
          encoding: "utf8",
        });
      } catch (error) {
        // grep exits 1 when nothing matches, which is the desired outcome.
        const e = error as { status?: number; stdout?: string };
        if (e.status !== 1) throw error;
        out = e.stdout ?? "";
      }
      expect(out.trim(), `pattern ${pattern} matched outside packages/contracts`).toBe("");
    }
  });
});
