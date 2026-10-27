import { z } from 'zod';
import { executionGuard,demoPrincipal } from '@/execution/http';
import { readJson,apiError } from '@/lib/api';
import { COLLECTIONS } from '@/lib/collections';
import { getDb } from '@/lib/mongodb';
import { handleRouteError } from '@/lib/route-helpers';
import { OutcomeScope } from '@/outcomes/schema';

const Input=OutcomeScope.extend({assessmentId:z.string().regex(/^boa_[a-f0-9]{32}$/),rating:z.enum(['helpful','concern','uncertain']),note:z.string().trim().min(1).max(1000)}).strict();
export async function POST(request:Request){
 const denied=executionGuard(request);if(denied)return denied;
 try{
  const input=Input.parse(await readJson(request)),db=await getDb();
  const assessment=await db.collection(COLLECTIONS.businessOutcomeAssessments).findOne({businessId:input.businessId,simulationRunId:input.simulationRunId,assessmentId:input.assessmentId});
  if(!assessment)return apiError('assessment_not_found','Scoped assessment not found.',404);
  const scope={businessId:input.businessId,simulationRunId:input.simulationRunId,assessmentId:input.assessmentId};
  const record={...scope,rating:input.rating,note:input.note,recordedByUserId:demoPrincipal(),recordedAt:new Date().toISOString()};
  try{await db.collection(COLLECTIONS.outcomeFeedback).updateOne(scope,{$setOnInsert:record},{upsert:true})}
  catch(error){if((error as {code?:number}).code!==11000)throw error}
  const saved=await db.collection(COLLECTIONS.outcomeFeedback).findOne(scope,{projection:{_id:0}});
  if(saved?.rating!==record.rating||saved.note!==record.note)return apiError('feedback_exists','This assessment already has operator feedback.',409);
  return Response.json(saved,{headers:{'Cache-Control':'no-store'}});
 }catch(error){return handleRouteError(error,'outcomes/feedback')}
}
