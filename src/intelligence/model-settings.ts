import "server-only";

export const DEFAULT_MUBIT_MODEL = "gemini-4-argon";

/** Server-owned model settings shared by inference and the current-model disclosure. No credentials. */
export function configuredModels() {
  return {
    investigatorModel: process.env.MUBIT_INVESTIGATOR_MODEL || DEFAULT_MUBIT_MODEL,
    diagnosisModel: process.env.MUBIT_DIAGNOSIS_MODEL || DEFAULT_MUBIT_MODEL,
    plannerModel: process.env.MUBIT_PLANNER_MODEL || DEFAULT_MUBIT_MODEL,
    researchModel: process.env.MUBIT_RESEARCH_MODEL || DEFAULT_MUBIT_MODEL,
  };
}

export function modelDisplayName(model: string) {
  return model === DEFAULT_MUBIT_MODEL ? "Gemini 4 Argon" : model;
}
