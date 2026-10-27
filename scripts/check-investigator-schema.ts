import { existsSync } from "node:fs";
import { DiagnosisModelOutput } from "@normal/contracts";
import { callModel, providerConfig, ProviderError } from "../src/intelligence/investigator/provider";
import { ReasoningOutput } from "../src/intelligence/investigator/schemas";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.NORMAL_PROVIDER_DIAGNOSTICS = "true";
async function main() {
  for (const [name, schema] of [["investigation_decision", ReasoningOutput], ["root_cause_diagnosis", DiagnosisModelOutput]] as const) {
    try { const r = await callModel({ model: providerConfig().investigatorModel, system: "No evidence is available. Return an appropriately uncertain structured result. Use empty arrays for evidence IDs.", input: "No operational evidence", schema, schemaName: name, sessionId: "normal_schema_check", maxOutputTokens: 6000 }); console.log(JSON.stringify({ check: name, value: r.value, ...r.metadata })); }
    catch (e) { console.error(e instanceof ProviderError ? JSON.stringify({ check: name, code: e.code, metadata: e.metadata }) : String(e)); }
  }
}
main();
