import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Diagnosis, type DiagnosisModelOutputT, type EvidenceT } from "@explainwhy/contracts";
import { nemotronStatus, parseRewardScores, verificationSection, verifyDiagnosis } from "@/integrations/nemotron/verifier";
import { NemotronVerification, type StateT } from "@/intelligence/investigator/schemas";
import { composeReport } from "@/intelligence/investigator/reports";

const ev = (evidenceId: string, title: string): EvidenceT => ({ schemaVersion: 1, businessId: "nike_demo", evidenceId, investigationId: "inv_a", category: "technical", title, observation: `${title} observation`,
  measurements: [{ metric: "conversion_rate", value: 0.015, unit: "ratio", baseline: 0.022 }], sourceRecords: [{ collection: "business_events", recordId: `${evidenceId}_src` }], retrievedAt: "2026-10-08T00:00:00.000Z" } as EvidenceT);
const evidence = [ev("ev_checkout", "Sessions, conversion and checkout failures"), ev("ev_ads", "Campaign comparison"), ev("ev_revenue", "Revenue decomposition")];
const diagnosis: DiagnosisModelOutputT = { primaryCause: "discount_failure", requiresReview: true, summary: "Rejected promo codes are the supported explanation.", missingEvidence: [],
  hypotheses: [
    { cause: "discount_failure", strength: "strong", evidenceIds: ["ev_checkout", "ev_revenue"], counterEvidenceIds: [], explanation: "Promo codes are rejected at checkout across channels." },
    { cause: "ad_fatigue", strength: "weak", evidenceIds: ["ev_ads"], counterEvidenceIds: ["ev_revenue"], explanation: "One campaign fatigued at the same time but sessions barely moved." },
  ] };
const judge = (body: unknown) => Response.json({ choices: [{ message: { content: typeof body === "string" ? body : JSON.stringify(body) } }], usage: { prompt_tokens: 900, completion_tokens: 120 } }, { headers: { "nvcf-reqid": "req_judge" } });
const reward = (correctness: number) => Response.json({ choices: [{ message: { content: `helpfulness:3.1,correctness:${correctness},coherence:3.6,complexity:1.2,verbosity:1.0` } }] }, { headers: { "nvcf-reqid": `req_reward_${correctness}` } });
const goodJudge = { bestSupportedCause: "discount_failure", assessments: [
  { cause: "discount_failure", verdict: "consistent", supportingEvidenceIds: ["ev_checkout"], contradictingEvidenceIds: [], rationale: "Rejected promo codes dominate failures and conversion fell in paid and non-paid traffic alike." },
  { cause: "ad_fatigue", verdict: "contradicted", supportingEvidenceIds: ["ev_ads"], contradictingEvidenceIds: ["ev_revenue"], rationale: "The fatigued campaign is real, but the revenue loss comes from conversion rather than sessions." },
] };

beforeEach(() => { vi.stubEnv("NVIDIA_API_KEY", "nvapi-test-do-not-log"); vi.stubEnv("EXPLAINWHY_NEMOTRON_VERIFIER", "true"); });
afterEach(() => vi.unstubAllEnvs());

describe("Nemotron independent verification", () => {
  it("is off unless explicitly enabled with a key", () => {
    expect(nemotronStatus()).toEqual({ enabled: true, configured: true });
    vi.stubEnv("NVIDIA_API_KEY", "");
    expect(nemotronStatus().configured).toBe(false);
    vi.stubEnv("NVIDIA_API_KEY", "nvapi-x"); vi.stubEnv("EXPLAINWHY_NEMOTRON_VERIFIER", "false");
    expect(nemotronStatus().configured).toBe(false);
  });

  it("records agreement, the rejected decoy, reward ranking and receipts without leaking the key", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(judge(`Here is my audit:\n${JSON.stringify(goodJudge)}`)).mockResolvedValueOnce(reward(3.4)).mockResolvedValueOnce(reward(1.2));
    const v = await verifyDiagnosis(diagnosis, evidence, transport);
    expect(NemotronVerification.parse(v)).toBeTruthy();
    expect(v).toMatchObject({ status: "completed", agreement: "agrees", bestSupportedCause: "discount_failure", challengedCauses: [], rewardTopCause: "discount_failure" });
    expect(v.assessments.find((a) => a.cause === "ad_fatigue")?.verdict).toBe("contradicted");
    expect(v.receipts.map((r) => [r.task, r.status, r.requestId])).toEqual([["judge", "completed", "req_judge"], ["reward", "completed", "req_reward_3.4"], ["reward", "completed", "req_reward_1.2"]]);
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    const judgeBody = JSON.parse(String(init?.body));
    expect(judgeBody.model).toBe("nvidia/llama-3.1-nemotron-70b-instruct");
    // Blind judge: candidate causes and evidence only, never the diagnosis's conclusion or prose.
    const judgeInput = JSON.parse(judgeBody.messages[1].content);
    expect(Object.keys(judgeInput).sort()).toEqual(["candidateCauses", "evidence"]);
    expect(judgeInput.candidateCauses).toEqual(["discount_failure", "ad_fatigue"]);
    expect(judgeBody.messages[1].content).not.toMatch(/primaryCause|strength|Promo codes are rejected/);
    // Reward calls carry only the evidence the scored explanation cites.
    expect(JSON.parse(String(transport.mock.calls[2][1]?.body)).messages[0].content).not.toContain("ev_checkout");
    expect(JSON.parse(String(transport.mock.calls[1][1]?.body))).toEqual({ model: "nvidia/nemotron-4-340b-reward", messages: expect.any(Array) });
    expect(JSON.stringify(v)).not.toContain("nvapi-test-do-not-log");
    const section = verificationSection(v);
    expect(section.text).toContain("agrees with the primary explanation");
    expect(section.evidenceIds).toEqual(expect.arrayContaining(["ev_checkout", "ev_ads", "ev_revenue"]));
  });

  it("flags disagreement when the judge backs a cause the diagnosis rated weak", async () => {
    const backsDecoy = { bestSupportedCause: "ad_fatigue", assessments: [
      { ...goodJudge.assessments[0], verdict: "insufficient" }, { ...goodJudge.assessments[1], verdict: "consistent", contradictingEvidenceIds: [] },
    ] };
    vi.stubEnv("NEMOTRON_REWARD_MODEL", "off");
    const v = await verifyDiagnosis(diagnosis, evidence, vi.fn<typeof fetch>().mockResolvedValueOnce(judge(backsDecoy)));
    expect(v).toMatchObject({ agreement: "disagrees", bestSupportedCause: "ad_fatigue", rewardModel: null, status: "completed" });
    expect(v.challengedCauses).toEqual(expect.arrayContaining(["ad_fatigue", "discount_failure"]));
    expect(verificationSection(v).text).toContain("Review before acting");
  });

  it("rejects invented evidence and numeric prose, repairs once, then reports failure honestly", async () => {
    vi.stubEnv("NEMOTRON_REWARD_MODEL", "off");
    const invented = { ...goodJudge, assessments: [{ ...goodJudge.assessments[0], supportingEvidenceIds: ["ev_made_up"] }, goodJudge.assessments[1]] };
    const numeric = { ...goodJudge, assessments: [{ ...goodJudge.assessments[0], rationale: "Conversion fell by 30%." }, goodJudge.assessments[1]] };
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(judge(invented)).mockResolvedValueOnce(judge(numeric));
    const v = await verifyDiagnosis(diagnosis, evidence, transport);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(JSON.parse(JSON.parse(String(transport.mock.calls[1][1]?.body)).messages[1].content).validationRepair).toBe("unknown_evidence_reference");
    expect(v).toMatchObject({ status: "failed", agreement: "not_assessed", assessments: [] });
    expect(v.receipts.map((r) => r.error)).toEqual(["unknown_evidence_reference", "unsupported_numerical_prose"]);
  });

  it("keeps a failed provider call as a receipt instead of throwing", async () => {
    const v = await verifyDiagnosis(diagnosis, evidence, vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 503, headers: { "nvcf-reqid": "req_down" } })));
    expect(v.status).toBe("failed");
    expect(v.receipts[0]).toMatchObject({ task: "judge", status: "failed", error: "nvidia_http_503", requestId: "req_down" });
  });

  it("parses reward attributes from text or logprob tokens", () => {
    expect(parseRewardScores("helpfulness:2.5,correctness:-0.75,coherence:3", [])).toEqual({ correctness: -0.75, helpfulness: 2.5 });
    expect(parseRewardScores("", [{ token: "helpfulness", logprob: 1.5 }, { token: "correctness", logprob: 2.25 }])).toEqual({ correctness: 2.25, helpfulness: 1.5 });
    expect(parseRewardScores("no scores", [])).toBeNull();
  });

  it("publishes the verification in the report and puts a disagreement first in review notes", async () => {
    vi.stubEnv("NEMOTRON_REWARD_MODEL", "off");
    const disagree = await verifyDiagnosis(diagnosis, evidence, vi.fn<typeof fetch>().mockResolvedValueOnce(judge({ bestSupportedCause: "ad_fatigue", assessments: [{ ...goodJudge.assessments[0], verdict: "insufficient" }, { ...goodJudge.assessments[1], verdict: "consistent", contradictingEvidenceIds: [] }] })));
    const d = Diagnosis.parse({ ...diagnosis, schemaVersion: 1, businessId: "nike_demo", investigationId: "inv_a", diagnosisId: "diag_a", modelCallId: "call_a", taskKey: "revenue_diagnosis_v1", createdAt: "2026-10-08T00:00:00Z" });
    const state = { jobId: "job_a", investigationId: "inv_a", businessId: "nike_demo", simulationRunId: "run_a", hypotheses: [], steps: [], stopReason: null, researchCount: 0 } as unknown as StateT;
    const report = composeReport(state, d, evidence, [], [], disagree);
    expect(report.independentVerification?.agreement).toBe("disagrees");
    expect(report.executiveBrief.review[0]).toContain("Nemotron verification disagrees");
    expect(report.sections.map((x) => x.title)).toContain("Independent Nemotron verification");
    const plain = composeReport(state, d, evidence, [], []);
    expect(plain.independentVerification).toBeUndefined();
    expect(plain.sections.map((x) => x.title)).not.toContain("Independent Nemotron verification");
  });
});
