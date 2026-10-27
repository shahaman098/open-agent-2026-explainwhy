import { executionGuard } from '@/execution/http';
import { getDb } from '@/lib/mongodb';
import { handleRouteError } from '@/lib/route-helpers';
import { outcomeHistory } from '@/outcomes/service';

export async function GET(request:Request){
  const denied=executionGuard(request);if(denied)return denied;
  try{return Response.json(await outcomeHistory(await getDb(),Object.fromEntries(new URL(request.url).searchParams)),{headers:{'Cache-Control':'no-store'}})}
  catch(error){return handleRouteError(error,'outcomes/list')}
}
