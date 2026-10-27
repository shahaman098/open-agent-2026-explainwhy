import { existsSync } from "node:fs";
import { z } from "zod";
import { callGeminiResearch, callModel, jsonSchema, providerConfig, ProviderError } from "../src/intelligence/investigator/provider";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
async function main() {
  const c = providerConfig();
  const schema = z.object({ ok: z.boolean() }).strict();
  const result = await callModel({ model: c.investigatorModel, system: "Return the requested connectivity acknowledgement.", input: "Return ok true.", schema, schemaName: "connectivity", maxOutputTokens: 2048, recording: "metadata" });
  console.log(JSON.stringify({ check: "structured_output", value: result.value, ...result.metadata }));
  const tool = await callModel({ model: c.investigatorModel, system: "Call acknowledge with ok true.", input: "Check tool calling.", tools: [{ name: "acknowledge", description: "Acknowledge connectivity", parameters: jsonSchema(schema) }], forceTool: "acknowledge", maxOutputTokens: 2048, recording: "metadata" });
  if (tool.toolCalls.length !== 1) throw new Error("Expected one tool call");
  schema.parse(tool.toolCalls[0].arguments);
  console.log(JSON.stringify({ check: "function_call", calls: tool.toolCalls, ...tool.metadata }));
  try { await callModel({ model: "explainwhy-invalid-connectivity-model", system: "Reply ok.", input: "ok", maxOutputTokens: 16 }); throw new Error("Invalid model unexpectedly succeeded"); }
  catch (error) { if (!(error instanceof ProviderError)) throw error; console.log(JSON.stringify({ check: "invalid_model", code: error.code, ...error.metadata })); }
  if (process.argv.includes("--research")) {
    const result = await callGeminiResearch({ contents: [{ role: "user", parts: [{ text: "Reply with one sentence: connectivity check only, no search." }] }], generationConfig: { maxOutputTokens: 256 } });
    console.log(JSON.stringify({ check: "gemini_research_route", ...result.metadata, hasCandidates: Boolean((result.body.candidates as unknown[])?.length) }));
  }
}
main().catch((e: unknown) => { console.error(e instanceof ProviderError ? JSON.stringify({ code: e.code, metadata: e.metadata }) : String(e)); process.exitCode = 1; });
