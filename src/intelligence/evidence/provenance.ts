import { createHash } from "node:crypto";

const h = (s: string, n = 12) => createHash("sha256").update(s).digest("hex").slice(0, n);

/** Stable JSON: keys sorted recursively so equal inputs always hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** One collection per investigation and data cutoff: re-running at the same cutoff reuses or overwrites, never duplicates. */
export const collectionId = (businessId: string, simulationRunId: string, investigationId: string, cutoff: string) => `evc_${h(canonicalJson([businessId, simulationRunId, investigationId, cutoff]), 24)}`;
export const toolRunId = (collection: string, tool: string, input: unknown) => `evr_${h(`${collection}|${tool}|${canonicalJson(input)}`)}`;
/** Evidence identity = investigation + tool + logical item + exact validated input, so identical retrievals upsert in place. */
export const evidenceId = (investigationId: string, tool: string, key: string, input: unknown) => `evd_${h(`${investigationId}|${tool}|${key}|${canonicalJson(input)}`, 16)}`;
