import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { COLLECTIONS } from '@/lib/collections';
import { handleRouteError } from '@/lib/route-helpers';
import { canonicalPlan } from '@/planner/service';
import { executionSnapshot } from '@/execution/service';
import { executionGuard } from '@/execution/http';
export async function GET(request:Request) {
 const denied=executionGuard(request); if(denied) return denied;
 try {
 const scope=z.object({businessId:z.string().regex(/^[a-z0-9_]{1,64}$/),simulationRunId:z.string().regex(/^[a-z0-9_]{1,64}$/)}).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
 const db=await getDb();
 const docs=await db.collection(COLLECTIONS.plans).find({...scope,status:'awaiting_approval',planningJobId:{$exists:true}},{projection:{_id:0}}).sort({createdAt:-1,planVersion:-1}).limit(100).toArray();
 const plans=[];
 for(const doc of docs) plans.push({plan:canonicalPlan(doc),...await executionSnapshot(db,{...scope,planId:doc.planId,planVersion:doc.planVersion})});
 return Response.json({plans},{headers:{'Cache-Control':'no-store'}});
 } catch(e) {return handleRouteError(e,'approvals/list');}
}
