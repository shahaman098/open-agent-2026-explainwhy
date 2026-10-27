import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callGeminiResearch, callModel, gatewayRequest, jsonSchema, providerConfig, ProviderError, promptFingerprint } from "@/intelligence/investigator/provider";

const schema = z.object({ ok: z.boolean() }).strict();
const nvidiaResponse = (content: unknown = { ok: true }, headers: Record<string, string> = { "nvcf-reqid": "nvidia_req_1" }) => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }), { status: 200, headers });

beforeEach(() => {
  vi.stubEnv("NVIDIA_API_KEY", "nvapi_test");
  vi.stubEnv("GEMINI_API_KEY", "google_test");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("provider boundaries", () => {
  it("defaults every configured stage to Nemotron 3 Super", () => {
    for (const key of ["NEMOTRON_INVESTIGATOR_MODEL", "NEMOTRON_DIAGNOSIS_MODEL", "NEMOTRON_PLANNER_MODEL"]) vi.stubEnv(key, "");
    expect(providerConfig()).toMatchObject({ provider: "nvidia", investigatorModel: "nvidia/nemotron-3-super-120b-a12b" });
  });
  it("parses structured NVIDIA output with local Zod validation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nvidiaResponse()));
    const result = await callModel({ model: providerConfig().investigatorModel, system: "s", input: {}, schema });
    expect(result.value).toEqual({ ok: true });
    expect(result.metadata.provider).toBe("nvidia");
    expect(result.metadata.requestId).toBe("nvidia_req_1");
  });
  it("assigns a local request id when the provider omits one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nvidiaResponse({ ok: true }, {})));
    const result = await callModel({ model: "nvidia/test", system: "s", input: {}, schema });
    expect(result.metadata.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("keeps task fingerprints stable across recording modes", () => {
    const request = { model: "test", system: "stable", input: { sample: "heldout" }, schema };
    expect(promptFingerprint({ ...request, recording: "metadata" }, "source", "1")).toBe(promptFingerprint({ ...request, recording: "full" }, "source", "1"));
  });
  it("requires NVIDIA credentials and rejects unsafe base URLs", () => {
    vi.stubEnv("NVIDIA_API_KEY", "");
    expect(providerConfig).toThrow("missing_nvidia_key");
    vi.stubEnv("NVIDIA_API_KEY", "nvapi_test");
    vi.stubEnv("NVIDIA_BASE_URL", "http://localhost/key");
    expect(providerConfig).toThrow("invalid_base_url");
  });
  it("validates function names and parses structured arguments", async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "call_actual", function: { name: "read", arguments: '{"ok":true}' } }] } }] }), { headers: { "nvcf-reqid": "mreq_tool" } }));
    vi.stubGlobal("fetch", mock);
    const result = await callModel({ model: "x", system: "s", input: {}, tools: [{ name: "read", description: "read", parameters: jsonSchema(schema) }] });
    expect(schema.parse(result.toolCalls[0].arguments)).toEqual({ ok: true });
  });
  it("routes grounded research through direct Gemini", async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "ok" }] } }], usageMetadata: { totalTokenCount: 5 } }), { status: 200 }));
    vi.stubGlobal("fetch", mock);
    const r = await callGeminiResearch({ contents: [{ role: "user", parts: [{ text: "ping" }] }] });
    expect(r.metadata.provider).toBe("google_direct");
    expect(String(mock.mock.calls[0][0])).toContain("generativelanguage.googleapis.com");
  });
  it("does not enable direct Gemini without a key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(callGeminiResearch({ contents: [] })).rejects.toMatchObject({ code: "missing_gemini_key" });
  });
  it("classifies rate limiting without an automatic chargeable retry", async () => {
    const mock = vi.fn().mockResolvedValue(new Response("{}", { status: 429, headers: { "retry-after": "2" } }));
    vi.stubGlobal("fetch", mock);
    await expect(callModel({ model: "x", system: "s", input: {} })).rejects.toMatchObject({ retryable: true, retryAfterMs: 2000 });
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it.each([{ nope: true }, { ok: "yes" }])("rejects invalid structured output %j", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nvidiaResponse(body)));
    await expect(callModel({ model: "test", system: "s", input: {}, schema })).rejects.toMatchObject({ code: "invalid_structured_output" });
  });
});
