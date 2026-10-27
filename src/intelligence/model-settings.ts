import "server-only";

/** Reasoning core when ExplainWhy calls the NVIDIA API catalog directly. */
export const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3-super-120b-a12b";
export const DEFAULT_GEMINI_RESEARCH_MODEL = "gemini-2.0-flash";

export type ModelProvider = "nvidia";

/** Inference uses the NVIDIA API catalog; grounded research uses direct Gemini when enabled. */
export function modelProvider(): ModelProvider {
  return "nvidia";
}

/** Server-owned model settings shared by inference and the current-model disclosure. No credentials. */
export function configuredModels() {
  const defaultModel = process.env.NVIDIA_INFERENCE_MODE === "local" ? process.env.NVIDIA_LOCAL_MODEL || "nemotron-3-nano:4b" : DEFAULT_NVIDIA_MODEL;
  const model = (name: string) => process.env[`NEMOTRON_${name}_MODEL`] || defaultModel;
  return {
    investigatorModel: model("INVESTIGATOR"),
    diagnosisModel: model("DIAGNOSIS"),
    plannerModel: model("PLANNER"),
    researchModel: process.env.GEMINI_RESEARCH_MODEL || DEFAULT_GEMINI_RESEARCH_MODEL,
  };
}

export function modelDisplayName(model: string) {
  if (model === DEFAULT_NVIDIA_MODEL) return "NVIDIA Nemotron 3 Super";
  if (model.startsWith("gemini-")) return "Gemini";
  return model;
}
