import { apiError } from "@/lib/api";
import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { listInvestigationEvidence } from "@/intelligence/evidence/queries";
import { getDb } from "@/lib/mongodb";
import { campaignDisplayMetadata } from "@/lib/campaign-display-names";

function campaignIds(detail: Record<string, unknown> | null): string[] {
  return Array.isArray(detail?.campaigns) ? detail.campaigns.flatMap((row) => row && typeof row === "object" && "campaignId" in row && typeof row.campaignId === "string" ? [row.campaignId] : []) : [];
}

/**
 * GET /api/investigations/:id/evidence?businessId&simulationRunId&tool&category&dataOrigin&from&to&limit&offset
 * Canonical Evidence records for a scoped investigation with each item's tool, data origin, detail and verification.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/investigations/[id]/evidence">): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    if (!/^[A-Za-z0-9_.-]{1,160}$/.test(id)) return apiError("validation_error", "Invalid investigation id", 400);
    const result = await listInvestigationEvidence(id, Object.fromEntries(new URL(request.url).searchParams));
    if (!result) return apiError("investigation_not_found", `Investigation ${id} not found`, 404);
    const ids = [...new Set(result.items.flatMap((item) => campaignIds(item.detail)))];
    if (!ids.length) return Response.json(result);
    const metadata = await campaignDisplayMetadata(await getDb(), result.businessId, result.simulationRunId, ids);
    return Response.json({ ...result, items: result.items.map((item) => ({ ...item,
      campaignMetadata: campaignIds(item.detail).flatMap((campaignId) => metadata.has(campaignId) ? [metadata.get(campaignId)!] : []),
    })) });
  } catch (error) {
    return handleRouteError(error, "investigations/evidence");
  }
}
