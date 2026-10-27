import { z } from "zod";
import { Diagnosis, RootCause } from "@normal/contracts";
import { TOOL_NAMES, Window } from "../evidence/types";

const Text = z.string().min(1).max(2000);
const Id = z.string().min(1).max(160);
const Refs = z.array(Id).max(80);
export const Scope = z.object({ businessId: z.string().regex(/^[a-z0-9_]{1,64}$/).default("nike_demo"), simulationRunId: z.string().regex(/^[a-z0-9_]{1,64}$/), investigationId: Id }).strict();
export type ScopeT = z.infer<typeof Scope>;
export const Support = z.enum(["strongly_supported", "moderately_supported", "tentative", "insufficient_evidence", "contradicted"]);
export const Hypothesis = z.object({
  cause: RootCause, explanation: Text, mechanism: Text, support: Support,
  evidenceIds: Refs, counterEvidenceIds: Refs, expectedObservations: z.array(Text).min(1).max(6),
  missingEvidence: z.array(Text).max(8), falsificationTests: z.array(Text).min(1).max(6),
  chronology: Text, confounders: z.array(Text).max(6), controlComparison: Text,
}).strict();
export const ResearchDelegation = z.object({
  topic: z.enum(["advertising_platform_disruption", "logistics_disruption", "public_recall", "retail_market", "regional_weather"]),
  question: Text, rationale: Text, geography: z.enum(["UK", "global"]), hypotheses: z.array(RootCause).min(1).max(5),
  sourceTypes: z.array(z.enum(["official_status", "official_statement", "government", "independent_reporting"])).min(1).max(4),
}).strict();
export const ToolChoice = z.object({ tool: z.enum(TOOL_NAMES), question: Text, campaignIds: z.array(z.string().max(64)).max(20), productIds: z.array(z.string().max(64)).max(20) }).strict();
export const ReasoningOutput = z.object({ hypotheses: z.array(Hypothesis).min(2).max(7), decisionSummary: Text,
  nextTools: z.array(ToolChoice).max(3), research: ResearchDelegation.nullable(), stop: z.boolean(), stopReason: Text,
}).strict();
export type ReasoningT = z.infer<typeof ReasoningOutput>;
export const HypothesisSet = z.object({ schemaVersion: z.literal(1), revision: z.number().int().positive(), createdAt: z.string().datetime(), hypotheses: z.array(Hypothesis.extend({ hypothesisId: Id })), decisionSummary: Text }).strict();
export type HypothesisSetT = z.infer<typeof HypothesisSet>;
export const InvestigationStep = z.object({ stepId: Id, type: z.enum(["context", "reasoning", "tool", "research", "validation", "diagnosis", "report", "recovery"]),
  status: z.enum(["running", "completed", "failed", "unknown"]), identifier: Text, question: Text, startedAt: z.string().datetime(), completedAt: z.string().datetime().nullable(),
  resultSummary: z.string().max(4000), evidenceIds: Refs, error: z.string().nullable(), parameters: z.record(z.unknown()).nullable().optional(),
}).strict();
export type StepT = z.infer<typeof InvestigationStep>;
export const ExternalSource = z.object({
  schemaVersion: z.literal(1), sourceId: Id, claimId: Id, investigationId: Id, businessId: Id, simulationRunId: Id,
  originalUrl: z.string(), canonicalUrl: z.string().nullable(), title: z.string(), publisher: z.string().nullable(), author: z.string().nullable(),
  publishedAt: z.string().nullable(), updatedAt: z.string().nullable(), retrievedAt: z.string().datetime(), eventWindow: Window,
  proposedClaim: z.string(), excerpt: z.string().max(600), excerptMatched: z.boolean(), contentHash: z.string().nullable(),
  status: z.enum(["verified_accessible", "claim_not_supported", "insufficient_evidence", "contextual", "unavailable", "unverifiable", "contradictory", "temporally_irrelevant"]),
  semanticAssessment: z.enum(["not_assessed", "model_only"]), temporalValidity: z.enum(["within_cutoff", "after_cutoff", "unknown"]),
  claimSupport: z.enum(["not_assessed", "supported", "contradictory", "context_only", "insufficient"]).optional(),
  contextRelevance: z.enum(["not_assessed", "relevant", "not_relevant", "uncertain"]).optional(),
  publisherIdentity: z.enum(["official_domain", "retrieved_host_only"]).optional(),
  previewImageUrl: z.string().url().nullable().optional(),
  limitations: z.array(z.string()), duplicateOf: z.string().nullable(), httpStatus: z.number().nullable(),
}).strict();
export type ExternalSourceT = z.infer<typeof ExternalSource>;
export const ClaimEvidenceMatrix = z.array(z.object({ claimId: Id, claim: Text, kind: z.enum(["observed_fact", "supported_inference", "hypothesis", "external_context"]), evidenceIds: Refs, counterEvidenceIds: Refs, sourceIds: Refs, support: Support, limitations: z.array(Text) }).strict());
export const BusinessImpactAssessment = z.object({ schemaVersion: z.literal(1), status: z.enum(["measured", "unknown"]), evidenceId: Id.nullable(), metric: z.string().nullable(), value: z.number().nullable(), baseline: z.number().nullable(), delta: z.number().nullable(), unit: z.string().nullable(), interpretation: Text, limitations: z.array(Text) }).strict();
export type ImpactT = z.infer<typeof BusinessImpactAssessment>;
export const EvidenceLedger = z.array(z.object({ evidenceId: Id, origin: z.enum(["internal", "external"]), verification: Text, claimIds: Refs, role: z.enum(["support", "contradiction", "mixed", "context"]), sourceLinks: z.array(z.string()), limitations: z.array(z.string()) }).strict());
export const ExecutiveBrief = z.object({ whatChanged: Text, explanation: Text, certainty: Text, impact: Text, review: z.array(Text) }).strict();
export const PlannerReadinessHandoff = z.object({ schemaVersion: z.literal(1), investigationId: Id, diagnosisId: Id, ready: z.boolean(), supportedFindings: z.array(Text), affectedEntities: z.array(Id), evidenceIds: Refs, impactReference: Id, uncertainty: z.array(Text), constraints: z.array(Text), advisoryCandidates: z.array(Text), executable: z.literal(false) }).strict();
export const InsufficientEvidenceReport = z.object({ known: z.array(Text), unknown: z.array(Text), plausibleExplanations: z.array(Text), reason: Text, usefulNextEvidence: z.array(Text), externalResearchUnavailable: z.boolean(), conclusionsNotJustified: z.array(Text) }).strict();
export const InvestigationReport = z.object({ schemaVersion: z.literal(1), reportId: Id, version: z.literal(1), investigationId: Id, diagnosisId: Id, createdAt: z.string().datetime(),
  diagnosis: Diagnosis, executiveBrief: ExecutiveBrief, impact: BusinessImpactAssessment, claims: ClaimEvidenceMatrix, ledger: EvidenceLedger,
  hypotheses: z.array(HypothesisSet), timeline: z.array(InvestigationStep), sections: z.array(z.object({ title: Text, text: z.string().max(12000), evidenceIds: Refs }).strict()),
  handoff: PlannerReadinessHandoff, insufficientEvidence: InsufficientEvidenceReport.nullable(), validation: z.object({ passed: z.literal(true), checks: z.array(Text), semanticSupport: z.literal("model_assessed_not_deterministic_proof") }).strict(),
}).strict();
export type ReportT = z.infer<typeof InvestigationReport>;
export const Budget = z.object({ maxRounds: z.number().int().min(1).max(5), maxTools: z.number().int().min(1).max(12), maxResearchRounds: z.number().int().min(0).max(2), maxSources: z.number().int().min(0).max(8), maxCalls: z.number().int().min(2).max(12), maxTokens: z.number().int().min(5000).max(500000), maxWallMs: z.number().int().min(60000).max(1800000), maxCostUsd: z.number().positive().nullable() }).strict();
export type BudgetT = z.infer<typeof Budget>;
export const InvestigationState = z.object({ schemaVersion: z.literal(1), jobId: Id, ...Scope.shape,
  status: z.enum(["queued", "running", "completed", "insufficient_evidence", "failed", "cancelled"]),
  stage: Text, createdAt: z.string().datetime(), updatedAt: z.string().datetime(), startedAt: z.string().datetime().nullable(), completedAt: z.string().datetime().nullable(),
  round: z.number().int(), toolCount: z.number().int(), researchCount: z.number().int(), sourceCount: z.number().int().default(0), callCount: z.number().int(), reservedTokens: z.number().int(), actualTokens: z.number().int(), estimatedCostUsd: z.number(), budget: Budget,
  cutoff: z.string().datetime(), incidentWindow: Window, baselineWindow: Window.nullable(), evidenceIds: Refs, sourceIds: Refs, hypotheses: z.array(HypothesisSet), steps: z.array(InvestigationStep),
  error: z.string().nullable(), stopReason: z.string().nullable(), reportId: Id.nullable(), attempts: z.number().int(),
}).strict();
export type StateT = z.infer<typeof InvestigationState>;

export const SourceAssessments = z.object({ assessments: z.array(z.object({ sourceId: Id, relation: z.enum(["supported", "contradictory", "context_only", "insufficient"]), rationale: Text }).strict()).max(8) }).strict();
