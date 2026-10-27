import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "../evidence/provenance";
import { z } from "zod";
import { configuredModels } from "../model-settings";
import { nvidiaEndpoint } from "../../integrations/nemotron/endpoint";

export interface CallMetadata {
  provider: "google_direct" | "nvidia" | "brightdata"; route: string; model: string; requestId: string | null;
  providerRequestId: string | null; latencyMs: number; inputTokens: number | null; outputTokens: number | null;
  totalTokens: number | null; estimatedCostUsd: number | null;
}
export class ProviderError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly ambiguous: boolean, readonly metadata: Partial<CallMetadata> = {}, readonly retryAfterMs = 0, readonly details: string | null = null) {
    super(`Model request failed: ${code}${details ? `: ${details}` : ""}`); this.name = "ProviderError";
  }
}
export function providerConfig() {
  let endpoint: ReturnType<typeof nvidiaEndpoint>;
  try { endpoint = nvidiaEndpoint(); } catch (error) {
    const code = error instanceof Error && ["missing_nvidia_key", "invalid_inference_mode"].includes(error.message) ? error.message : "invalid_base_url";
    throw new ProviderError(code, false, false);
  }
  return {
    provider: "nvidia" as const,
    ...endpoint,
    ...configuredModels(),
    reasoning: z.enum(["low", "medium", "high"]).parse(process.env.EXPLAINWHY_REASONING_DEPTH || "low"),
    structuredOutput: z.enum(["json_schema", "guided_json", "prompt"]).parse(process.env.NVIDIA_STRUCTURED_OUTPUT || "json_schema"),
  };
}

/** Direct Gemini for grounded public research only. */
export function geminiResearchConfig() {
  if (!process.env.GEMINI_API_KEY?.trim()) throw new ProviderError("missing_gemini_key", false, false);
  const model = configuredModels().researchModel;
  return { key: process.env.GEMINI_API_KEY.trim(), model, base: "https://generativelanguage.googleapis.com" };
}

/** Deliberately small converter: unsupported Zod nodes fail closed; local Zod remains authoritative. */
export function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    return { type: "object", properties: Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, jsonSchema(v)])), required: Object.keys(shape), additionalProperties: false };
  }
  if (schema instanceof z.ZodString) {
    const min = schema._def.checks.find((c) => c.kind === "min"), max = schema._def.checks.find((c) => c.kind === "max");
    return { type: "string", ...(min && "value" in min ? { minLength: min.value } : {}), ...(max && "value" in max ? { maxLength: max.value } : {}) };
  }
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: schema.options };
  if (schema instanceof z.ZodLiteral) return { type: typeof schema.value, const: schema.value };
  if (schema instanceof z.ZodArray) return { type: "array", items: jsonSchema(schema.element), ...(schema._def.minLength ? { minItems: schema._def.minLength.value } : {}), ...(schema._def.maxLength ? { maxItems: schema._def.maxLength.value } : {}) };
  if (schema instanceof z.ZodNullable) return { anyOf: [jsonSchema(schema.unwrap()), { type: "null" }] };
  if (schema instanceof z.ZodEffects) return jsonSchema(schema.innerType());
  throw new Error(`Unsupported structured-output schema: ${schema._def.typeName}`);
}

export interface FunctionTool { name: string; description: string; parameters: Record<string, unknown> }
export interface ModelRequest {
  model: string; system: string; input: unknown; schema?: z.ZodTypeAny; schemaName?: string;
  tools?: FunctionTool[]; forceTool?: string; maxOutputTokens?: number; sessionId?: string;
  /** Local capture intent for training CLI / export; not sent to providers. */
  recording?: "full" | "metadata" | "off";
}
/** Stable task identity, independent of changing evidence, sessions, and model routing. */
export function promptFingerprint(request: ModelRequest, task: string, version: string): string {
  return createHash("sha256").update(canonicalJson({ task, version, system: request.system,
    schema: request.schema ? jsonSchema(request.schema) : null, schemaName: request.schemaName || null,
    tools: request.tools || [], forceTool: request.forceTool || null })).digest("hex");
}
export interface ModelResponse { value: unknown; toolCalls: Array<{ id: string; name: string; arguments: unknown }>; metadata: CallMetadata }
const finite = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null;

function assignRequestId(metadata: CallMetadata, response: Response, data: Record<string, unknown>) {
  metadata.requestId = metadata.requestId
    || response.headers.get(metadata.provider === "nvidia" ? "nvcf-reqid" : "x-middleware-request-id")
    || randomUUID();
  if (!metadata.providerRequestId && typeof data.responseId === "string") metadata.providerRequestId = data.responseId;
}

export async function gatewayRequest(route: string, body: unknown, provider: "google_direct" | "nvidia", model: string, timeoutMs = 60_000): Promise<{ body: Record<string, unknown>; metadata: CallMetadata }> {
  const native = route.includes(":generateContent");
  const key = provider === "google_direct" ? geminiResearchConfig().key : providerConfig().key;
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(route, { method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: { "content-type": "application/json", ...(native ? { "x-goog-api-key": key } : { authorization: `Bearer ${key}` }) }, body: JSON.stringify(body) });
  } catch { throw new ProviderError("transport_or_timeout", false, true, { provider, model, route, latencyMs: Date.now() - started }); }
  const metadata: CallMetadata = { provider, model, route, requestId: null, providerRequestId: response.headers.get("x-request-id") || response.headers.get("request-id"), latencyMs: Date.now() - started, inputTokens: null, outputTokens: null, totalTokens: null, estimatedCostUsd: null };
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    const diagnostic = String(errorPayload.error?.message || "").replace(/(?:mbt_|sk-|AIza|nvapi-)[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 500);
    if (process.env.EXPLAINWHY_PROVIDER_DIAGNOSTICS === "true") console.error(JSON.stringify({ status: response.status, diagnostic }));
    const retryable = response.headers.get("x-should-retry") !== "false" && [429, 503].includes(response.status);
    const retryAfter = Math.min(60_000, Math.max(1000, Number(response.headers.get("retry-after") || 1) * 1000));
    assignRequestId(metadata, response, {});
    throw new ProviderError(`http_${response.status}`, retryable, response.status >= 500, metadata, retryAfter);
  }
  let data: Record<string, unknown>;
  try { data = await response.json(); } catch { throw new ProviderError("invalid_json", false, true, metadata); }
  assignRequestId(metadata, response, data);
  const usage = (data.usage || data.usageMetadata || {}) as Record<string, unknown>;
  metadata.inputTokens = finite(usage.prompt_tokens ?? usage.promptTokenCount);
  metadata.outputTokens = finite(usage.completion_tokens ?? (typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount + (finite(usage.thoughtsTokenCount) || 0) : null));
  metadata.totalTokens = finite(usage.total_tokens ?? usage.totalTokenCount);
  const inputRate = finite(Number(process.env.EXPLAINWHY_INPUT_USD_PER_MILLION ?? NaN));
  const outputRate = finite(Number(process.env.EXPLAINWHY_OUTPUT_USD_PER_MILLION ?? NaN));
  if (!model.startsWith("gemini-") && !native && inputRate !== null && outputRate !== null && metadata.inputTokens !== null && metadata.outputTokens !== null) metadata.estimatedCostUsd = (metadata.inputTokens * inputRate + metadata.outputTokens * outputRate) / 1e6;
  return { body: data, metadata };
}

export async function callModel(req: ModelRequest): Promise<ModelResponse> {
  return callNvidiaModel(req, providerConfig());
}

/** NVIDIA API catalog (Nemotron). Structured output: json_schema response_format, NIM guided_json, or schema-in-prompt. */
async function callNvidiaModel(req: ModelRequest, config: ReturnType<typeof providerConfig>): Promise<ModelResponse> {
  const schema = req.schema ? geminiGenerationSchema(req.schema) : null;
  const system = schema && config.structuredOutput === "prompt" ? `${req.system}\nReturn exactly one JSON object, with no markdown, that matches this JSON Schema:\n${JSON.stringify(schema)}` : req.system;
  const { body, metadata } = await gatewayRequest(`${config.base}/chat/completions`, {
    model: req.model, messages: [{ role: "system", content: system }, ...(req.sessionId ? [{ role: "user", content: `Investigation session: ${req.sessionId}` }] : []), { role: "user", content: JSON.stringify(req.input) }],
    max_tokens: req.maxOutputTokens ?? 6000, temperature: 0.2, top_p: 0.95, stream: false,
    ...(process.env.NVIDIA_ENABLE_THINKING ? { chat_template_kwargs: { enable_thinking: process.env.NVIDIA_ENABLE_THINKING === "true" } } : {}),
    ...(schema && config.structuredOutput === "json_schema" ? { response_format: { type: "json_schema", json_schema: { name: req.schemaName || "normal_output", schema } } } : {}),
    ...(schema && config.structuredOutput === "guided_json" ? { nvext: { guided_json: schema } } : {}),
    ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: "function", function: t })), tool_choice: req.forceTool ? { type: "function", function: { name: req.forceTool } } : "auto" } : {}),
  }, "nvidia", req.model, 120_000);
  return parseChatCompletion(body, req, metadata);
}

function parseChatCompletion(body: Record<string, unknown>, req: ModelRequest, metadata: CallMetadata): ModelResponse {
  const choices = body.choices as Array<{ finish_reason: string; message: { content?: string; refusal?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> | undefined;
  const choice = choices?.[0];
  if (!choice || choice.message.refusal || !["stop", "tool_calls"].includes(choice.finish_reason)) throw new ProviderError("incomplete_or_refused", false, false, metadata);
  try {
    const toolCalls = (choice.message.tool_calls || []).map((c) => {
      const tool = req.tools?.find((t) => t.name === c.function.name);
      if (!tool || (req.forceTool && c.function.name !== req.forceTool)) throw new Error("Unknown or unexpected function");
      const args = JSON.parse(c.function.arguments) as unknown;
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid function arguments");
      return { id: c.id, name: c.function.name, arguments: args };
    });
    const content = jsonPayload(choice.message.content || "", Boolean(req.schema));
    const value = content ? (req.schema ? JSON.parse(content) as unknown : content) : null;
    if (req.forceTool && !toolCalls.length) throw new Error("Missing forced function call");
    if (!content && !toolCalls.length) throw new Error("Empty response");
    return { value: req.schema ? req.schema.parse(value) : value, toolCalls, metadata };
  } catch (e) { throw new ProviderError("invalid_structured_output", false, false, metadata, 0, e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 6).join("; ") : "Invalid JSON or tool name"); }
}

function jsonPayload(text: string, structured: boolean): string {
  const answer = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!structured) return answer;
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(answer);
  return fenced ? fenced[1] : answer;
}

/** Avoid oversized Gemini decoding grammars. Exact string/array limits remain enforced by local Zod. */
function geminiGenerationSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const simplify = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(simplify);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !["minLength", "maxLength", "minItems", "maxItems"].includes(key))
      .map(([key, child]) => [key, key === "properties" && child && typeof child === "object"
        ? Object.fromEntries(Object.entries(child).map(([name, property]) => [name, simplify(property)]))
        : simplify(child)]));
    return value;
  };
  return simplify(jsonSchema(schema)) as Record<string, unknown>;
}

/** Grounded Gemini research via Google AI (not NVIDIA). */
export async function callGeminiResearch(body: Record<string, unknown>): Promise<{ body: Record<string, unknown>; metadata: CallMetadata }> {
  const { model, base } = geminiResearchConfig();
  return gatewayRequest(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, body, "google_direct", model, 90_000);
}
