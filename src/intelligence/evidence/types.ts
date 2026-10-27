import type { Db } from "mongodb";
import { z } from "zod";
import type { EvidenceT } from "@normal/contracts";
import type { CatalogueLabel } from "@/intelligence/types";

/** Stable tool names; the future Mubit investigator selects from exactly this set. */
export const TOOL_NAMES = [
  "revenue_analysis", "advertising_analysis", "checkout_analysis", "inventory_analysis",
  "shipping_analysis", "customer_feedback_analysis", "public_reference_context", "historical_incidents",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type EvidenceCategory = EvidenceT["category"];
export type DataOrigin = "simulated" | "public_reference" | "normal_internal";

const Scoped = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);
const Iso = z.string().datetime({ offset: true });
export const Window = z.object({ startAt: Iso, endAt: Iso }).strict();
export type WindowT = z.infer<typeof Window>;
export const HOUR = 3_600_000;
export const MAX_WINDOW_HOURS = 14 * 24;
export const MAX_BASELINE_HOURS = 28 * 24;
export const MAX_ENTITY_IDS = 20;

export const windowRefinement = (maxHours: number) => (w: WindowT, ctx: z.RefinementCtx) => {
  const a = Date.parse(w.startAt), b = Date.parse(w.endAt);
  if (!(b > a)) ctx.addIssue({ code: "custom", message: "window.endAt must be after startAt" });
  if (b - a > maxHours * HOUR) ctx.addIssue({ code: "custom", message: `window may not exceed ${maxHours} hours` });
};

/** Every tool input extends this. Scope fields are validated against the investigation; model-supplied values can never widen it. */
export const ToolInputBase = z.object({
  businessId: Scoped,
  simulationRunId: Scoped,
  window: Window.superRefine(windowRefinement(MAX_WINDOW_HOURS)),
  baselineWindow: Window.superRefine(windowRefinement(MAX_BASELINE_HOURS)).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type ToolInputBaseT = z.infer<typeof ToolInputBase>;

export interface Measurement { metric: string; value: number; unit: string; baseline?: number }
export interface SourceRef { collection: string; recordId: string; sourceUrl?: string }
export interface DataSource { collection?: string; externalSource?: string; description: string; origin: DataOrigin }

export interface ToolContext {
  db: Db;
  businessId: string;
  simulationRunId: string;
  investigationId: string;
  /** Latest fully observed hour for the run; no query may read beyond it. */
  cutoff: string;
  catalogue: Map<string, CatalogueLabel>;
  signal?: AbortSignal;
}

/** One logical evidence item produced by a tool; becomes a canonical `Evidence` plus an internal detail record. */
export interface EvidenceDraft {
  key: string;
  category: EvidenceCategory;
  title: string;
  observation: string;
  window?: WindowT;
  measurements: Measurement[];
  sourceRecords: SourceRef[];
  detail: Record<string, unknown>;
  warnings: string[];
  dataOrigin: DataOrigin;
}

export interface ToolResult {
  evidence: EvidenceDraft[];
  resultCount: number;
  warnings: string[];
  /** Explicit statement when a tool legitimately found nothing (never fabricated). */
  emptyResult?: string;
}

export interface EvidenceTool<I extends ToolInputBaseT = ToolInputBaseT> {
  name: ToolName;
  title: string;
  description: string;
  category: EvidenceCategory;
  dataSources: DataSource[];
  input: z.ZodType<I, z.ZodTypeDef, unknown>;
  run(ctx: ToolContext, input: I): Promise<ToolResult>;
}
