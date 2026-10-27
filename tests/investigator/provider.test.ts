import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callModel, promptFingerprint, gatewayRequest, jsonSchema, providerConfig, ProviderError } from "@/intelligence/investigator/provider";
const schema = z.object({ ok: z.boolean() }).strict();
const response = (content: unknown = { ok: true }, headers: Record<string, string> = { "x-middleware-request-id": "mreq_real" }) => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }), { status: 200, headers });
beforeEach(() => { vi.stubEnv("MUBIT_GEMINI_TRANSPORT", "native"); vi.stubEnv("MUBIT_API_KEY", "mbt_test"); vi.stubEnv("GEMINI_API_KEY", "google_test"); vi.stubEnv("NORMAL_DIRECT_GEMINI_FALLBACK", "false"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("provider boundaries", () => {
  it("captures Gemini training through its own OpenAI-compatible endpoint with strict local validation", async () => {
    vi.stubEnv("MUBIT_GEMINI_TRANSPORT", "openai");
    vi.stubEnv("NORMAL_INPUT_USD_PER_MILLION", "100");
    vi.stubEnv("NORMAL_OUTPUT_USD_PER_MILLION", "100");
    const mock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", mock);
    const result = await callModel({ model: "gemini-4-argon", system: "s", input: {}, schema, recording: "full" });
    expect(mock.mock.calls[0][0]).toBe("https://api.mubit.ai/gemini/v1beta/openai/chat/completions");
    const init = mock.mock.calls[0][1];
    expect(init.headers).toMatchObject({ authorization: "Bearer mbt_test", "x-middleware-record": "full" });
    expect(JSON.parse(init.body)).toMatchObject({ model: "gemini-4-argon", max_tokens: 6000, reasoning_effort: "low" });
    expect(result.metadata.estimatedCostUsd).toBeNull();
    mock.mockResolvedValue(response({ ok: "invalid" }));
    await expect(callModel({ model: "gemini-4-argon", system: "s", input: {}, schema })).rejects.toMatchObject({ code: "invalid_structured_output" });
  });
  it("rejects a missing forced tool on Gemini's compatible endpoint", async () => {
    vi.stubEnv("MUBIT_GEMINI_TRANSPORT", "openai");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    await expect(callModel({ model: "gemini-4-argon", system: "s", input: {}, tools: [{ name: "read", description: "read", parameters: jsonSchema(schema) }], forceTool: "read" })).rejects.toMatchObject({ code: "invalid_structured_output" });
  });
  it("defaults every configured stage to Gemini 4 Argon", () => {
    for (const key of ["MUBIT_INVESTIGATOR_MODEL", "MUBIT_DIAGNOSIS_MODEL", "MUBIT_PLANNER_MODEL", "MUBIT_RESEARCH_MODEL"]) vi.stubEnv(key, "");
    expect(providerConfig()).toMatchObject({ investigatorModel: "gemini-4-argon", diagnosisModel: "gemini-4-argon", plannerModel: "gemini-4-argon", researchModel: "gemini-4-argon" });
  });
  it("uses native Gemini structured output through Mubit and ignores thought text", async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ responseId: "gemini_response", candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "Private reasoning" }, { text: '{"ok":true}' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 6, totalTokenCount: 20 } }), { headers: { "x-middleware-request-id": "mreq_gemini" } }));
    vi.stubGlobal("fetch", mock);
    const result = await callModel({ model: "gemini-4-argon", system: "stable", input: { observation: "data" }, schema, sessionId: "run_test", recording: "metadata" });
    expect(result.value).toEqual({ ok: true });
    expect(result.metadata).toMatchObject({ provider: "mubit", model: "gemini-4-argon", requestId: "mreq_gemini", providerRequestId: "gemini_response", inputTokens: 10, outputTokens: 10, totalTokens: 20 });
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("https://api.mubit.ai/gemini/v1beta/models/gemini-4-argon:generateContent");
    expect(init.headers).toEqual({ "content-type": "application/json", "x-goog-api-key": "mbt_test", "x-middleware-record": "metadata" });
    const body = JSON.parse(init.body);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "stable" }] });
    expect(body.contents[0].parts[1].text).toBe('{"observation":"data"}');
    expect(body.generationConfig.responseJsonSchema.additionalProperties).toBe(false);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body).not.toHaveProperty("messages");
  });
  it("parses native Gemini function calls and constrains the forced function", async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name: "read", args: { ok: true } } }] } }] }), { headers: { "x-middleware-request-id": "mreq_function" } }));
    vi.stubGlobal("fetch", mock);
    const result = await callModel({ model: "gemini-4-argon", system: "s", input: {}, tools: [{ name: "read", description: "read", parameters: jsonSchema(schema) }], forceTool: "read" });
    expect(result.toolCalls).toEqual([{ id: "gemini_function_0", name: "read", arguments: { ok: true } }]);
    expect(JSON.parse(mock.mock.calls[0][1].body).toolConfig.functionCallingConfig).toEqual({ mode: "ANY", allowedFunctionNames: ["read"] });
  });
  it.each(["MAX_TOKENS", "SAFETY", "MALFORMED_FUNCTION_CALL"])("rejects incomplete Gemini replies: %s", async (finishReason) => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text: '{"ok":true}' }] } }] }), { headers: { "x-middleware-request-id": "mreq_incomplete" } }));
    vi.stubGlobal("fetch", mock);
    await expect(callModel({ model: "gemini-4-argon", system: "s", input: {}, schema })).rejects.toMatchObject({ code: "incomplete_or_refused" });
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid Gemini JSON and unknown function names", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"ok":"yes"}' }] } }] }), { headers: { "x-middleware-request-id": "mreq_bad" } })));
    await expect(callModel({ model: "gemini-4-argon", system: "s", input: {}, schema })).rejects.toMatchObject({ code: "invalid_structured_output" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name: "unregistered", args: {} } }] } }] }), { headers: { "x-middleware-request-id": "mreq_unknown" } })));
    await expect(callModel({ model: "gemini-4-argon", system: "s", input: {}, tools: [{ name: "read", description: "read", parameters: jsonSchema(schema) }] })).rejects.toMatchObject({ code: "invalid_structured_output" });
  });
  it("keeps local bounds strict when simplifying the Gemini decoding grammar", async () => {
    const bounded = z.object({ items: z.array(z.string().max(3)).max(1), maxItems: z.string() }).strict();
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"items":["oversized","extra"],"maxItems":"field"}' }] } }] }), { headers: { "x-middleware-request-id": "mreq_bounds" } }));
    vi.stubGlobal("fetch", mock);
    await expect(callModel({ model: "gemini-4-argon", system: "s", input: {}, schema: bounded })).rejects.toMatchObject({ code: "invalid_structured_output" });
    const nativeSchema = JSON.parse(mock.mock.calls[0][1].body).generationConfig.responseJsonSchema;
    expect(nativeSchema.properties.items).not.toHaveProperty("maxItems");
    expect(nativeSchema.properties.items.items).not.toHaveProperty("maxLength");
    expect(nativeSchema.properties.maxItems.type).toBe("string");
    expect(nativeSchema.additionalProperties).toBe(false);
  });
  it("keeps held-out calls out of training without changing the task", async () => {
    const mock = vi.fn().mockImplementation(async () => response()); vi.stubGlobal("fetch", mock);
    const request = { model: "test", system: "stable", input: { sample: "heldout" }, schema };
    await callModel({ ...request, recording: "metadata" });
    await callModel({ ...request, recording: "full" });
    expect(mock.mock.calls[0][1].headers["x-middleware-record"]).toBe("metadata");
    expect(mock.mock.calls[1][1].headers["x-middleware-record"]).toBe("full");
    expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual(JSON.parse(mock.mock.calls[1][1].body));
    expect(promptFingerprint({ ...request, recording: "metadata" }, "source", "1")).toBe(promptFingerprint({ ...request, recording: "full" }, "source", "1"));
  });
  it("keeps recurring task fingerprints stable across sessions and evidence without unsupported metadata", async () => {
    const first = { model: "test", system: "stable", input: { incident: "one" }, sessionId: "job_one", schema };
    const second = { ...first, input: { incident: "two" }, sessionId: "job_two" };
    expect(promptFingerprint(first, "diagnosis", "1")).toBe(promptFingerprint(second, "diagnosis", "1"));
    expect(promptFingerprint(first, "diagnosis", "1")).not.toBe(promptFingerprint({ ...second, system: "changed" }, "diagnosis", "1"));
    const mock = vi.fn().mockImplementation(async () => response()); vi.stubGlobal("fetch", mock);
    await callModel(first); await callModel(second);
    const bodies = mock.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies[0].messages[0]).toEqual(bodies[1].messages[0]);
    expect(bodies.every((b) => !("metadata" in b))).toBe(true);
    expect(bodies[0].messages[1]).not.toEqual(bodies[1].messages[1]);
  });
  it("requires Mubit credentials and rejects unsafe base URLs", () => { vi.stubEnv("MUBIT_API_KEY", ""); expect(providerConfig).toThrow("missing_mubit_key"); vi.stubEnv("MUBIT_API_KEY", "mbt_test"); vi.stubEnv("MUBIT_BASE_URL", "http://localhost/key"); expect(providerConfig).toThrow("invalid_base_url"); });
  it("sends only Mubit credentials and preserves actual usage and request id", async () => {
    const mock = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", mock);
    const result = await callModel({ model: "test", system: "stable", input: "data", schema });
    expect(result.value).toEqual({ ok: true }); expect(result.metadata.requestId).toBe("mreq_real"); expect(result.metadata.totalTokens).toBe(14);
    const init = mock.mock.calls[0][1]; expect(init.headers.authorization).toBe("Bearer mbt_test"); expect(JSON.stringify(init)).not.toContain("google_test");
    expect(JSON.parse(init.body).response_format.json_schema.strict).toBe(true);
  });
  it("refuses successful-looking responses without a gateway id", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: true }, {}))); await expect(callModel({ model: "test", system: "s", input: {}, schema })).rejects.toMatchObject({ code: "missing_gateway_request_id" }); });
  it.each([{ nope: true }, { ok: "yes" }, { ok: true, fabricated: 2 }])("rejects invalid structured output %j", async (body) => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body))); await expect(callModel({ model: "test", system: "s", input: {}, schema })).rejects.toMatchObject({ code: "invalid_structured_output", metadata: { requestId: "mreq_real" } }); });
  it("classifies rate limiting without an automatic chargeable retry", async () => { const mock = vi.fn().mockResolvedValue(new Response("{}", { status: 429, headers: { "retry-after": "2", "x-middleware-request-id": "mreq_limit" } })); vi.stubGlobal("fetch", mock); await expect(callModel({ model: "x", system: "s", input: {} })).rejects.toMatchObject({ retryable: true, ambiguous: false, retryAfterMs: 2000 }); expect(mock).toHaveBeenCalledTimes(1); });
  it("honours gateway no-retry errors", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503, headers: { "x-should-retry": "false" } }))); await expect(callModel({ model: "x", system: "s", input: {} })).rejects.toMatchObject({ retryable: false, ambiguous: true }); });
  it("records a retryable Mubit 503 without automatically repeating an ambiguous chargeable request", async () => {
    const mock = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 503, headers: { "x-should-retry": "true", "retry-after": "3", "x-middleware-request-id": "mreq_outage" } })).mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", mock);
    await expect(callModel({ model: "x", system: "s", input: {}, schema })).rejects.toMatchObject({
      code: "http_503", retryable: true, ambiguous: true, retryAfterMs: 3000, metadata: { requestId: "mreq_outage", provider: "mubit" },
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("accounts for an ambiguous timeout without retrying", async () => { const mock = vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")); vi.stubGlobal("fetch", mock); await expect(callModel({ model: "x", system: "s", input: {} })).rejects.toMatchObject({ ambiguous: true, retryable: false }); expect(mock).toHaveBeenCalledTimes(1); });
  it("validates function names and parses structured arguments", async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "call_actual", function: { name: "read", arguments: '{"ok":true}' } }] } }] }), { headers: { "x-middleware-request-id": "mreq_tool" } })); vi.stubGlobal("fetch", mock);
    const result = await callModel({ model: "x", system: "s", input: {}, tools: [{ name: "read", description: "read", parameters: jsonSchema(schema) }] });
    expect(schema.parse(result.toolCalls[0].arguments)).toEqual({ ok: true }); expect(JSON.parse(mock.mock.calls[0][1].body).reasoning_effort).toBe("none");
  });
  it("does not enable direct research implicitly", async () => { await expect(gatewayRequest("https://generativelanguage.googleapis.com/v1beta/models/test:generateContent", {}, "google_direct", "test")).rejects.toBeInstanceOf(ProviderError); });
  it("attributes explicitly enabled direct research correctly and sends only its key", async () => { vi.stubEnv("NORMAL_DIRECT_GEMINI_FALLBACK", "true"); const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, thoughtsTokenCount: 2, totalTokenCount: 10 } }))); vi.stubGlobal("fetch", mock); const r = await gatewayRequest("https://generativelanguage.googleapis.com/v1beta/models/test:generateContent", {}, "google_direct", "test"); expect(r.metadata).toMatchObject({ provider: "google_direct", requestId: null, totalTokens: 10, outputTokens: 5 }); expect(mock.mock.calls[0][1].headers).toEqual({ "content-type": "application/json", "x-goog-api-key": "google_test" }); });
});
