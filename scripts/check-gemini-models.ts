import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DiagnosisModelOutput } from "@normal/contracts";
import { ReasoningOutput } from "../src/intelligence/investigator/schemas";
import { callModel, providerConfig, ProviderError } from "../src/intelligence/investigator/provider";
import { PlanningOutput } from "../src/planner/schemas";
import { PLANNER_SYSTEM } from "../src/planner/service";
import { INVESTIGATOR_SYSTEM } from "../src/intelligence/investigator/prompts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
async function main() {
  const config = providerConfig();
  const models = { investigator: config.investigatorModel, diagnosis: config.diagnosisModel, planner: config.plannerModel, research: config.researchModel };
  if (Object.values(models).some((model) => model !== "gemini-4-argon")) throw new Error("Expected Gemini 4 Argon for all configured stages");
  const checks = [
    { name: "investigation_schema", model: config.investigatorModel, schema: ReasoningOutput, system: INVESTIGATOR_SYSTEM, input: { incident: { title: "Synthetic schema probe: a revenue observation needs investigation" }, evidence: [], evidenceLimitations: ["No supporting observations available: hypotheses must remain insufficient or tentative."], tools: [], researchEnabled: false, roundsRemaining: 0, instruction: "Return at least two distinct competing cause codes as unconfirmed hypotheses, with falsification checks. Use empty evidence arrays; no tools or external research are available. Stop with an insufficient-evidence explanation." } },
    { name: "diagnosis_schema", model: config.diagnosisModel, schema: DiagnosisModelOutput, system: "Synthetic schema-connectivity probe. No evidence is available. Return an unknown-cause, review-required diagnosis with empty evidence arrays. Do not claim an action ran.", input: { evidence: [], hypotheses: [], limitations: ["No operational evidence available"] } },
    { name: "planning_schema", model: config.plannerModel, schema: PlanningOutput, system: PLANNER_SYSTEM, input: { advisoryOnly: true, diagnosis: { primaryCause: "unknown" }, evidence: [{ evidenceId: "evd_schema_probe", observation: "Synthetic test fixture: operational measurements are unavailable." }], availableCapabilities: [] } },
  ];
  const outputPath = `docs/model-configuration/gemini-schemas-${Date.now()}.json`;
  const results: unknown[] = [];
  mkdirSync("docs/model-configuration", { recursive: true });
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
  for (const check of checks) {
    if (only && check.name !== only) continue;
    try {
      const result = await callModel({ ...check, schemaName: check.name, maxOutputTokens: 8000, recording: "metadata" });
      results.push({ check: check.name, passed: true, metadata: result.metadata, value: result.value });
      console.log(JSON.stringify({ check: check.name, passed: true, ...result.metadata }));
    } catch (error) {
      results.push({ check: check.name, passed: false, code: error instanceof ProviderError ? error.code : "probe_failed", details: error instanceof ProviderError ? error.details : null, metadata: error instanceof ProviderError ? error.metadata : null });
      process.exitCode = 1;
    }
    writeFileSync(outputPath, JSON.stringify({ observedAt: new Date().toISOString(), models, scope: "Synthetic schema probes, not business diagnosis or accuracy evaluation. No live business records changed.", results }, null, 2) + "\n");
  }
  console.log(JSON.stringify({ outputPath }));
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "probe_failed"); process.exitCode = 1; });
