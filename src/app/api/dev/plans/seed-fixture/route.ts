import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PlanHandoff } from "@normal/contracts";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { guardDevRoute, handleRouteError } from "@/lib/route-helpers";

/**
 * POST /api/dev/plans/seed-fixture — loads packages/contracts/examples/plan-handoff.json
 * into MongoDB so the partner can exercise GET /api/plans/plan_001 before the
 * intelligence stage produces real plans. Dev/demo only.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    const raw = JSON.parse(readFileSync(resolve(process.cwd(), "packages/contracts/examples/plan-handoff.json"), "utf8"));
    const handoff = PlanHandoff.parse(raw);
    const db = await getDb();
    await ensureIndexes(db);
    await db.collection(COLLECTIONS.plans).replaceOne({ businessId: handoff.plan.businessId, planId: handoff.plan.planId, planVersion: handoff.plan.planVersion }, handoff.plan, { upsert: true });
    await db.collection(COLLECTIONS.diagnoses).replaceOne({ businessId: handoff.diagnosis.businessId, diagnosisId: handoff.diagnosis.diagnosisId }, handoff.diagnosis, { upsert: true });
    for (const e of handoff.evidence) {
      await db.collection(COLLECTIONS.evidence).replaceOne({ businessId: e.businessId, evidenceId: e.evidenceId }, e, { upsert: true });
    }
    return Response.json({ seeded: true, planId: handoff.plan.planId, planVersion: handoff.plan.planVersion, evidence: handoff.evidence.length });
  } catch (error) {
    return handleRouteError(error, "plans/seed-fixture");
  }
}
