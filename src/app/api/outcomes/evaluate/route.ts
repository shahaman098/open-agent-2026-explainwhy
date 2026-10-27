import { executionGuard } from '@/execution/http';
import { readJson } from '@/lib/api';
import { getDb } from '@/lib/mongodb';
import { handleRouteError } from '@/lib/route-helpers';
import { evaluateOutcome } from '@/outcomes/service';

/** On-demand, scoped, read-only measurement. Only assessment records are written. */
export async function POST(request:Request){
  const denied=executionGuard(request);if(denied)return denied;
  try{return Response.json(await evaluateOutcome(await getDb(),await readJson(request)),{headers:{'Cache-Control':'no-store'}})}
  catch(error){return handleRouteError(error,'outcomes/evaluate')}
}
