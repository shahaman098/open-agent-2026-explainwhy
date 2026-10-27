import { expect, it } from "vitest";
import { Diagnosis, type EvidenceT } from "@normal/contracts";
import { composeReport } from "@/intelligence/investigator/reports";
import { ExternalSource, type StateT } from "@/intelligence/investigator/schemas";

it("links only time-eligible supported public claims into the external report section", () => {
  const diagnosis = Diagnosis.parse({ schemaVersion: 1, businessId: "test", investigationId: "inv", diagnosisId: "diag", modelCallId: "call", taskKey: "revenue_diagnosis_v1", createdAt: "2026-10-02T00:00:00Z",
    primaryCause: "unknown", hypotheses: [{ cause: "unknown", strength: "weak", evidenceIds: [], counterEvidenceIds: [], explanation: "No reliable cause established." }],
    summary: "No reliable cause established.", missingEvidence: ["More observations"], requiresReview: true });
  const state = { jobId: "job", investigationId: "inv", businessId: "test", simulationRunId: "run", hypotheses: [], steps: [], stopReason: null, researchCount: 1 } as unknown as StateT;
  const source = ExternalSource.parse({ schemaVersion: 1, sourceId: "src_supported", claimId: "clm_supported", investigationId: "inv", businessId: "test", simulationRunId: "run",
    originalUrl: "https://about.nike.com/news", canonicalUrl: "https://about.nike.com/news", title: "Official release", publisher: "about.nike.com", author: null,
    publishedAt: "2026-10-01T00:00:00Z", updatedAt: null, retrievedAt: "2026-10-02T00:00:00Z", eventWindow: { startAt: "2026-10-01T00:00:00Z", endAt: "2026-10-02T00:00:00Z" },
    proposedClaim: "Nike published an operating model note.", excerpt: "Nike published an operating model note.", excerptMatched: true, contentHash: "a".repeat(64),
    status: "contextual", semanticAssessment: "model_only", claimSupport: "supported", temporalValidity: "within_cutoff", limitations: [], duplicateOf: null, httpStatus: 200 });
  const rejected = { ...source, sourceId: "src_rejected", claimId: "clm_rejected", proposedClaim: "The note caused a simulated outage.", claimSupport: "insufficient" as const, status: "insufficient_evidence" as const };
  const report = composeReport(state, diagnosis, [] as EvidenceT[], [source, rejected], []);
  const external = report.sections.find((section) => section.title === "External research")!;
  expect(external.evidenceIds).toEqual(["src_supported"]);
  expect(external.text).toContain("Nike published an operating model note.");
  expect(external.text).not.toContain(rejected.proposedClaim);
  expect(report.claims.find((claim) => claim.claimId === "clm_rejected")?.support).toBe("insufficient_evidence");
  expect(report.ledger.map((entry) => entry.evidenceId)).toEqual(["src_supported", "src_rejected"]);
});
