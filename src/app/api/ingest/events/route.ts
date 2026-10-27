import { apiError, readJson } from "@/lib/api";
import { isIngestAuthorised } from "@/lib/env";
import { handleRouteError } from "@/lib/route-helpers";
import { ingestBatch } from "@/ingestion/service";

/**
 * POST /api/ingest/events — canonical IngestBatch → IngestResult.
 * Authorisation: development, demo key, or `Authorization: Bearer <NORMAL_INGEST_API_KEY>`.
 * Business scoping: optional `?businessId=` restricts the batch to one tenant.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isIngestAuthorised(request)) return apiError("unauthorised", "Ingest credentials required", 401);
  try {
    const body = await readJson(request);
    const scope = new URL(request.url).searchParams.get("businessId") ?? undefined;
    const outcome = await ingestBatch(body, { businessId: scope });
    if (outcome.rejections.some((r) => r.index === -1)) {
      return apiError("validation_error", outcome.rejections[0].reason, 400);
    }
    return Response.json(outcome.result, { headers: outcome.rejections.length ? { "x-normal-rejections": JSON.stringify(outcome.rejections.slice(0, 20)) } : {} });
  } catch (error) {
    return handleRouteError(error, "ingest/events");
  }
}
