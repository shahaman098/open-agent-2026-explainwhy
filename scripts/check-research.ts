import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { providerConfig, gatewayRequest, ProviderError } from "../src/intelligence/investigator/provider";
import { research, verifyExternalSource } from "../src/intelligence/investigator/research";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.NORMAL_PROVIDER_DIAGNOSTICS = "true";
async function main() {
  const c = providerConfig(), direct = process.argv.includes("--direct");
  if (process.argv.includes("--production-path")) {
    process.env.NORMAL_EXTERNAL_RESEARCH_ENABLED = "true";
    const scope = { businessId: "nike_eval", simulationRunId: `research_${Date.now()}`, investigationId: "production_research_check" };
    const window = { startAt: "2026-10-04T06:00:00.000Z", endAt: "2026-10-05T12:00:00.000Z" }, cutoff = window.endAt;
    const result = await research({ topic: "advertising_platform_disruption", question: "Did an official platform status notice report a disruption?", rationale: "Public context only", geography: "global", hypotheses: ["unknown"], sourceTypes: ["official_status"] }, window, cutoff);
    const sources = [];
    for (const candidate of result.candidates.slice(0, 3)) sources.push(await verifyExternalSource(candidate, scope, window, cutoff));
    const audit = { ...scope, metadata: result.metadata, groundingPresent: result.groundingPresent, queries: result.queries, candidateCount: result.candidates.length, limitations: result.limitations, sources };
    mkdirSync("docs/stage5-runs", { recursive: true });
    writeFileSync(`docs/stage5-runs/${scope.simulationRunId}.json`, JSON.stringify(audit, null, 2));
    console.log(JSON.stringify({ ...scope, requestId: result.metadata.requestId, groundingPresent: result.groundingPresent, queries: result.queries, candidateCount: result.candidates.length, sourceStatuses: sources.map((s) => s.status), limitations: result.limitations }));
    return;
  }
  if (direct) process.env.NORMAL_DIRECT_GEMINI_FALLBACK = "true";
  const route = `${direct ? "https://generativelanguage.googleapis.com" : c.geminiBase}/v1beta/models/${encodeURIComponent(c.researchModel)}:generateContent`;
  const r = await gatewayRequest(route, { contents: [{ role: "user", parts: [{ text: "Use Google Search to find the official Google Search status dashboard. Return its URL with one short finding." }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: 1500, thinkingConfig: { thinkingLevel: "low" } } }, direct ? "google_direct" : "mubit", c.researchModel);
  const candidates = r.body.candidates as Array<{ groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>; webSearchQueries?: string[]; groundingSupports?: Array<{ segment?: { text?: string }; groundingChunkIndices?: number[] }> } }> | undefined;
  const grounding = candidates?.[0]?.groundingMetadata;
  const cutoff = new Date().toISOString(), scope = { businessId: "nike_eval", simulationRunId: `research_${Date.now()}`, investigationId: "connectivity_source_check" };
  const window = { startAt: "2026-10-01T00:00:00.000Z", endAt: cutoff };
  const sources = [];
  for (const [index, chunk] of (grounding?.groundingChunks || []).slice(0, 3).entries()) {
    if (!chunk.web?.uri) continue;
    const claim = grounding?.groundingSupports?.filter((s) => s.groundingChunkIndices?.includes(index)).map((s) => s.segment?.text || "").join(" ") || chunk.web.title || "Search source candidate";
    sources.push(await verifyExternalSource({ url: chunk.web.uri, claim: claim.slice(0, 2000), excerpt: "" }, scope, window, cutoff));
  }
  const result = { ...r.metadata, groundingPresent: Boolean(grounding), queries: grounding?.webSearchQueries || [], sources,
    limitation: "Search discovery, independent retrieval, timing and claim support are separate checks. No source is promoted on grounding alone." };
  mkdirSync("docs/stage5-runs", { recursive: true });
  writeFileSync(`docs/stage5-runs/${scope.simulationRunId}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
main().catch((e: unknown) => { console.error(e instanceof ProviderError ? JSON.stringify({ code: e.code, ...e.metadata }) : String(e)); process.exitCode = 1; });
