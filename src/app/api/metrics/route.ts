import { z } from "zod";
import { Bucket, MetricsDimension, computeSnapshots, persistSnapshots } from "@/analytics/metrics";
import { businessIdFrom, handleRouteError } from "@/lib/route-helpers";
import { getRunSummary } from "@/simulator/runtime";

const Query = z.object({
  simulationRunId: z.string().min(1).optional(),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).optional(),
  bucket: Bucket.default("window"),
  campaignId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  channel: z.string().min(1).optional(),
  device: z.string().min(1).optional(),
  persist: z.enum(["true", "false"]).default("false"),
  days: z.coerce.number().int().min(1).max(60).default(7),
}).strict();

/**
 * GET /api/metrics?businessId&simulationRunId&startAt&endAt&bucket=window|hour|day&campaignId&productId&channel&device
 * Returns an array of validated MetricSnapshot records (one per bucket) computed
 * from persisted canonical events. Defaults to the last `days` virtual days of the active run.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const businessId = businessIdFrom(request);
    const url = new URL(request.url);
    const raw = Object.fromEntries([...url.searchParams.entries()].filter(([k]) => k !== "businessId"));
    const q = Query.parse(raw);
    const summary = await getRunSummary(businessId, q.simulationRunId ?? null);
    const virtualTime = summary.run.virtualTime;
    const endAt = q.endAt ?? virtualTime;
    const startAt = q.startAt ?? new Date(Math.max(Date.parse(summary.virtualStartAt), Date.parse(endAt) - q.days * 86_400_000)).toISOString();
    if (Date.parse(endAt) <= Date.parse(startAt)) return Response.json([]);
    const dimension = MetricsDimension.parse({ campaignId: q.campaignId, productId: q.productId, channel: q.channel, device: q.device });
    const snapshots = await computeSnapshots({ businessId, simulationRunId: summary.run.simulationRunId, startAt, endAt, bucket: q.bucket, dimension, virtualTime });
    if (q.persist === "true") await persistSnapshots(snapshots);
    return Response.json(snapshots);
  } catch (error) {
    return handleRouteError(error, "metrics");
  }
}
