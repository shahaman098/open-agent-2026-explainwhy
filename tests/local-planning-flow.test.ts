import { describe, expect, it } from "vitest";
import { DiagnosisModelOutput } from "@explainwhy/contracts";
import { localInvestigationRequest } from "@/intelligence/investigator/local-decisions";
import { ReasoningOutput, type HypothesisSetT } from "@/intelligence/investigator/schemas";
import { validateDiagnosis } from "@/intelligence/investigator/validation";
import { contextFixture } from "./planner/fixtures";
import { localPlanningRequest, localStrategyOptions } from "@/planner/local-options";
import { validateStrategy } from "@/planner/validation";

const context = contextFixture(), evidence = context.evidence;
const refs = evidence.map(item => item.evidenceId);
const choice = () => ({ primaryCause: "ad_inefficiency", hypotheses: [{ cause: "ad_inefficiency", strength: "moderate", evidenceIds: [refs[0]], counterEvidenceIds: [] }, { cause: "checkout_failure", strength: "weak", evidenceIds: [], counterEvidenceIds: [] }] });
const request = (input: unknown, schemaName = "root_cause_diagnosis") => ({ model: "fixture-nemotron", system: "test", input, schemaName });

describe("local evidence diagnosis preserves planning gates", () => {
  it("renders a model decision into the canonical schema with real references and a review requirement", () => {
    const adapter = localInvestigationRequest(request({ evidence }))!;
    const rendered = adapter.expand(choice());
    expect(DiagnosisModelOutput.safeParse(rendered).success).toBe(true);
    expect(validateDiagnosis(rendered, evidence, []).primaryCause).toBe("ad_inefficiency");
    expect(rendered).toMatchObject({ requiresReview: true });
    expect(adapter.request.schema?.safeParse({ ...choice(), hypotheses: [{ ...choice().hypotheses[0], evidenceIds: ["another_business_evidence"] }, choice().hypotheses[1]] }).success).toBe(false);
  });
  it("keeps empty or budget-limited investigations from becoming accepted diagnoses", () => {
    expect(() => localInvestigationRequest(request({ evidence: [], limited: false }))!.expand(choice())).toThrow();
    expect(() => localInvestigationRequest(request({ evidence, limited: true }))!.expand(choice())).toThrow(/limited/);
    const unknown = { ...choice(), primaryCause: "unknown", hypotheses: choice().hypotheses.map(item => ({ ...item, strength: "weak", evidenceIds: [] })) };
    expect(DiagnosisModelOutput.parse(localInvestigationRequest(request({ evidence: [] }))!.expand(unknown)).primaryCause).toBe("unknown");
  });
  it("retains known contradictions and never promotes overlapping support", () => {
    const prior = { hypotheses: [{ cause: "ad_inefficiency", counterEvidenceIds: [refs[0]] }] } as unknown as HypothesisSetT;
    expect(() => localInvestigationRequest(request({ evidence, hypotheses: prior }))!.expand(choice())).toThrow(/leading cause/);
    const raw = { ...choice(), primaryCause: "unknown" };
    const rendered = DiagnosisModelOutput.parse(localInvestigationRequest(request({ evidence, hypotheses: prior }))!.expand(raw));
    expect(rendered.hypotheses[0]).toMatchObject({ strength: "weak", evidenceIds: [], counterEvidenceIds: [refs[0]] });
  });
  it("requires evidence collection before synthesis and keeps narratives free of model-authored numerics", () => {
    const { primaryCause: _primary, ...base } = choice(); void _primary;
    const adapter = localInvestigationRequest(request({ evidence }, "investigation_decision"))!;
    const rendered = ReasoningOutput.parse(adapter.expand({ ...base, decision: "synthesize", tools: [] }));
    expect(rendered.stop).toBe(true); expect(rendered.nextTools).toEqual([]);
    for (const hypothesis of rendered.hypotheses) expect(hypothesis.explanation).not.toMatch(/\d|[%£$€]/);
    const empty = { hypotheses: base.hypotheses.map(item => ({ ...item, strength: "weak", evidenceIds: [] })), decision: "synthesize", tools: [] };
    expect(() => localInvestigationRequest(request({ evidence: [] }, "investigation_decision"))!.expand(empty)).toThrow(/Collect/);
  });
});
describe("local planner ranks validated bounded options", () => {
  it("includes observation and valid interventions with real affected campaign targets", () => {
    const ctx = contextFixture(), options = localStrategyOptions(ctx);
    expect(options.length).toBeGreaterThanOrEqual(3);
    expect(options.some(item => item.actions.length === 0)).toBe(true);
    for (const option of options) expect(validateStrategy(ctx, option, "test_plan", 1).check.passed).toBe(true);
    const action = options.flatMap(item => item.actions).find(item => item.budget);
    expect(action?.budget).toEqual({ campaignId: "campaign_A", newDailyBudgetMinor: 9000, currency: "GBP" });
    ctx.report.handoff = { ...ctx.report.handoff, uncertainty: [] };
    const adapter = localPlanningRequest(ctx, request({}));
    const output = adapter.expand({ recommendedKey: options[2].key, comparisonOrder: [options[0].key] });
    expect(output.strategies.map(item => item.key)).toContain("observe");
    expect(output.recommendedKey).toBe(options[2].key);
    expect(() => adapter.expand({ recommendedKey: "invented_action", comparisonOrder: [] })).toThrow();
  });
  it("never substitutes a budget action for an unsupported repair", () => {
    const ctx = contextFixture("discount_failure"), options = localStrategyOptions(ctx);
    expect(options).toHaveLength(2); expect(options.every(item => item.actions.length === 0)).toBe(true);
  });
  it("does not offer budget changes without campaign efficiency evidence", () => {
    const ctx = contextFixture(); ctx.evidenceDetails = [];
    expect(localStrategyOptions(ctx).every(item => item.actions.length === 0)).toBe(true);
  });
});
