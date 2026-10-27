import {buildSimulatorEvent} from '@/simulator/events';
import {COLLECTIONS} from '@/lib/collections';
import {getDb} from '@/lib/mongodb';
import {approvePlan,executePlan,loadExecutable} from '@/execution/service';
import {evaluateOutcome,outcomeHistory} from '@/outcomes/service';
import {addMinutes} from '@/outcomes/measurement';
import {POST as feedbackRoute} from '@/app/api/outcomes/feedback/route';
import {seedExecutionFixture} from '../execution/fixtures';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import type {Db} from 'mongodb';

const prefix=`stage8_test_${Date.now()}`;let db:Db,n=0;
const seed=(shipping=false)=>seedExecutionFixture(db,`${prefix}_${n++}`,shipping);
const approveExecute=async(scope:Awaited<ReturnType<typeof seed>>)=>{const h=await loadExecutable(db,scope);
 const a=await approvePlan(db,scope,{decision:'approved',approvedActionIds:h.plan.actions.map(x=>x.actionId)},'test_human');
 const snapshot=await executePlan(db,scope,a.approvalId,'test_human');return {h,snapshot}};
const input=(scope:Awaited<ReturnType<typeof seed>>,actionId:string)=>({...scope,actionId});
async function addCampaignHours(scope:Awaited<ReturnType<typeof seed>>,before:Array<[number,number,number]>,after:Array<[number,number,number]>){
 const anchor='2026-10-23T19:00:00.000Z',events=[];
 for(const [side,hours] of [[before,-before.length],[after,0]] as const)for(let i=0;i<side.length;i++){
  const startAt=addMinutes(anchor,(hours+i)*60),endAt=addMinutes(startAt,60),[spendMinor,attributedOrders,attributedRevenueMinor]=side[i];
  events.push(buildSimulatorEvent('ad.metrics_observed',{campaignId:'campaign_A',window:{startAt,endAt},impressions:1000,clicks:20,
    spendMinor,attributedOrders,attributedRevenueMinor,frequency:1,currency:'GBP'},
  {businessId:scope.businessId,simulationRunId:scope.simulationRunId,occurredAt:endAt,receivedAt:new Date(Date.now()+1000).toISOString(),
    sourceRecordId:`${scope.simulationRunId}:stage8_explicit_synthetic_${hours+i}`,ingestMethod:'simulation'}));
 }
 await db.collection(COLLECTIONS.businessEvents).insertMany(events);
 await db.collection(COLLECTIONS.simulatorState).updateOne({businessId:scope.businessId,simulationRunId:scope.simulationRunId},{$set:{virtualTime:addMinutes(anchor,after.length*60)}});
}
async function businessState(scope:Awaited<ReturnType<typeof seed>>){const result=[];for(const name of [COLLECTIONS.simulatorState,COLLECTIONS.simulatedCampaigns,COLLECTIONS.simulatedOrders,COLLECTIONS.simulatedStorefront,COLLECTIONS.simulatedMessages,COLLECTIONS.businessEvents,COLLECTIONS.actionReceipts]){
 result.push([name,await db.collection(name).find({businessId:scope.businessId,simulationRunId:scope.simulationRunId},{projection:{_id:0}}).sort({eventId:1,idempotencyKey:1}).toArray()])}return result}
beforeAll(async()=>{db=await getDb()});
afterAll(async()=>{for(const c of new Set(Object.values(COLLECTIONS)))await db?.collection(c).deleteMany({simulationRunId:{$regex:`^${prefix}`}})});

describe('durable Stage 8 outcome assessment',()=>{
 it('keeps a verified budget action pending with no post-action observations and never mutates business state',async()=>{
  const scope=await seed(),{h}=await approveExecute(scope),actionId=h.plan.actions[0].actionId;
  const before=await businessState(scope),a=await evaluateOutcome(db,input(scope,actionId));
  expect(a.status).toBe('pending_measurement');expect(a.actionApplied).toBe(true);expect(a.targetStateAchieved).toBe(true);
  expect(a.businessEffect).toBe('inconclusive');expect(a.before?.complete).toBe(false);expect(a.after?.coveredMinutes).toBe(0);
  expect(a.receiptEventIds).toHaveLength(1);expect(a.sourceReferences.some(r=>r.collection===COLLECTIONS.actionReceipts)).toBe(true);
  const again=await evaluateOutcome(db,input(scope,actionId));expect(again.assessmentId).toBe(a.assessmentId);
  expect(await db.collection(COLLECTIONS.businessOutcomeAssessments).countDocuments({assessmentId:a.assessmentId})).toBe(1);
  expect(await businessState(scope)).toEqual(before);
 });
 it('records observed improvement from complete synthetic campaign windows, with scoped source events',async()=>{
  const scope=await seed(),{h}=await approveExecute(scope),actionId=h.plan.actions[0].actionId;
  await addCampaignHours(scope,Array(4).fill([100,1,1000]),Array(4).fill([80,1,1200]));const before=await businessState(scope);
  const a=await evaluateOutcome(db,input(scope,actionId));expect(a.status).toBe('completed');expect(a.businessEffect).toBe('improved');
  expect(a.before?.complete).toBe(true);expect(a.after?.complete).toBe(true);expect(a.successCriteriaMet).toBe(true);
  expect(a.before?.metrics.roas).toBe(10);expect(a.after?.metrics.roas).toBe(15);expect(a.sourceReferences.filter(r=>r.collection===COLLECTIONS.businessEvents)).toHaveLength(9);
  expect(await businessState(scope)).toEqual(before);
  const history=await outcomeHistory(db,{businessId:scope.businessId,simulationRunId:scope.simulationRunId});expect(history.counts.measuredImprovement).toBe(1);
  const duplicate=await evaluateOutcome(db,input(scope,actionId));expect(duplicate).toEqual(a);
  const later=await evaluateOutcome(db,{...input(scope,actionId),windowStartAt:addMinutes(a.window.startAt,60)});expect(later.assessmentId).not.toBe(a.assessmentId);expect(later.status).toBe('pending_measurement');
  expect((await db.collection(COLLECTIONS.businessOutcomeAssessments).findOne({assessmentId:a.assessmentId}))?.status).toBe('completed');
 });
 it('reports observed deterioration and refuses incomplete or overlapping windows',async()=>{
  const scope=await seed(),{h}=await approveExecute(scope),actionId=h.plan.actions[0].actionId;
  await addCampaignHours(scope,Array(4).fill([100,1,1000]),Array(4).fill([80,1,200]));
  const a=await evaluateOutcome(db,input(scope,actionId));expect(a.status).toBe('completed');expect(a.businessEffect).toBe('deteriorated');
  expect(a.successCriteriaMet).toBe(true); // lower CPA alone cannot make ROAS improvement true
  await expect(evaluateOutcome(db,{...input(scope,actionId),windowStartAt:addMinutes(a.anchorAt,-60)})).rejects.toThrow('start at or after');
  const gapScope=await seed(),gap=await approveExecute(gapScope);await addCampaignHours(gapScope,Array(4).fill([100,1,1000]),Array(3).fill([80,1,1200]));
  await db.collection(COLLECTIONS.simulatorState).updateOne({simulationRunId:gapScope.simulationRunId},{$set:{virtualTime:addMinutes(a.anchorAt,240)}});
  const insufficient=await evaluateOutcome(db,input(gapScope,gap.h.plan.actions[0].actionId));expect(insufficient.status).toBe('insufficient_data');expect(insufficient.businessEffect).toBe('inconclusive');
 });
 it('rejects foreign scope, absent execution, and preserves multi-action shipping receipts',async()=>{
  const unexecuted=await seed();await expect(evaluateOutcome(db,input(unexecuted,'unknown'))).rejects.toThrow();
  const scope=await seed(true),{h}=await approveExecute(scope);
  await expect(evaluateOutcome(db,{...input(scope,h.plan.actions[0].actionId),businessId:'foreign'})).rejects.toThrow();
  const before=await businessState(scope);
  const notice=await evaluateOutcome(db,input(scope,h.plan.actions[0].actionId));
  const banner=await evaluateOutcome(db,input(scope,h.plan.actions[1].actionId));
  expect(notice.operational).toMatchObject({intendedRecipients:2,reachedRecipients:2,duplicateMessages:0});
  expect(banner.operational.bannerId).toBe(h.plan.actions[1].actionType==='storefront.publish_banner'?h.plan.actions[1].params.bannerId:null);
  expect(notice.targetStateAchieved).toBe(true);expect(banner.targetStateAchieved).toBe(true);
  expect(await businessState(scope)).toEqual(before);
  await db.collection(COLLECTIONS.simulatorState).updateOne({simulationRunId:scope.simulationRunId},{$set:{virtualTime:addMinutes(notice.anchorAt,240)}});
  const final=await evaluateOutcome(db,input(scope,h.plan.actions[0].actionId));expect(final.status).toBe('insufficient_data');expect(final.successCriteriaMet).toBeNull();
  const history=await outcomeHistory(db,{businessId:scope.businessId,simulationRunId:scope.simulationRunId});expect(history.rows).toHaveLength(2);
 });
 it('stores scoped human feedback separately from immutable measured evidence',async()=>{
  const scope=await seed(),{h}=await approveExecute(scope),a=await evaluateOutcome(db,input(scope,h.plan.actions[0].actionId));
  const body={businessId:scope.businessId,simulationRunId:scope.simulationRunId,assessmentId:a.assessmentId,rating:'uncertain',note:'Review attribution before increasing spend.'};
  vi.stubEnv('NODE_ENV','development');
  try{
   const request=(payload:unknown)=>new Request('http://localhost/api/outcomes/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   expect((await feedbackRoute(request(body))).status).toBe(200);
   expect((await feedbackRoute(request(body))).status).toBe(200);
   expect((await feedbackRoute(request({...body,note:'Changed interpretation'}))).status).toBe(409);
   expect((await feedbackRoute(request({...body,simulationRunId:'foreign'}))).status).toBe(404);
   const history=await outcomeHistory(db,{businessId:scope.businessId,simulationRunId:scope.simulationRunId});
   expect(history.rows[0].latest?.feedback).toMatchObject({note:body.note,rating:'uncertain'});
   expect((await db.collection(COLLECTIONS.businessOutcomeAssessments).findOne({assessmentId:a.assessmentId}))?.summary).toBe(a.summary);
  }finally{vi.unstubAllEnvs()}
 });
});
