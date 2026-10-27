import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callModel, providerConfig } from "@/intelligence/investigator/provider";
import { research } from "@/intelligence/investigator/research";

const schema = z.object({ ok: z.boolean() }).strict();
const reply = (content: string, finish = "stop") => new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content } }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } }), { status: 200, headers: { "nvcf-reqid": "nvreq_123" } });
beforeEach(() => { vi.stubEnv("EXPLAINWHY_MODEL_PROVIDER", "nvidia"); vi.stubEnv("NVIDIA_API_KEY", "nvapi-test"); vi.stubEnv("MUBIT_API_KEY", ""); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("direct NVIDIA provider (no gateway)", () => {
  it("needs only an NVIDIA key and defaults every stage to Nemotron 3 Super", () => {
    expect(providerConfig()).toMatchObject({ provider: "nvidia", base: "https://integrate.api.nvidia.com/v1", investigatorModel: "nvidia/nemotron-3-super-120b-a12b", diagnosisModel: "nvidia/nemotron-3-super-120b-a12b", plannerModel: "nvidia/nemotron-3-super-120b-a12b", structuredOutput: "json_schema" });
    vi.stubEnv("NVIDIA_API_KEY", "");
    expect(providerConfig).toThrow("missing_nvidia_key");
    vi.stubEnv("NVIDIA_API_KEY", "nvapi-test"); vi.stubEnv("NVIDIA_BASE_URL", "http://example.com/v1");
    expect(providerConfig).toThrow("invalid_base_url");
  });

  it("calls the catalog directly, records the NVIDIA request ID and validates JSON locally", async () => {
    const mock = vi.fn().mockResolvedValue(reply(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", mock);
    const result = await callModel({ model: "nvidia/nemotron-3-super-120b-a12b", system: "s", input: { a: 1 }, schema, schemaName: "probe", recording: "full", sessionId: "job_1" });
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(init.headers).toEqual({ "content-type": "application/json", authorization: "Bearer nvapi-test" });
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "nvidia/nemotron-3-super-120b-a12b", max_tokens: 6000, response_format: { type: "json_schema", json_schema: { name: "probe" } } });
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(result).toMatchObject({ value: { ok: true }, metadata: { provider: "nvidia", requestId: "nvreq_123", totalTokens: 17 } });
  });

  it("strips visible thinking and markdown fences before parsing, and still rejects invalid output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply("<think>weighing options</think>\n```json\n{\"ok\": false}\n```")));
    await expect(callModel({ model: "m", system: "s", input: {}, schema })).resolves.toMatchObject({ value: { ok: false } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply("{\"ok\": \"yes\"}")));
    await expect(callModel({ model: "m", system: "s", input: {}, schema })).rejects.toMatchObject({ code: "invalid_structured_output" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply("{\"ok\": true", "length")));
    await expect(callModel({ model: "m", system: "s", input: {}, schema })).rejects.toMatchObject({ code: "incomplete_or_refused" });
  });

  it("supports NIM guided_json and schema-in-prompt modes", async () => {
    const mock = vi.fn().mockImplementation(async () => reply(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", mock);
    vi.stubEnv("NVIDIA_STRUCTURED_OUTPUT", "guided_json");
    await callModel({ model: "m", system: "s", input: {}, schema });
    expect(JSON.parse(mock.mock.calls[0][1].body)).toMatchObject({ nvext: { guided_json: { type: "object" } } });
    vi.stubEnv("NVIDIA_STRUCTURED_OUTPUT", "prompt");
    await callModel({ model: "m", system: "s", input: {}, schema });
    const prompted = JSON.parse(mock.mock.calls[1][1].body);
    expect(prompted).not.toHaveProperty("response_format");
    expect(prompted.messages[0].content).toContain("matches this JSON Schema");
  });

  it("does not attempt Gemini-grounded research on the NVIDIA route", async () => {
    vi.stubEnv("EXPLAINWHY_EXTERNAL_RESEARCH_ENABLED", "true");
    const mock = vi.fn(); vi.stubGlobal("fetch", mock);
    const window = { startAt: "2026-10-01T00:00:00.000Z", endAt: "2026-10-02T00:00:00.000Z" };
    await expect(research({ topic: "retail_market", question: "q", rationale: "r", geography: "UK", hypotheses: ["unknown"], sourceTypes: ["government"] }, window, window.endAt)).rejects.toMatchObject({ code: "research_unavailable_for_provider" });
    expect(mock).not.toHaveBeenCalled();
  });
});
