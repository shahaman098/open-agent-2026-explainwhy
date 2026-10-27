import { demoPrincipal,executionGuard,executionScope } from '@/execution/http';
import { executePlan } from '@/execution/service';
import { readJson } from '@/lib/api';
import { getDb } from '@/lib/mongodb';
import { handleRouteError } from '@/lib/route-helpers';
import { z } from 'zod';
export async function POST(request:Request, ctx:{params:Promise<{id:string}>}) {
 const denied=executionGuard(request); if(denied) return denied;
 try { const {id}=await ctx.params; const scope=executionScope(request,id), db=await getDb();
 return Response.json(await executePlan(db,scope,z.object({approvalId:z.string().min(1)}).strict().parse(await readJson(request)).approvalId,demoPrincipal()),{headers:{'Cache-Control':'no-store'}});
 } catch(e) {return handleRouteError(e,'plans/execute');}
}
