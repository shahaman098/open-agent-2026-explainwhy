import { describe, expect, it } from "vitest";
import { RootCause, type EvidenceT } from "@normal/contracts";
import { deterministicImpact, fallbackHypotheses, validateDiagnosis, validateReferences } from "@/intelligence/investigator/validation";
import { HypothesisSet } from "@/intelligence/investigator/schemas";
const cause = RootCause.options[0];
const evidence: EvidenceT = { schemaVersion: 1, businessId: "test", investigationId: "inv", evidenceId: "e_one", category: "sales", title: "Revenue", observation: "Simulated measured revenue", measurements: [{ metric: "net_revenue_minor_per_hour", value: 100, baseline: 200, unit: "GBP minor units/hour" }], sourceRecords: [{ collection: "metric_snapshots", recordId: "snap" }], retrievedAt: "2026-10-01T00:00:00Z" };
const diagnosis = { primaryCause: cause, hypotheses: [{ cause, strength: "moderate" as const, evidenceIds: ["e_one"], counterEvidenceIds: [], explanation: "Observed engagement deterioration is a plausible contributor." }], summary: "The evidence moderately supports this explanation, with uncertainty remaining.", missingEvidence: ["An unaffected comparison cohort"], requiresReview: true };
describe("diagnosis validity and arithmetic", () => {
  it("accepts qualified canonical output with resolvable allowed evidence", () => { expect(validateDiagnosis(diagnosis, [evidence], [])).toEqual(diagnosis); });
  it.each(["fake", "other_run_evidence"])("rejects a fabricated or cross-run reference %s", (id) => { expect(() => validateDiagnosis({ ...diagnosis, hypotheses: [{ ...diagnosis.hypotheses[0], evidenceIds: [id] }] }, [evidence], [])).toThrow("unknown_or_cross_scope_evidence"); });
  it("rejects duplicate references, unsupported primary causes and mandatory-review bypass", () => { expect(() => validateReferences(["e_one", "e_one"], [evidence])).toThrow("duplicate"); expect(() => validateDiagnosis({ ...diagnosis, requiresReview: false }, [evidence], [])).toThrow("review_required"); expect(() => validateDiagnosis({ ...diagnosis, hypotheses: [{ ...diagnosis.hypotheses[0], evidenceIds: [] }] }, [evidence], [])).toThrow("unsupported_primary"); });
  it("rejects invented arithmetic and overstated conclusions", () => { expect(() => validateDiagnosis({ ...diagnosis, summary: "Revenue dropped 45%." }, [evidence], [])).toThrow("numerical"); expect(() => validateDiagnosis({ ...diagnosis, summary: "This is conclusively the cause." }, [evidence], [])).toThrow("overstated"); });
  it("requires unknown when budgets are exhausted", () => { expect(() => validateDiagnosis(diagnosis, [evidence], [], true)).toThrow("budget_limited"); expect(validateDiagnosis({ ...diagnosis, primaryCause: "unknown" }, [evidence], [], true).primaryCause).toBe("unknown"); });
  it("discloses contradictions from the latest hypothesis assessment", () => {
    const history = HypothesisSet.parse({ schemaVersion: 1, revision: 1, createdAt: "2026-10-01T00:00:00Z", decisionSummary: "A counterexample weakens the explanation", hypotheses: [{ hypothesisId: "h", cause, explanation: "Plausible", mechanism: "Mechanism", support: "tentative", evidenceIds: [], counterEvidenceIds: ["e_one"], expectedObservations: ["A change"], missingEvidence: [], falsificationTests: ["Check a control cohort"], chronology: "Unknown", confounders: [], controlComparison: "Unavailable" }] });
    expect(() => validateDiagnosis(diagnosis, [evidence], [history])).toThrow("missing_contradiction");
    history.hypotheses[0].evidenceIds = ["e_one", "missing"];
    const fallback = fallbackHypotheses([history], [evidence]);
    expect(fallback[0]).toMatchObject({ strength: "weak", evidenceIds: [], counterEvidenceIds: ["e_one"] });
    expect(validateDiagnosis({ ...diagnosis, primaryCause: "unknown", hypotheses: fallback }, [evidence], [history], true).primaryCause).toBe("unknown");
  });
  it("computes financial differences only from a unique comparable business aggregate", () => { expect(deterministicImpact([evidence])).toMatchObject({ status: "measured", delta: -100 }); const duplicate = { ...evidence, evidenceId: "e_duplicate" }; expect(deterministicImpact([evidence, duplicate]).delta).toBe(-100); expect(deterministicImpact([{ ...evidence, measurements: [{ metric: "campaign_ctr", value: 0.1, baseline: 0.3, unit: "ratio" }] }]).status).toBe("unknown"); expect(deterministicImpact([evidence, { ...evidence, evidenceId: "e_diff", measurements: [{ ...evidence.measurements[0], value: 40 }] }]).status).toBe("unknown"); });
});
