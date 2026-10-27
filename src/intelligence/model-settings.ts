import "server-only";

export const DEFAULT_MUBIT_MODEL = "gemini-4-argon";
/** Reasoning core when ExplainWhy calls the NVIDIA API catalog directly (EXPLAINWHY_MODEL_PROVIDER=nvidia). */
export const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3-super-120b-a12b";

export type ModelProvider = "mubit" | "nvidia";
export function modelProvider(): ModelProvider {
  return process.env.EXPLAINWHY_MODEL_PROVIDER === "nvidia" ? "nvidia" : "mubit";
}

/** Server-owned model settings shared by inference and the current-model disclosure. No credentials. */
export function configuredModels() {
  if (modelProvider() === "nvidia") {
    const model = (name: string) => process.env[`NEMOTRON_${name}_MODEL`] || DEFAULT_NVIDIA_MODEL;
    return { investigatorModel: model("INVESTIGATOR"), diagnosisModel: model("DIAGNOSIS"), plannerModel: model("PLANNER"), researchModel: model("INVESTIGATOR") };
  }
  return {
    investigatorModel: process.env.MUBIT_INVESTIGATOR_MODEL || DEFAULT_MUBIT_MODEL,
    diagnosisModel: process.env.MUBIT_DIAGNOSIS_MODEL || DEFAULT_MUBIT_MODEL,
    plannerModel: process.env.MUBIT_PLANNER_MODEL || DEFAULT_MUBIT_MODEL,
    researchModel: process.env.MUBIT_RESEARCH_MODEL || DEFAULT_MUBIT_MODEL,
  };
}

export function modelDisplayName(model: string) {
  if (model === DEFAULT_MUBIT_MODEL) return "Gemini 4 Argon";
  if (model === DEFAULT_NVIDIA_MODEL) return "NVIDIA Nemotron 3 Super";
  return model;
}
