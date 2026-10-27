import { executionGuard,executionScope } from '@/execution/http';
import { executionSnapshot } from '@/execution/service';
import { getDb } from '@/lib/mongodb';
import { handleRouteError } from '@/lib/route-helpers';
export async function GET(request:Request, ctx:{params:Promise<{id:string}>}) {
 const denied=executionGuard(request); if(denied) return denied;
 try { const {id}=await ctx.params; const scope=executionScope(request,id), db=await getDb();
 return Response.json(await executionSnapshot(db,scope),{headers:{'Cache-Control':'no-store'}});
 } catch(e) {return handleRouteError(e,'plans/executions');}
}
