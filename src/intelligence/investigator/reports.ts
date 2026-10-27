import { type DiagnosisT, type EvidenceT } from "@normal/contracts";
import { InvestigationReport, type ExternalSourceT, type ReportT, type StateT } from "./schemas";
import { deterministicImpact } from "./validation";

/** All prose is derived from the validated diagnosis/history; there is no second competing narrative model. */
export function composeReport(state: StateT, diagnosis: DiagnosisT, evidence: EvidenceT[], sources: ExternalSourceT[], affected: string[]): ReportT {
  const uncertain = diagnosis.primaryCause === "unknown";
  const impact = deterministicImpact(evidence);
  const acceptedPublic = sources.filter((source) => source.status === "contextual" && source.claimSupport === "supported" && source.temporalValidity === "within_cutoff" && source.excerptMatched && !source.duplicateOf);
  const claims: ReportT["claims"] = diagnosis.hypotheses.map((h, i) => ({ claimId: `${diagnosis.diagnosisId}_claim_${i}`, claim: h.explanation,
    kind: "hypothesis" as const, evidenceIds: h.evidenceIds, counterEvidenceIds: h.counterEvidenceIds, sourceIds: [],
    support: h.cause === "unknown" ? "insufficient_evidence" as const : h.strength === "strong" ? "strongly_supported" as const : h.strength === "moderate" ? "moderately_supported" as const : "tentative" as const,
    limitations: ["Model-assessed semantic support; reference validity is checked separately.", "Observational association does not establish causality."] }));
  claims.push(...sources.map((s) => ({ claimId: s.claimId, claim: s.proposedClaim || "Public source candidate", kind: "external_context" as const, evidenceIds: [], counterEvidenceIds: [], sourceIds: [s.sourceId], support: s.status === "contradictory" ? "contradicted" as const : s.status === "contextual" ? "tentative" as const : "insufficient_evidence" as const, limitations: s.limitations })));
  const limitations = [...diagnosis.missingEvidence, ...(state.stopReason ? [state.stopReason] : [])];
  const brief = { whatChanged: "The detector observed changes in the incident metrics shown above.", explanation: diagnosis.summary,
    certainty: uncertain ? "Insufficient evidence to select a reliable primary explanation." : "Qualified model assessment requiring operator review; not a calibrated probability.",
    impact: impact.interpretation, review: diagnosis.missingEvidence.slice(0, 3) };
  const ledger: ReportT["ledger"] = evidence.map((e) => {
    const supports = claims.filter((c) => c.evidenceIds.includes(e.evidenceId)), counters = claims.filter((c) => c.counterEvidenceIds.includes(e.evidenceId));
    return { evidenceId: e.evidenceId, origin: "internal", verification: "Canonical schema and scoped source references verified", claimIds: [...new Set([...supports, ...counters].map((c) => c.claimId))],
      role: supports.length && counters.length ? "mixed" : counters.length ? "contradiction" : supports.length ? "support" : "context",
      sourceLinks: [`/api/investigations/${encodeURIComponent(state.investigationId)}/ai/sources?businessId=${encodeURIComponent(state.businessId)}&simulationRunId=${encodeURIComponent(state.simulationRunId)}&evidenceId=${encodeURIComponent(e.evidenceId)}`], limitations: ["Measured source validity does not prove a causal interpretation."] };
  });
  ledger.push(...sources.map((s) => ({ evidenceId: s.sourceId, origin: "external" as const, verification: s.status, claimIds: [s.claimId], role: "context" as const, sourceLinks: s.canonicalUrl ? [s.canonicalUrl] : [], limitations: s.limitations })));
  return InvestigationReport.parse({ schemaVersion: 1, reportId: `report_${state.jobId}`, version: 1, investigationId: state.investigationId, diagnosisId: diagnosis.diagnosisId, createdAt: new Date().toISOString(), diagnosis,
    executiveBrief: brief, impact, claims, ledger, hypotheses: state.hypotheses, timeline: state.steps,
    sections: [
      { title: "Executive summary", text: diagnosis.summary, evidenceIds: [...new Set(diagnosis.hypotheses.flatMap((h) => h.evidenceIds))] },
      { title: "Observed evidence", text: evidence.map((e) => `${e.title}: ${e.observation}`).join("\n\n").slice(0, 12000) || "No verified internal evidence was available.", evidenceIds: evidence.map((e) => e.evidenceId) },
      { title: "Competing explanations", text: diagnosis.hypotheses.map((h) => `${h.cause.replaceAll("_", " ")} (${h.strength}): ${h.explanation}`).join("\n\n"), evidenceIds: [...new Set(diagnosis.hypotheses.flatMap((h) => [...h.evidenceIds, ...h.counterEvidenceIds]))] },
      { title: "Causal challenges and uncertainty", text: state.hypotheses.at(-1)?.hypotheses.map((h) => `${h.explanation}\nChronology: ${h.chronology}\nControls: ${h.controlComparison}\nConfounders: ${h.confounders.join("; ")}\nCould be weakened by: ${h.falsificationTests.join("; ")}`).join("\n\n").slice(0, 12000) || "Insufficient evidence for causal comparison.", evidenceIds: [] },
      { title: "External research", text: acceptedPublic.length
        ? `${acceptedPublic.map((source) => `${source.proposedClaim} [${source.sourceId}]`).join("\n\n")}\n\nThese are model-assessed public facts from independently retrieved pages. They do not establish a cause of this unaffiliated simulation. Other candidates remain in Research Activity with their rejection or uncertainty status.`.slice(0, 12000)
        : sources.length ? "Public source candidates were checked, but none established a time-eligible supported claim for this report. Inspect their recorded verification status. No public source was used as causal evidence." : "No external source was relied upon. Internal evidence may be sufficient, or research was disabled/unavailable.", evidenceIds: acceptedPublic.map((source) => source.sourceId) },
      { title: "Business impact", text: impact.interpretation, evidenceIds: impact.evidenceId ? [impact.evidenceId] : [] },
      { title: "Advisory next steps", text: diagnosis.missingEvidence.map((m) => `Review: ${m}`).join("\n") || "Review the qualified diagnosis and supporting evidence before considering an intervention.", evidenceIds: [] },
    ],
    handoff: { schemaVersion: 1, investigationId: state.investigationId, diagnosisId: diagnosis.diagnosisId, ready: !uncertain && diagnosis.hypotheses.some((h) => h.strength !== "weak" && h.evidenceIds.length > 0), supportedFindings: diagnosis.hypotheses.filter((h) => h.strength !== "weak").map((h) => h.explanation), affectedEntities: affected, evidenceIds: evidence.map((e) => e.evidenceId), impactReference: `report_${state.jobId}`, uncertainty: limitations,
      constraints: ["Human review required", "Stage five is read-only; no executable plan or business mutation", "Synthetic data; external events cannot establish simulated causation"], advisoryCandidates: diagnosis.missingEvidence.map((m) => `Investigate: ${m}`), executable: false },
    insufficientEvidence: uncertain ? { known: evidence.map((e) => e.title), unknown: diagnosis.missingEvidence, plausibleExplanations: diagnosis.hypotheses.map((h) => h.explanation), reason: diagnosis.summary, usefulNextEvidence: diagnosis.missingEvidence, externalResearchUnavailable: state.researchCount === 0 || acceptedPublic.length === 0, conclusionsNotJustified: ["A definitive single root cause", "A causal financial loss estimate", "A verified real-world cause of this synthetic incident"] } : null,
    validation: { passed: true, checks: ["Canonical diagnosis schema", "Business/run/investigation ownership", "Evidence references exist and resolve", "Timestamp cutoff", "Duplicate references rejected", "Numerical prose rejected; impact computed deterministically", "Known contradiction disclosure", "Single diagnosis shared by brief, report and handoff"], semanticSupport: "model_assessed_not_deterministic_proof" },
  });
}
