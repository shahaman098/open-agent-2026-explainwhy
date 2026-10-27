import { z } from "zod";
import { apiError } from "@/lib/api";
import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { getDb } from "@/lib/mongodb";
import { Scope } from "@/intelligence/investigator/schemas";
import { loadVerifiedEvidence } from "@/intelligence/investigator/validation";
import { COLLECTIONS } from "@/lib/collections";
import type { JobDoc } from "@/intelligence/investigator/store";
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = guardDevRoute(request); if (denied) return denied;
  try {
    const values = Object.fromEntries(new URL(request.url).searchParams);
    const evidenceId = z.string().regex(/^[A-Za-z0-9_.-]{1,160}$/).parse(values.evidenceId);
    delete values.evidenceId;
    const scope = Scope.parse({ ...values, investigationId: (await ctx.params).id }), db = await getDb();
    const job = await db.collection<JobDoc>(COLLECTIONS.investigationJobs).findOne(scope);
    if (!job || !job.evidenceIds.includes(evidenceId)) return apiError("not_found", "Evidence not linked to this investigation", 404);
    const result = await loadVerifiedEvidence(db, scope, [evidenceId], job.cutoff);
    if (!result.evidence.length) return apiError("source_unavailable", "Evidence no longer resolves within this scope", 409);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return handleRouteError(e, "investigator/source"); }
}
