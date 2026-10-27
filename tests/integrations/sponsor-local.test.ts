import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callModel, providerConfig } from "@/intelligence/investigator/provider";
import { nemotronConfig } from "@/integrations/nemotron/verifier";
import { research } from "@/intelligence/investigator/research";
import { defaultBudget } from "@/intelligence/investigator/store";
import { searchBrightData } from "@/integrations/brightdata/search";

beforeEach(() => {
  vi.stubEnv("NVIDIA_INFERENCE_MODE", "local"); vi.stubEnv("NVIDIA_BASE_URL", "http://127.0.0.1:11434/v1");
  vi.stubEnv("NVIDIA_API_KEY", "cloud-secret-must-never-leak"); vi.stubEnv("NVIDIA_LOCAL_API_KEY", ""); vi.stubEnv("NVIDIA_LOCAL_MODEL", "nemotron-3-nano:4b");
  for (const key of ["NEMOTRON_INVESTIGATOR_MODEL", "NEMOTRON_DIAGNOSIS_MODEL", "NEMOTRON_PLANNER_MODEL", "NEMOTRON_JUDGE_MODEL"]) vi.stubEnv(key, "");
  vi.stubEnv("BRIGHTDATA_API_KEY", "test-bright-secret"); vi.stubEnv("BRIGHTDATA_SERP_ZONE", "serp_test");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("local Nemotron", () => {
  it("uses the local model without cloud credentials and disables the large reward model", async () => {
    vi.stubEnv("NEMOTRON_REWARD_MODEL", "off");
    expect(providerConfig()).toMatchObject({ local: true, key: "local", investigatorModel: "nemotron-3-nano:4b", diagnosisModel: "nemotron-3-nano:4b", plannerModel: "nemotron-3-nano:4b" });
    expect(nemotronConfig()).toMatchObject({ judgeModel: "nemotron-3-nano:4b", rewardModel: null });
    const transport = vi.fn().mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] }));
    vi.stubGlobal("fetch", transport);
    expect((await callModel({ model: providerConfig().investigatorModel, system: "s", input: {}, schema: z.object({ ok: z.boolean() }) })).value).toEqual({ ok: true });
    expect(transport.mock.calls[0][1].headers.authorization).toBe("Bearer local");
    expect(JSON.stringify(transport.mock.calls)).not.toContain("cloud-secret");
  });
  it.each(["http://example.com/v1", "https://example.com/v1", "http://127.0.0.1:11434/v1?token=x", "http://user:password@127.0.0.1/v1", "http://127.0.0.1:11434/other"])("rejects local endpoint %s", (base) => {
    vi.stubEnv("NVIDIA_BASE_URL", base); expect(providerConfig).toThrow("invalid_base_url");
  });
  it("never converts cloud mode into a local fallback", () => {
    vi.stubEnv("NVIDIA_INFERENCE_MODE", "cloud"); expect(providerConfig).toThrow("invalid_base_url");
    vi.stubEnv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"); vi.stubEnv("NVIDIA_API_KEY", ""); expect(providerConfig).toThrow("missing_nvidia_key");
  });
  it("does not retry a disconnected local model", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("disconnected")); vi.stubGlobal("fetch", transport);
    await expect(callModel({ model: "nemotron-3-nano:4b", system: "s", input: {} })).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["local", "", 300_000],
    ["local", "450000", 450_000],
    ["cloud", "450000", 120_000],
  ])("sets the request deadline for %s inference", async (mode, override, expected) => {
    vi.stubEnv("NVIDIA_INFERENCE_MODE", mode);
    vi.stubEnv("NVIDIA_BASE_URL", mode === "local" ? "http://127.0.0.1:1234/v1" : "https://integrate.api.nvidia.com/v1");
    vi.stubEnv("NVIDIA_LOCAL_TIMEOUT_MS", override);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] })));
    const deadline = vi.spyOn(AbortSignal, "timeout");
    try {
      await callModel({ model: "test", system: "s", input: {}, schema: z.object({ ok: z.boolean() }) });
      expect(deadline).toHaveBeenCalledWith(expected);
    } finally { deadline.mockRestore(); }
  });
  it.each(["0", "600001", "NaN"])("rejects an invalid local deadline %s", (value) => {
    vi.stubEnv("NVIDIA_LOCAL_TIMEOUT_MS", value);
    expect(providerConfig).toThrow();
  });
  it("preserves local decoding minimums without expanding large repetition maxima", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"reason":"Need evidence","choices":["sales","ads"]}' } }] }));
    vi.stubGlobal("fetch", transport);
    await callModel({ model: "test", system: "s", input: {}, schema: z.object({
      reason: z.string().min(1).max(100), choices: z.array(z.string()).min(2).max(3),
    }) });
    const sent = JSON.parse(transport.mock.calls[0][1].body).response_format.json_schema.schema;
    expect(sent.properties.reason.minLength).toBe(1);
    expect(sent.properties.choices.minItems).toBe(2);
    expect(sent.properties.reason.maxLength).toBeUndefined();
    expect(sent.properties.choices.maxItems).toBeUndefined();
  });
});
describe("Bright Data public research", () => {
  it("uses the documented JSON SERP API and discards unsafe/duplicate URLs", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ organic: [{ link: "https://www.ons.gov.uk/retail", description: "Public retail statistics" }, { link: "http://127.0.0.1/private" }, { link: "https://www.ons.gov.uk/retail" }] }));
    const result = await searchBrightData("official UK retail statistics", transport);
    expect(result.candidates).toEqual([{ url: "https://www.ons.gov.uk/retail", claim: "Public retail statistics", excerpt: "" }]);
    const [endpoint, init] = transport.mock.calls[0];
    expect(endpoint).toBe("https://api.brightdata.com/request");
    expect(JSON.parse(init.body)).toMatchObject({ zone: "serp_test", format: "json" });
    expect(JSON.parse(init.body).url).toContain("brd_json=1");
    expect(JSON.stringify(result)).not.toContain("test-bright-secret");
  });
  it("does not send the investigation's private question and works alongside NVIDIA inference", async () => {
    vi.stubEnv("EXPLAINWHY_EXTERNAL_RESEARCH_ENABLED", "true"); vi.stubEnv("EXPLAINWHY_RESEARCH_PROVIDER", "brightdata");
    const transport = vi.fn().mockResolvedValue(Response.json({ organic: [] })); vi.stubGlobal("fetch", transport);
    const result = await research({ topic: "retail_market", question: "PRIVATE revenue figures", rationale: "private", geography: "UK", hypotheses: ["unknown"], sourceTypes: ["government"] }, { startAt: "2026-10-01T00:00:00.000Z", endAt: "2026-10-02T00:00:00.000Z" }, "2026-10-02T00:00:00.000Z");
    expect(result.metadata.provider).toBe("brightdata"); expect(result.groundingPresent).toBe(false);
    expect(JSON.stringify(transport.mock.calls)).not.toContain("PRIVATE"); expect(defaultBudget().maxResearchRounds).toBe(2);
  });
  it.each([401, 429, 503])("keeps HTTP %s failures redacted without automatic retries", async (status) => {
    const transport = vi.fn().mockResolvedValue(new Response("test-bright-secret", { status }));
    await expect(searchBrightData("public statistics", transport)).rejects.toThrow(`upstream_http_${status}`);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects incomplete JSON and oversized provider responses", async () => {
    await expect(searchBrightData("query", vi.fn().mockResolvedValue(new Response("{")))).rejects.toThrow("upstream_invalid_json");
    await expect(searchBrightData("query", vi.fn().mockResolvedValue(new Response("a".repeat(1_000_001))))).rejects.toThrow("upstream_response_too_large");
  });
});
