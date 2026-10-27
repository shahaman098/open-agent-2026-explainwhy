import { z } from "zod";
import { campaignBreakdown, computeSnapshots, productBreakdown } from "@/analytics/metrics";
import { businessIdFrom, handleRouteError } from "@/lib/route-helpers";
import { getRunSummary } from "@/simulator/runtime";

const Query = z.object({
  simulationRunId: z.string().min(1).optional(),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).optional(),
  days: z.coerce.number().int().min(1).max(60).default(7),
}).strict();

/**
 * GET /api/metrics/breakdown — UI summary wrapper: whole-window snapshot, daily
 * series, product-level revenue + inventory, and per-campaign arithmetic (CTR,
 * CPA, ROAS). Everything is derived from persisted records.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const businessId = businessIdFrom(request);
    const url = new URL(request.url);
    const q = Query.parse(Object.fromEntries([...url.searchParams.entries()].filter(([k]) => k !== "businessId")));
    const summary = await getRunSummary(businessId, q.simulationRunId ?? null);
    const runId = summary.run.simulationRunId;
    const virtualTime = summary.run.virtualTime;
    const endAt = q.endAt ?? virtualTime;
    const startAt = q.startAt ?? new Date(Math.max(Date.parse(summary.virtualStartAt), Date.parse(endAt) - q.days * 86_400_000)).toISOString();
    if (Date.parse(endAt) <= Date.parse(startAt)) {
      return Response.json({ run: summary.run, window: { startAt, endAt }, total: null, daily: [], hourly: [], products: [], campaigns: [] });
    }
    const base = { businessId, simulationRunId: runId, startAt, endAt, dimension: {}, virtualTime } as const;
    const [total, daily, hourly, products, campaigns] = await Promise.all([
      computeSnapshots({ ...base, bucket: "window" }),
      computeSnapshots({ ...base, bucket: "day" }),
      computeSnapshots({ ...base, bucket: "hour", startAt: new Date(Math.max(Date.parse(startAt), Date.parse(endAt) - 72 * 3_600_000)).toISOString() }),
      productBreakdown(businessId, runId, startAt, endAt),
      campaignBreakdown(businessId, runId, startAt, endAt),
    ]);
    return Response.json({ run: summary.run, window: { startAt, endAt }, total: total[0] ?? null, daily, hourly, products, campaigns });
  } catch (error) {
    return handleRouteError(error, "metrics/breakdown");
  }
}
