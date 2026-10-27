import { z } from "zod";
export const PRESENTATION_RENDERER_VERSION = "4";
const Text = z.string().max(240);
export const PresentationChart = z.object({
  title: Text.min(1), subtitle: Text.optional(), kind: z.enum(["bar", "line", "gauge", "comparison"]), unit: z.string().max(40).default("count"),
  series: z.array(z.object({ name: z.string().max(80), points: z.array(z.object({ label: z.string().max(100), value: z.number().finite().min(-1e12).max(1e12).nullable(), x: z.number().finite().optional() })).min(1).max(200) })).min(1).max(4),
  baseline: z.number().finite().min(-1e12).max(1e12).optional(), source: Text.optional(),
  sourceUrl: z.string().url().max(500).optional(),
  summary: z.object({ label: z.string().max(60), value: z.number().finite().min(-1e12).max(1e12) }).optional(),
}).superRefine((chart, ctx) => {
  if (chart.kind === "gauge" && (chart.series.length !== 1 || chart.series[0].points.length !== 1 || chart.series[0].points.some(point => point.value !== null && (point.value < 0 || point.value > 100)))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A risk gauge needs one observed score between 0 and 100" });
});
export const Presentation = z.object({ title: Text.min(1), subtitle: Text.optional(), charts: z.array(PresentationChart).min(1).max(8), synthetic: z.boolean().default(true) });
export const ExportRequest = z.object({
  scope: z.object({ businessId: z.string().regex(/^[a-z0-9_]{1,64}$/), simulationRunId: z.string().regex(/^[a-z0-9_]{1,64}$/) }),
  presentation: Presentation, theme: z.enum(["midnight", "paper"]).default("midnight"), duration: z.union([z.literal(8), z.literal(12), z.literal(20), z.literal(60)]).default(12), resolution: z.enum(["1080p", "4k"]).default("1080p"),
}).strict();
export type ChartSpec = z.infer<typeof PresentationChart>;
export type PresentationSpec = z.infer<typeof Presentation>;
export type PresentationExport = z.infer<typeof ExportRequest>;
export interface PresentationJob { id: string; status: "queued" | "rendering" | "complete" | "failed"; progress: number; createdAt: string; updatedAt: string; error?: string; request: PresentationExport }
export function hasValues(presentation: PresentationSpec) { return presentation.charts.some(chart => chart.series.some(series => series.points.some(point => point.value !== null))); }
