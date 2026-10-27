import { PlanHandoff, planReferenceErrors, type DiagnosisT, type EvidenceT, type ProposedPlanT } from "@normal/contracts";
import { apiError } from "@/lib/api";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/route-helpers";
import { plannerHandoff } from "@/planner/service";
import { z } from "zod";

/**
 * GET /api/plans/:id — canonical PlanHandoff `{ plan, diagnosis, evidence }` for
 * the partner's approval/execution module. Reads the latest persisted plan
 * version plus its diagnosis and evidence; validates before returning.
 * Planning records retain run metadata outside the canonical handoff.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/plans/[id]">): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const query = z.object({ businessId: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(), simulationRunId: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(), planVersion: z.coerce.number().int().positive().optional() }).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
    const db = await getDb();
    const doc = await db.collection(COLLECTIONS.plans).find({ planId: id, ...query }, { projection: { _id: 0 } }).sort({ planVersion: -1 }).limit(1).next();
    if (doc?.planningJobId) return Response.json(await plannerHandoff(db, doc), { headers: { "Cache-Control": "no-store" } });
    const plan = doc as ProposedPlanT | null;
    if (!plan) return apiError("plan_not_found", `Plan ${id} not found`, 404);
    const [diagnosis, evidence] = await Promise.all([
      db.collection<DiagnosisT>(COLLECTIONS.diagnoses).findOne({ businessId: plan.businessId, diagnosisId: plan.diagnosisId }, { projection: { _id: 0 } }),
      db.collection<EvidenceT>(COLLECTIONS.evidence).find({ businessId: plan.businessId, investigationId: plan.investigationId }, { projection: { _id: 0 } }).toArray(),
    ]);
    if (!diagnosis) return apiError("diagnosis_not_found", `Diagnosis ${plan.diagnosisId} for plan ${id} not found`, 404);
    const handoff = PlanHandoff.parse({ plan, diagnosis, evidence });
    const errors = planReferenceErrors(handoff.plan, handoff.diagnosis, handoff.evidence);
    if (errors.length) return apiError("invalid_plan_references", errors.join("; "), 500);
    return Response.json(handoff);
  } catch (error) {
    return handleRouteError(error, "plans/get");
  }
}
