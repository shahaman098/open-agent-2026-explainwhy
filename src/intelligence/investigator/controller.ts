import "server-only";
import type { Db } from "mongodb";
import { Diagnosis, DiagnosisModelOutput, type DiagnosisModelOutputT } from "@normal/contracts";
import { COLLECTIONS } from "@/lib/collections";
import { loadInvestigationContext, type InvestigationContext } from "../evidence/context";
import { executeTool } from "../evidence/orchestrator";
import { linkEvidenceToInvestigation } from "../evidence/persistence";
import { getTool, listTools } from "../evidence/registry";
import { callModel, providerConfig, ProviderError, promptFingerprint, type ModelRequest, type ModelResponse } from "./provider";
import { DIAGNOSIS_SYSTEM, DIAGNOSIS_TASK, INVESTIGATOR_SYSTEM, PROMPT_VERSION } from "./prompts";
import { HypothesisSet, ReasoningOutput, SourceAssessments, type ExternalSourceT, type ScopeT, type StepT } from "./schemas";
import { claimInvestigation, digest, jobScope, renewLease, saveJob, stateView, type CallDoc, type JobDoc } from "./store";
import { fallbackHypotheses, loadVerifiedEvidence, rejectNumericalProse, validateDiagnosis, validateReferences, type EvidencePacket } from "./validation";
import { composeReport } from "./reports";
import { deduplicateSources, research, verifyExternalSource, type ResearchResult } from "./research";
import { SOURCE_TASK, sourceTaskRequest } from "./source-task";

export interface Services { model: (request: ModelRequest) => Promise<ModelResponse>; research: typeof research; verifySource: typeof verifyExternalSource }
const defaults: Services = { model: callModel, research, verifySource: verifyExternalSource };
const now = () => new Date().toISOString();
class BudgetError extends Error {}
function step(job: JobDoc, type: StepT["type"], identifier: string, question: string): StepT {
  const entry: StepT = { stepId: `${job.jobId}_s${job.steps.length}`, type, identifier, question, status: "running", startedAt: now(), completedAt: null, resultSummary: "", evidenceIds: [], error: null };
  job.steps.push(entry); job.stage = type; return entry;
}
function finish(entry: StepT, resultSummary: string, evidenceIds: string[] = []) { Object.assign(entry, { status: "completed", completedAt: now(), resultSummary, evidenceIds }); }
function budgetCheck(job: JobDoc, reserve: number) {
  if (job.deadline !== null && Date.now() > job.deadline) throw new BudgetError("Investigation wall-clock budget reached");
  if (job.callCount >= job.budget.maxCalls || job.reservedTokens + reserve > job.budget.maxTokens) throw new BudgetError("Investigation model-call or token budget reached");
  if (job.budget.maxCostUsd !== null) {
    const maxRate = Math.max(Number(process.env.NORMAL_INPUT_USD_PER_MILLION), Number(process.env.NORMAL_OUTPUT_USD_PER_MILLION));
    if (!Number.isFinite(maxRate) || (job.reservedTokens + reserve) * maxRate / 1e6 > job.budget.maxCostUsd) throw new BudgetError("Investigation cost budget reached");
  }
}

/** Checkpoint BEFORE sending. A recovered pending request is never silently billed a second time. */
async function durableCall<T extends ModelResponse | ResearchResult>(db: Db, job: JobDoc, key: string, task: string, input: unknown, invoke: () => Promise<T>, outputLimit = 6000, fingerprint: string | null = null): Promise<T> {
  const calls = db.collection<CallDoc>(COLLECTIONS.investigationCalls);
  const id = `${job.jobId}_${key}`;
  const old = await calls.findOne({ callId: id });
  if (old?.status === "completed" && old.result) return old.result as T;
  if (old) throw new ProviderError(old.status === "pending" ? "previous_request_outcome_unknown" : old.error || "previous_request_failed", false, old.status === "pending" || old.ambiguous, old.metadata || {});
  // UTF-8 byte count is a conservative input-token upper bound, plus schema overhead.
  const reserve = Buffer.byteLength(JSON.stringify(input), "utf8") + outputLimit + 6000;
  budgetCheck(job, reserve);
  job.callCount++; job.reservedTokens += reserve; await saveJob(db, job);
  const record: CallDoc = { ...jobScope(job), callId: id, jobId: job.jobId, task, promptVersion: PROMPT_VERSION, promptFingerprint: fingerprint, checksum: digest(input), status: "pending", startedAt: now(), completedAt: null, metadata: null, result: null, error: null, ambiguous: false, reservedTokens: reserve, outputDiagnosisId: null, validationStatus: null, correctionId: null, adapterVersion: null };
  await calls.insertOne(record);
  try {
    const result = await invoke();
    await calls.updateOne({ callId: id, status: "pending" }, { $set: { status: "completed", completedAt: now(), metadata: result.metadata, result } });
    job.actualTokens += result.metadata.totalTokens || 0; job.estimatedCostUsd += result.metadata.estimatedCostUsd || 0;
    await saveJob(db, job); return result;
  } catch (e) {
    // If the completion was already recorded, leave it reusable after lease loss/crash.
    await calls.updateOne({ callId: id, status: "pending" }, { $set: { status: "failed", completedAt: now(), error: e instanceof ProviderError ? e.message : "request_failed", ambiguous: e instanceof ProviderError ? e.ambiguous : true, metadata: e instanceof ProviderError ? e.metadata : null } });
    if (e instanceof ProviderError) {
      job.actualTokens += e.metadata.totalTokens || 0;
      job.estimatedCostUsd += e.metadata.estimatedCostUsd || 0;
      await saveJob(db, job);
    }
    throw e;
  }
}

/** The task fingerprint excludes session IDs and evidence, while checksum retains per-call input identity. */
async function durableModelCall(db: Db, job: JobDoc, key: string, task: string, request: ModelRequest, services: Services) {
  return durableCall(db, job, key, task, request.input, () => services.model(request), request.maxOutputTokens ?? 6000,
    promptFingerprint(request, task, PROMPT_VERSION));
}

export function toolSelection(ctx: InvestigationContext, choice: ReasoningOutputTChoice) {
  for (const id of choice.campaignIds) if (!ctx.affected.campaigns.includes(id)) throw new Error("campaign_outside_incident");
  for (const id of choice.productIds) if (!ctx.affected.products.includes(id)) throw new Error("product_outside_incident");
  const input: Record<string, unknown> = { businessId: ctx.businessId, simulationRunId: ctx.simulationRunId, window: ctx.incidentWindow, ...(ctx.baselineWindow ? { baselineWindow: ctx.baselineWindow } : {}), limit: 50 };
  if (choice.tool === "advertising_analysis") input.campaignIds = choice.campaignIds;
  if (["inventory_analysis", "customer_feedback_analysis", "public_reference_context"].includes(choice.tool)) input.productIds = choice.productIds;
  if (choice.tool === "historical_incidents") input.includeOtherRuns = false;
  // Scope, dates, limits, collection names and filters are server-owned; the model chooses only bounded selectors.
  return { tool: choice.tool, reason: choice.question, role: "alternative_explanation" as const, input: getTool(choice.tool).input.parse(input) as Record<string, unknown> };
}
type ReasoningOutputTChoice = ReturnType<typeof ReasoningOutput.parse>["nextTools"][number];
function contextPacket(ctx: InvestigationContext, packet: EvidencePacket, job: JobDoc, sources: ExternalSourceT[]) {
  return { incident: { title: ctx.investigation.title, anomalies: ctx.anomalies.map((a) => ({ metric: a.metric, direction: a.direction, actual: a.actualValue, baseline: a.baselineValue, window: a.currentWindow })), affected: ctx.affected, window: job.incidentWindow, cutoff: job.cutoff },
    evidence: packet.evidence.map((e) => ({ evidenceId: e.evidenceId, title: e.title, observation: e.observation, window: e.window, measurements: e.measurements })),
    evidenceLimitations: packet.limitations, hypotheses: job.hypotheses.at(-1) || null,
    tools: listTools(), exhaustedChoices: job.executedChoices, toolOutcomes: job.steps.filter((s) => s.type === "tool").map((s) => ({ tool: s.identifier, summary: s.resultSummary, evidenceIds: s.evidenceIds, status: s.status })),
    externalContext: sources.filter((s) => s.temporalValidity === "within_cutoff" && s.excerptMatched && !s.duplicateOf && s.status === "contextual" && ["supported", "context_only"].includes(s.claimSupport || "not_assessed"))
      .map((s) => ({ sourceId: s.sourceId, proposedClaim: s.proposedClaim, excerpt: s.excerpt, status: s.status, claimSupport: s.claimSupport, contextRelevance: s.contextRelevance || "not_assessed", limitations: s.limitations })),
    researchEnabled: job.budget.maxResearchRounds > job.researchCount, roundsRemaining: job.budget.maxRounds - job.round,
    instruction: "Do not include numeric assertions in prose; evidence measurements already carry numerical values. Source IDs are context only, not canonical evidence IDs." };
}
async function executePlan(db: Db, job: JobDoc, ctx: InvestigationContext, services: Services) {
  const plan = job.plan!;
  for (const choice of plan.nextTools) {
    if (job.toolCount >= job.budget.maxTools || (job.deadline && Date.now() > job.deadline)) { job.stopReason = "Internal tool or time budget reached"; break; }
    const selection = toolSelection(ctx, choice), key = digest({ tool: selection.tool, input: selection.input });
    if (job.executedChoices.includes(key)) continue;
    // executeTool itself has deterministic evidence/tool-run IDs, so a crash before checkpoint safely reuses them.
    const entry = step(job, "tool", choice.tool, choice.question); entry.parameters = selection.input; await saveJob(db, job);
    const outcome = await executeTool(ctx, selection, job.jobId);
    job.toolCount++; job.executedChoices.push(key); job.evidenceIds = [...new Set([...job.evidenceIds, ...outcome.evidenceIds])].slice(0, 80);
    finish(entry, outcome.emptyResult || outcome.error || `${outcome.evidenceIds.length} verified evidence records collected`, outcome.evidenceIds);
    if (outcome.status === "failed") { entry.status = "failed"; entry.error = outcome.error; }
    await linkEvidenceToInvestigation(db, job.businessId, job.investigationId, outcome.evidenceIds, now());
    await saveJob(db, job);
  }
  if (plan.research && !job.researchDone && job.researchCount < job.budget.maxResearchRounds && (job.sourceCount || 0) < job.budget.maxSources) {
    const entry = step(job, "research", "gemini_grounded_search", plan.research.question); await saveJob(db, job);
    try {
      const result = await durableCall(db, job, `research_${job.round}`, "external_research", { delegation: plan.research.topic, window: job.incidentWindow, cutoff: job.cutoff }, () => services.research(plan.research!, job.incidentWindow, job.cutoff), 2000,
        digest({ task: "external_research", version: PROMPT_VERSION, promptTemplate: "publicResearchPrompt", topic: plan.research.topic, geography: plan.research.geography }));
      const candidates = result.candidates.slice(0, job.budget.maxSources - (job.sourceCount || 0));
      job.sourceCount = (job.sourceCount || 0) + candidates.length; await saveJob(db, job);
      const sources: ExternalSourceT[] = [];
      // Batches of at most three independent URL retrievals, eight candidate pages in total.
      for (let i = 0; i < candidates.length; i += 3) sources.push(...await Promise.all(candidates.slice(i, i + 3).map((c) => services.verifySource(c, jobScope(job), job.incidentWindow, job.cutoff))));
      const reviewable = sources.filter((s) => s.excerptMatched && s.temporalValidity === "within_cutoff");
      if (reviewable.length) {
        try {
          const input = reviewable.map((s) => ({ sourceId: s.sourceId, claim: s.proposedClaim, actualPassage: s.excerpt, publisherHost: s.publisher }));
          const assessment = await durableModelCall(db, job, `source_review_${job.round}`, SOURCE_TASK, sourceTaskRequest(providerConfig().investigatorModel, input), services);
          const reviewed = SourceAssessments.parse(assessment.value);
          if (new Set(reviewed.assessments.map((a) => a.sourceId)).size !== reviewed.assessments.length || reviewed.assessments.some((a) => !reviewable.some((s) => s.sourceId === a.sourceId))) throw new Error("invalid_source_review_ids");
          for (const verdict of reviewed.assessments) {
            const source = sources.find((s) => s.sourceId === verdict.sourceId)!;
            source.semanticAssessment = "model_only";
            source.claimSupport = verdict.relation;
            source.status = verdict.relation === "contradictory" ? "contradictory" : verdict.relation === "supported" || verdict.relation === "context_only" ? "contextual" : "insufficient_evidence";
            source.limitations.push(`Model semantic assessment: ${verdict.relation}. ${verdict.rationale.slice(0, 1700)}`, "Publication date does not establish event date; real-world causal relevance remains unverified.");
          }
        } catch { for (const source of reviewable) source.limitations.push("Separate model assessment unavailable; source not promoted."); }
      }
      const previous = await db.collection<ExternalSourceT>(COLLECTIONS.externalSources).find(jobScope(job), { projection: { _id: 0 } }).toArray();
      for (const source of deduplicateSources([...previous, ...sources])) await db.collection<ExternalSourceT>(COLLECTIONS.externalSources).replaceOne({ ...jobScope(job), sourceId: source.sourceId }, source, { upsert: true });
      job.sourceIds = [...new Set([...job.sourceIds, ...sources.map((s) => s.sourceId)])];
      finish(entry, `${sources.length} sources checked; ${result.groundingPresent ? "grounding returned" : "no grounding metadata"}. ${result.limitations.join(" ")}`);
    } catch (e) { entry.status = "failed"; entry.completedAt = now(); entry.error = e instanceof ProviderError ? e.code : "research_unavailable"; entry.resultSummary = "External research unavailable; no external claim accepted."; }
    job.researchCount++; job.researchDone = true; await saveJob(db, job);
  }
}
function unknownDiagnosis(reason: string): DiagnosisModelOutputT {
  return { primaryCause: "unknown", hypotheses: [{ cause: "unknown", strength: "weak", evidenceIds: [], counterEvidenceIds: [], explanation: "The available evidence does not justify a reliable causal conclusion." }], summary: "Insufficient evidence for a reliable diagnosis. Review the recorded observations and investigation limitations.", missingEvidence: [reason.replace(/\d/g, "").slice(0, 1000) || "Additional verified evidence"], requiresReview: true };
}

async function publish(db: Db, job: JobDoc, diagnosis: ReturnType<typeof Diagnosis.parse>, report: ReturnType<typeof composeReport>, providerFailure: string | null) {
  const session = db.client.startSession();
  try {
    await session.withTransaction(async () => {
      const completeAt = now();
      const res = await db.collection<JobDoc>(COLLECTIONS.investigationJobs).updateOne({ jobId: job.jobId, leaseToken: job.leaseToken, status: "running", leaseUntil: { $gt: new Date() } }, { $set: { status: providerFailure ? "failed" : diagnosis.primaryCause === "unknown" ? "insufficient_evidence" : "completed", stage: providerFailure ? "failed" : "completed", error: providerFailure, reportId: report.reportId, completedAt: completeAt, updatedAt: completeAt, steps: job.steps, leaseToken: null, leaseUntil: null } }, { session });
      if (res.matchedCount !== 1) throw new Error("lease_lost_or_cancelled");
      await db.collection(COLLECTIONS.diagnoses).replaceOne({ businessId: job.businessId, diagnosisId: diagnosis.diagnosisId }, { ...diagnosis, simulationRunId: job.simulationRunId }, { upsert: true, session });
      await db.collection(COLLECTIONS.investigationReports).replaceOne({ reportId: report.reportId }, { ...jobScope(job), reportId: report.reportId, report }, { upsert: true, session });
      await db.collection(COLLECTIONS.investigations).updateOne({ ...jobScope(job), status: { $nin: ["closed", "planned"] } }, { $set: { status: "awaiting_review", diagnosisId: diagnosis.diagnosisId, updatedAt: completeAt }, $addToSet: { evidenceIds: { $each: job.evidenceIds } } }, { session });
      await db.collection<CallDoc>(COLLECTIONS.investigationCalls).updateOne({ callId: diagnosis.modelCallId }, { $set: { outputDiagnosisId: diagnosis.diagnosisId, validationStatus: "validated" } }, { session });
    });
  } finally { await session.endSession(); }
}

export async function processInvestigation(db: Db, job: JobDoc, services: Services = defaults): Promise<void> {
  const heartbeat = setInterval(() => { void renewLease(db, job).catch(() => false); }, 20000);
  try {
    const ctx = await loadInvestigationContext(db, job.investigationId, jobScope(job));
    if (!ctx) throw new Error("investigation_not_found");
    // A queued investigation's data cutoff and windows cannot drift as the simulation advances.
    ctx.cutoff = job.cutoff; ctx.incidentWindow = job.incidentWindow; ctx.baselineWindow = job.baselineWindow || undefined;
    ctx.anomalies = ctx.anomalies.filter((a) => a.currentWindow.endAt <= job.cutoff);
    const accountedCalls = await db.collection<CallDoc>(COLLECTIONS.investigationCalls).find({ jobId: job.jobId }).toArray();
    job.actualTokens = accountedCalls.reduce((n, c) => n + (c.metadata?.totalTokens || 0), 0);
    job.estimatedCostUsd = accountedCalls.reduce((n, c) => n + (c.metadata?.estimatedCostUsd || 0), 0);
    if (!job.startedAt) { job.startedAt = now(); job.deadline = Date.now() + job.budget.maxWallMs; finish(step(job, "context", "canonical_context", "Load scoped incident observations"), "Context loaded from canonical observations; hidden simulation controls excluded."); await saveJob(db, job); }
    let packet = await loadVerifiedEvidence(db, jobScope(job), job.evidenceIds, job.cutoff);
    let sources = await db.collection<ExternalSourceT>(COLLECTIONS.externalSources).find(jobScope(job), { projection: { _id: 0 } }).toArray();
    const config = providerConfig();
    let reasoningProviderFailure: string | null = null;
    try {
      while (job.round < job.budget.maxRounds && !job.stopReason) {
        if (!job.plan) {
          const input = contextPacket(ctx, packet, job, sources);
          const entry = step(job, "reasoning", config.investigatorModel, "Compare hypotheses and choose discriminating evidence"); await saveJob(db, job);
          let plan: ReturnType<typeof ReasoningOutput.parse> | null = null;
          let validationError: string | null = null;
          for (let repairAttempt = 0; repairAttempt < 2 && !plan; repairAttempt++) {
            const key = `reasoning_${job.round}${repairAttempt ? "_repair" : ""}`;
            const requestInput = { ...input, validationRepair: validationError };
            try {
              const result = await durableModelCall(db, job, key, "normal.investigation.v1", { model: config.investigatorModel, system: INVESTIGATOR_SYSTEM, input: requestInput, schema: ReasoningOutput, schemaName: "investigation_decision", sessionId: job.jobId }, services);
              const candidate = ReasoningOutput.parse(result.value);
              if (new Set(candidate.hypotheses.map((h) => h.cause)).size !== candidate.hypotheses.length) throw new Error("Hypotheses must have distinct cause codes and mechanisms");
              for (const h of candidate.hypotheses) {
                validateReferences(h.evidenceIds, packet.evidence); validateReferences(h.counterEvidenceIds, packet.evidence);
                if (h.evidenceIds.some((id) => h.counterEvidenceIds.includes(id))) throw new Error("ambiguous_evidence_role");
                if (["strongly_supported", "moderately_supported"].includes(h.support) && !h.evidenceIds.length) throw new Error("Supported hypotheses need verified evidence IDs");
                for (const prose of [h.explanation, h.mechanism, h.chronology, h.controlComparison, ...h.confounders, ...h.expectedObservations, ...h.missingEvidence, ...h.falsificationTests]) rejectNumericalProse(prose);
              }
              for (const previous of job.hypotheses.at(-1)?.hypotheses || []) {
                if (previous.counterEvidenceIds.some((id) => !candidate.hypotheses.find((h) => h.cause === previous.cause)?.counterEvidenceIds.includes(id))) throw new Error("missing_contradiction_disclosure");
              }
              plan = candidate;
              await db.collection<CallDoc>(COLLECTIONS.investigationCalls).updateOne({ callId: `${job.jobId}_${key}` }, { $set: { validationStatus: "validated" } });
            } catch (e) {
              if (e instanceof ProviderError && e.code !== "invalid_structured_output") {
                await db.collection<CallDoc>(COLLECTIONS.investigationCalls).updateOne({ callId: `${job.jobId}_${key}` }, { $set: { validationStatus: "provider_failed", correctionId: null } });
                throw e;
              }
              if (e instanceof BudgetError || String(e).includes("lease_lost_or_cancelled")) throw e;
              validationError = e instanceof Error ? e.message.slice(0, 200) : "Invalid structured investigation decision";
              await db.collection<CallDoc>(COLLECTIONS.investigationCalls).updateOne({ callId: `${job.jobId}_${key}` }, { $set: { validationStatus: "rejected", correctionId: repairAttempt === 0 ? `${job.jobId}_reasoning_${job.round}_repair` : null } });
            }
          }
          if (!plan) throw new Error("Investigation decision rejected after bounded repair");
          const revision = HypothesisSet.parse({ schemaVersion: 1, revision: job.round + 1, createdAt: now(), hypotheses: plan.hypotheses.map((h) => ({ ...h, hypothesisId: `hyp_${digest([job.jobId, h.cause]).slice(0, 16)}` })), decisionSummary: plan.decisionSummary });
          job.hypotheses.push(revision); job.plan = plan; job.researchDone = false;
          finish(entry, plan.decisionSummary); await saveJob(db, job);
        }
        if (job.plan.stop && job.round > 0) { job.stopReason = job.plan.stopReason; break; }
        const before = job.toolCount;
        await executePlan(db, job, ctx, services);
        packet = await loadVerifiedEvidence(db, jobScope(job), job.evidenceIds, job.cutoff);
        sources = await db.collection<ExternalSourceT>(COLLECTIONS.externalSources).find(jobScope(job), { projection: { _id: 0 } }).toArray();
        job.round++; job.plan = null; await saveJob(db, job);
        if (before === job.toolCount && !job.researchDone) { job.stopReason = "Relevant selected tools exhausted"; break; }
      }
    } catch (e) {
      if (String(e).includes("lease_lost_or_cancelled")) throw e;
      if (e instanceof ProviderError) reasoningProviderFailure = e.code;
      job.stopReason = e instanceof BudgetError ? e.message : e instanceof ProviderError ? `Provider unavailable: ${e.code}` : "Investigation output failed validation";
      const active = job.steps.at(-1); if (active?.status === "running") Object.assign(active, { status: "failed", completedAt: now(), error: job.stopReason });
    }
    const limited = /budget|Provider unavailable|failed validation/i.test(job.stopReason || "") || (job.round >= job.budget.maxRounds && !job.stopReason);
    if (!job.stopReason && job.round >= job.budget.maxRounds) job.stopReason = "Reasoning round budget reached";
    await saveJob(db, job);
    packet = await loadVerifiedEvidence(db, jobScope(job), job.evidenceIds, job.cutoff);
    let output: DiagnosisModelOutputT | null = null, finalCallId = `${job.jobId}_system_insufficient`;
    let repair: string | null = null, diagnosisProviderFailure: string | null = null;
    const entry = step(job, "diagnosis", config.diagnosisModel, "Synthesize qualified diagnosis against verified evidence"); await saveJob(db, job);
    for (let attempt = 0; attempt < 2 && !output; attempt++) {
      const input = { ...contextPacket(ctx, packet, job, sources), limited, stopReason: job.stopReason, validationRepair: repair };
      try {
        const result = await durableModelCall(db, job, `diagnosis_${attempt}`, DIAGNOSIS_TASK, { model: config.diagnosisModel, system: DIAGNOSIS_SYSTEM, input, schema: DiagnosisModelOutput, schemaName: "root_cause_diagnosis", sessionId: job.jobId }, services);
        const candidate = validateDiagnosis(result.value, packet.evidence, job.hypotheses, limited);
        output = candidate; finalCallId = `${job.jobId}_diagnosis_${attempt}`;
      } catch (e) {
        if (String(e).includes("lease_lost_or_cancelled")) throw e;
        repair = e instanceof ProviderError ? e.code : e instanceof Error ? e.message : "invalid_output";
        if (e instanceof ProviderError && e.code !== "invalid_structured_output") diagnosisProviderFailure = e.code;
        await db.collection<CallDoc>(COLLECTIONS.investigationCalls).updateOne({ callId: `${job.jobId}_diagnosis_${attempt}` }, { $set: { validationStatus: e instanceof ProviderError && e.code !== "invalid_structured_output" ? "provider_failed" : "rejected", correctionId: attempt === 0 && !(e instanceof ProviderError) ? `${job.jobId}_diagnosis_1` : null } });
        if (e instanceof ProviderError || e instanceof BudgetError) break;
      }
    }
    if (!output) {
      if (diagnosisProviderFailure) job.stopReason = `Provider unavailable: ${diagnosisProviderFailure}`;
      output = unknownDiagnosis(repair || job.stopReason || "Additional evidence needed");
      await db.collection<CallDoc>(COLLECTIONS.investigationCalls).updateOne({ callId: finalCallId }, { $setOnInsert: { ...jobScope(job), callId: finalCallId, jobId: job.jobId, task: "system.insufficient_evidence", promptVersion: PROMPT_VERSION, checksum: digest({ reason: repair || job.stopReason }), status: "failed", startedAt: now(), completedAt: now(), metadata: null, result: null, error: "No accepted model diagnosis; deterministic fallback", ambiguous: false, reservedTokens: 0, outputDiagnosisId: null, validationStatus: "deterministic_fallback", correctionId: null, adapterVersion: null } }, { upsert: true });
      // Preserve known contradictory hypotheses even in the deterministic insufficient-evidence fallback.
      output.hypotheses.push(...fallbackHypotheses(job.hypotheses, packet.evidence));
      output = validateDiagnosis(output, packet.evidence, [], true);
      entry.error = diagnosisProviderFailure ? `Provider unavailable: ${diagnosisProviderFailure}; deterministic fallback report` : "Model diagnosis unavailable or rejected; deterministic insufficient-evidence report";
    }
    finish(entry, output.summary);
    const diagnosis = Diagnosis.parse({ ...output, schemaVersion: 1, ...{ businessId: job.businessId, investigationId: job.investigationId }, diagnosisId: `diag_${job.jobId}`, modelCallId: finalCallId, taskKey: "revenue_diagnosis_v1", createdAt: now() });
    finish(step(job, "validation", "deterministic_validator", "Validate references, scope, calculations and contradictions"), "Validation passed; semantic support remains a model assessment.");
    finish(step(job, "report", "report_composer_v1", "Create consistent report, brief and read-only handoff"), "Report composed from the single validated diagnosis.");
    const report = composeReport(stateView(job), diagnosis, packet.evidence, sources, job.affected);
    const providerFailure = diagnosisProviderFailure ? `Provider unavailable during diagnosis: ${diagnosisProviderFailure}; no accepted model diagnosis`
      : output.primaryCause === "unknown" && reasoningProviderFailure ? `Provider unavailable during reasoning: ${reasoningProviderFailure}; final diagnosis remained unknown` : null;
    await saveJob(db, job); await publish(db, job, diagnosis, report, providerFailure);
  } catch (e) {
    await db.collection<JobDoc>(COLLECTIONS.investigationJobs).updateOne({ jobId: job.jobId, leaseToken: job.leaseToken, status: "running", leaseUntil: { $gt: new Date() } }, { $set: { status: "failed", stage: "failed", completedAt: now(), updatedAt: now(), error: e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : "Investigation failed; inspect persisted steps", leaseToken: null, leaseUntil: null } });
  } finally { clearInterval(heartbeat); }
}
export async function runNextInvestigation(db: Db, scope?: ScopeT, services?: Services): Promise<boolean> {
  const job = await claimInvestigation(db, scope); if (!job) return false;
  await processInvestigation(db, job, services); return true;
}
