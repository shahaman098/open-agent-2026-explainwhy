import "server-only";
import { createHash } from "node:crypto";
import { canonicalJson } from "../evidence/provenance";
import { z } from "zod";
import { configuredModels } from "../model-settings";

export interface CallMetadata {
  provider: "mubit" | "google_direct"; route: string; model: string; requestId: string | null;
  providerRequestId: string | null; latencyMs: number; inputTokens: number | null; outputTokens: number | null;
  totalTokens: number | null; estimatedCostUsd: number | null;
}
export class ProviderError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly ambiguous: boolean, readonly metadata: Partial<CallMetadata> = {}, readonly retryAfterMs = 0, readonly details: string | null = null) {
    super(`Model request failed: ${code}${details ? `: ${details}` : ""}`); this.name = "ProviderError";
  }
}
export function providerConfig() {
  const base = process.env.MUBIT_BASE_URL || "https://api.mubit.ai/openai/v1";
  const geminiBase = process.env.MUBIT_GEMINI_BASE_URL || "https://api.mubit.ai/gemini";
  for (const value of [base, geminiBase]) {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) throw new ProviderError("invalid_base_url", false, false);
  }
  if (!process.env.MUBIT_API_KEY) throw new ProviderError("missing_mubit_key", false, false);
  return {
    key: process.env.MUBIT_API_KEY, base: base.replace(/\/$/, ""), geminiBase: geminiBase.replace(/\/$/, ""),
    geminiTransport: z.enum(["native", "openai"]).parse(process.env.MUBIT_GEMINI_TRANSPORT || "native"),
    ...configuredModels(),
    reasoning: z.enum(["low", "medium", "high"]).parse(process.env.MUBIT_REASONING_DEPTH || "low"),
  };
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
  /** Held-out evaluation must use metadata: Mubit then cannot keep the request/answer for training. */
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

export async function gatewayRequest(route: string, body: unknown, provider: CallMetadata["provider"], model: string, timeoutMs = 60_000, recording?: ModelRequest["recording"]): Promise<{ body: Record<string, unknown>; metadata: CallMetadata }> {
  const config = providerConfig();
  const direct = provider === "google_direct";
  if (direct && (process.env.NORMAL_DIRECT_GEMINI_FALLBACK !== "true" || !process.env.GEMINI_API_KEY)) throw new ProviderError("direct_fallback_disabled", false, false);
  const native = route.includes(":generateContent");
  const key = direct ? process.env.GEMINI_API_KEY! : config.key;
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(route, { method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: { "content-type": "application/json", ...(native ? { "x-goog-api-key": key } : { authorization: `Bearer ${key}` }), ...(!direct && recording ? { "x-middleware-record": recording } : {}) }, body: JSON.stringify(body) });
  } catch { throw new ProviderError("transport_or_timeout", false, true, { provider, model, route, latencyMs: Date.now() - started }); }
  const metadata: CallMetadata = { provider, model, route, requestId: response.headers.get("x-middleware-request-id"), providerRequestId: response.headers.get("x-request-id") || response.headers.get("request-id"), latencyMs: Date.now() - started, inputTokens: null, outputTokens: null, totalTokens: null, estimatedCostUsd: null };
  if (!response.ok) {
    // Never echo provider bodies: they can include submitted data or credentials.
    const errorPayload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    const diagnostic = String(errorPayload.error?.message || "").replace(/(?:mbt_|sk-|AIza)[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 500);
    if (process.env.NORMAL_PROVIDER_DIAGNOSTICS === "true") console.error(JSON.stringify({ status: response.status, diagnostic }));
    const retryable = response.headers.get("x-should-retry") !== "false" && [429, 503].includes(response.status);
    const retryAfter = Math.min(60_000, Math.max(1000, Number(response.headers.get("retry-after") || 1) * 1000));
    throw new ProviderError(`http_${response.status}`, retryable, response.status >= 500, metadata, retryAfter);
  }
  let data: Record<string, unknown>;
  try { data = await response.json(); } catch { throw new ProviderError("invalid_json", false, true, metadata); }
  if (!direct && !metadata.requestId) throw new ProviderError("missing_gateway_request_id", false, true, metadata);
  if (!metadata.providerRequestId && typeof data.responseId === "string") metadata.providerRequestId = data.responseId;
  const usage = (data.usage || data.usageMetadata || {}) as Record<string, unknown>;
  metadata.inputTokens = finite(usage.prompt_tokens ?? usage.promptTokenCount);
  metadata.outputTokens = finite(usage.completion_tokens ?? (typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount + (finite(usage.thoughtsTokenCount) || 0) : null));
  metadata.totalTokens = finite(usage.total_tokens ?? usage.totalTokenCount);
  const inputRate = finite(Number(process.env.NORMAL_INPUT_USD_PER_MILLION ?? NaN));
  const outputRate = finite(Number(process.env.NORMAL_OUTPUT_USD_PER_MILLION ?? NaN));
  if (!model.startsWith("gemini-") && !native && inputRate !== null && outputRate !== null && metadata.inputTokens !== null && metadata.outputTokens !== null) metadata.estimatedCostUsd = (metadata.inputTokens * inputRate + metadata.outputTokens * outputRate) / 1e6;
  return { body: data, metadata };
}

export async function callModel(req: ModelRequest): Promise<ModelResponse> {
  const config = providerConfig();
  const gemini = req.model.startsWith("gemini-");
  if (gemini && config.geminiTransport === "native") return callGeminiModel(req);
  const { body, metadata } = await gatewayRequest(`${gemini ? `${config.geminiBase}/v1beta/openai` : config.base}/chat/completions`, {
    model: req.model, messages: [{ role: "system", content: req.system }, ...(req.sessionId ? [{ role: "user", content: `Investigation session: ${req.sessionId}` }] : []), { role: "user", content: JSON.stringify(req.input) }],
    ...(gemini ? { max_tokens: req.maxOutputTokens ?? 6000 } : { max_completion_tokens: req.maxOutputTokens ?? 6000 }),
    reasoning_effort: !gemini && req.tools?.length ? "none" : config.reasoning,
    ...(req.schema ? { response_format: { type: "json_schema", json_schema: { name: req.schemaName || "normal_output", strict: true, schema: gemini ? geminiGenerationSchema(req.schema) : jsonSchema(req.schema) } } } : {}),
    ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: "function", function: { ...t, strict: true } })), tool_choice: req.forceTool ? { type: "function", function: { name: req.forceTool } } : "auto", parallel_tool_calls: false } : {}),
  }, "mubit", req.model, 60_000, req.recording);
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
    const value = choice.message.content ? (req.schema ? JSON.parse(choice.message.content) as unknown : choice.message.content) : null;
    if (req.forceTool && !toolCalls.length) throw new Error("Missing forced function call");
    if (!choice.message.content && !toolCalls.length) throw new Error("Empty response");
    return { value: req.schema ? req.schema.parse(value) : value, toolCalls, metadata };
  } catch (e) { throw new ProviderError("invalid_structured_output", false, false, metadata, 0, e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 6).join("; ") : "Invalid JSON or tool name"); }
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

/** Native Gemini through Mubit; the OpenAI gateway does not turn a Gemini model ID into a Gemini call. */
async function callGeminiModel(req: ModelRequest): Promise<ModelResponse> {
  const config = providerConfig();
  const { body, metadata } = await gatewayRequest(`${config.geminiBase}/v1beta/models/${encodeURIComponent(req.model)}:generateContent`, {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts: [
      ...(req.sessionId ? [{ text: `Investigation session: ${req.sessionId}` }] : []),
      { text: JSON.stringify(req.input) },
    ] }],
    generationConfig: { maxOutputTokens: req.maxOutputTokens ?? 6000, thinkingConfig: { thinkingLevel: config.reasoning },
      ...(req.schema ? { responseMimeType: "application/json", responseJsonSchema: geminiGenerationSchema(req.schema) } : {}) },
    ...(req.tools?.length ? { tools: [{ functionDeclarations: req.tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }],
      toolConfig: { functionCallingConfig: req.forceTool ? { mode: "ANY", allowedFunctionNames: [req.forceTool] } : { mode: "AUTO" } } } : {}),
  }, "mubit", req.model, 60_000, req.recording);
  const candidates = body.candidates as Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean; functionCall?: { id?: string; name: string; args?: unknown } }> } }> | undefined;
  const candidate = candidates?.[0];
  if (!candidate || candidate.finishReason !== "STOP" || (body.promptFeedback as { blockReason?: string } | undefined)?.blockReason) throw new ProviderError("incomplete_or_refused", false, false, metadata);
  try {
    const parts = candidate.content?.parts || [];
    const toolCalls = parts.flatMap((part, index) => {
      if (!part.functionCall) return [];
      const call = part.functionCall;
      if (!req.tools?.some((tool) => tool.name === call.name) || (req.forceTool && call.name !== req.forceTool)
        || !call.args || typeof call.args !== "object" || Array.isArray(call.args)) throw new Error("Invalid function call");
      return [{ id: call.id || `gemini_function_${index}`, name: call.name, arguments: call.args }];
    });
    // Thought text is not an answer and must not leak into a report or JSON parser.
    const content = parts.filter((part) => !part.thought && typeof part.text === "string").map((part) => part.text).join("");
    if (req.forceTool && !toolCalls.length) throw new Error("Missing forced function call");
    const value = content ? (req.schema ? JSON.parse(content) as unknown : content) : null;
    if (!content && !toolCalls.length) throw new Error("Empty response");
    return { value: req.schema ? req.schema.parse(value) : value, toolCalls, metadata };
  } catch (error) {
    throw new ProviderError("invalid_structured_output", false, false, metadata, 0,
      error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).slice(0, 6).join("; ") : "Invalid Gemini JSON or function call");
  }
}
