import 'server-only';
import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';
import { PlanHandoff, ActionExecution, ActionOutcome, type ActionProposalT } from '@normal/contracts';
import { verifyAction } from '@/adapters';
import type { ActionReceipt } from '@/adapters/_shared';
import { COLLECTIONS, ensureIndexes } from '@/lib/collections';
import { getRunSummary } from '@/simulator/runtime';
import { digest } from '@/intelligence/investigator/store';
import { canonicalPlan } from '@/planner/service';
import { ExecutionError } from '@/execution/errors';
import { addMinutes, classifyAdvertising, observeAds, scoreCriterion, type AdObservationEvent } from './measurement';
import { BusinessOutcomeAssessment, EvaluateInput, OutcomeScope, type BusinessOutcomeAssessmentT, type EvaluateInputT } from './schema';

type Scope = Pick<EvaluateInputT,'businessId'|'simulationRunId'>;
const col=COLLECTIONS.businessOutcomeAssessments;
const ms=(s:string)=>Date.parse(s);
function assessmentId(input:EvaluateInputT,startAt:string){return `boa_${createHash('sha256').update(JSON.stringify([input.businessId,input.simulationRunId,input.planId,input.planVersion,input.actionId,startAt])).digest('hex').slice(0,32)}`}

async function source(db:Db,input:EvaluateInputT){
  const planScope={businessId:input.businessId,simulationRunId:input.simulationRunId,planId:input.planId,planVersion:input.planVersion};
  const approval=await db.collection(COLLECTIONS.planApprovals).findOne(planScope);
  if(!approval?.handoff||approval.approval?.decision!=='approved'||!approval.approval.approvedActionIds.includes(input.actionId))throw new ExecutionError('An approved exact plan/action version is required.','not_approved');
  const handoff=PlanHandoff.parse(approval.handoff),action=handoff.plan.actions.find(a=>a.actionId===input.actionId);
  if(!action||handoff.plan.planId!==input.planId||handoff.plan.planVersion!==input.planVersion||handoff.plan.businessId!==input.businessId)throw new ExecutionError('Reviewed handoff does not match the requested action.','invalid_source');
  const plan=await db.collection(COLLECTIONS.plans).findOne(planScope);
  if(!plan||digest(canonicalPlan(plan))!==approval.planHash)throw new ExecutionError('The original reviewed plan no longer matches.','invalid_source');
  const executionDoc=await db.collection(COLLECTIONS.actionExecutions).findOne({...planScope,'execution.actionId':input.actionId});
  if(!executionDoc)throw new ExecutionError('No execution exists for this exact action.','execution_not_found');
  const execution=ActionExecution.parse(executionDoc.execution);
  if(execution.status!=='succeeded'||execution.dryRun||execution.approvalId!==approval.approval.approvalId)throw new ExecutionError('A successful real execution is required.','execution_not_succeeded');
  if(!execution.startedAt||!execution.finishedAt)throw new ExecutionError('Execution timestamps are missing.','invalid_source');
  const immediateDoc=await db.collection(COLLECTIONS.actionOutcomes).findOne({...planScope,executionId:execution.executionId});
  const immediate=immediateDoc?ActionOutcome.parse(immediateDoc.outcome):null;
  if(immediate?.status!=='verified')throw new ExecutionError('Immediate execution verification is missing.','execution_not_verified');
  const receipt=await db.collection<ActionReceipt>(COLLECTIONS.actionReceipts).findOne({businessId:input.businessId,simulationRunId:input.simulationRunId,idempotencyKey:execution.idempotencyKey,actionId:input.actionId,toolName:action.actionType},{projection:{_id:0}});
  if(!receipt||!receipt.emittedEventIds.length)throw new ExecutionError('The durable action receipt is missing.','receipt_not_found');
  if(ms(receipt.recordedAt)<ms(execution.startedAt)||ms(receipt.recordedAt)>ms(execution.finishedAt))throw new ExecutionError('Receipt timestamp falls outside the execution.','invalid_source');
  const callbacks=await db.collection(COLLECTIONS.businessEvents).find({businessId:input.businessId,simulationRunId:input.simulationRunId,eventId:{$in:receipt.emittedEventIds},'payload.actionId':input.actionId},{projection:{_id:0}}).toArray();
  if(callbacks.length!==receipt.emittedEventIds.length||callbacks.some(e=>ms(e.receivedAt as string)<ms(execution.startedAt!)||ms(e.receivedAt as string)>ms(execution.finishedAt!)))throw new ExecutionError('Scoped action callback references are incomplete or outside execution.','invalid_source');
  const anchorAt=new Date(Math.max(...callbacks.map(e=>ms(e.occurredAt as string)))).toISOString();
  if(!Number.isFinite(ms(anchorAt)))throw new ExecutionError('Action callback lacks a simulation timestamp.','invalid_source');
  const planningJob=plan.planningJobId?await db.collection(COLLECTIONS.planningJobs).findOne({businessId:input.businessId,simulationRunId:input.simulationRunId,jobId:plan.planningJobId}):null;
  const strategyKey=(planningJob?.history as Array<{planId:string;planVersion:number;strategyKey:string}>|undefined)?.find(h=>h.planId===input.planId&&h.planVersion===input.planVersion)?.strategyKey??null;
  return {handoff,action,execution,receipt,callbacks,anchorAt,approvalId:approval.approval.approvalId as string,strategyKey};
}

async function adWindow(db:Db,scope:Scope,campaignId:string,window:{startAt:string;endAt:string},virtualTime:string,minReceivedAt?:string){
  const events=await db.collection(COLLECTIONS.businessEvents).find({...scope,type:'ad.metrics_observed','payload.campaignId':campaignId,
    'payload.window.startAt':{$gte:window.startAt,$lt:window.endAt},...(minReceivedAt?{receivedAt:{$gte:minReceivedAt}}:{})},{projection:{_id:0}}).sort({receivedAt:1,eventId:1}).limit(2000).toArray();
  const snapshots=await db.collection(COLLECTIONS.metricSnapshots).find({...scope,'dimension.campaignId':campaignId,
    'window.startAt':{$gte:window.startAt},'window.endAt':{$lte:window.endAt},completeness:'complete'},
    {projection:{_id:0,snapshotId:1}}).limit(2000).toArray();
  return observeAds(events as unknown as AdObservationEvent[],window,virtualTime,snapshots.map(s=>s.snapshotId as string));
}

async function assess(db:Db,input:EvaluateInputT,base:BusinessOutcomeAssessmentT,src:Awaited<ReturnType<typeof source>>):Promise<BusinessOutcomeAssessmentT>{
  const run=await getRunSummary(input.businessId,input.simulationRunId,db),virtualTime=run.run.virtualTime;
  const now=new Date().toISOString(),scope={businessId:input.businessId,simulationRunId:input.simulationRunId};
  const report=await verifyAction({...scope,db},src.execution.idempotencyKey);
  const applied=report.found&&report.callbackEventsPresent===true;
  const operational:Record<string,string|number|boolean|null>={currentTargetMatches:report.stateMatches,callbackEventsPresent:report.callbackEventsPresent};
  let targetStateAchieved:boolean|null=applied, before:BusinessOutcomeAssessmentT['before']=null,after:BusinessOutcomeAssessmentT['after']=null;
  let businessEffect:BusinessOutcomeAssessmentT['businessEffect']='inconclusive';
  let status:BusinessOutcomeAssessmentT['status']=ms(virtualTime)<ms(base.window.endAt)?'pending_measurement':'insufficient_data';
  let summary='';const limitations:string[]=[];
  let beforeValue:number|null=null,afterValue:number|null=null,currency:string|null=null;
  const refs:Array<{collection:string;recordId:string}>=[...src.receipt.emittedEventIds.map(recordId=>({collection:COLLECTIONS.businessEvents,recordId})),{collection:COLLECTIONS.actionReceipts,recordId:src.receipt.idempotencyKey},
    {collection:COLLECTIONS.actionExecutions,recordId:src.execution.executionId}];
  const criterionResults:BusinessOutcomeAssessmentT['criterionResults']=[];
  if(src.action.actionType==='ads.set_daily_budget'){
    const event=src.callbacks.find(e=>e.type==='campaign.budget_updated');
    if(!event||event.payload.campaignId!==src.action.params.campaignId||event.payload.newDailyBudgetMinor!==src.action.params.newDailyBudgetMinor)throw new ExecutionError('Budget callback and reviewed action disagree.','invalid_source');
    beforeValue=event.payload.previousDailyBudgetMinor;afterValue=event.payload.newDailyBudgetMinor;currency=event.payload.currency;
    operational.campaignId=src.action.params.campaignId;operational.budgetBeforeMinor=beforeValue;operational.budgetAfterMinor=afterValue;
    targetStateAchieved=applied; // Immediate canonical ActionOutcome already verified the applied budget.
    // Immediate receipt proves application. A later change to the target does not erase the historical write.
    if(applied&&report.stateMatches===false)limitations.push('The current campaign budget differs from the executed receipt; the original action remains recorded.');
    const campaignId=src.action.params.campaignId;
    before=await adWindow(db,scope,campaignId,base.beforeWindow,virtualTime);
    after=await adWindow(db,scope,campaignId,base.window,virtualTime,src.receipt.recordedAt);
    for(const criterion of base.successCriteria){
      const preWindow={startAt:addMinutes(base.anchorAt,-criterion.measurementWindowMinutes),endAt:base.anchorAt};
      const postWindow={startAt:base.window.startAt,endAt:addMinutes(base.window.startAt,criterion.measurementWindowMinutes)};
      const pair=criterion.measurementWindowMinutes===before.requiredMinutes?{pre:before,post:after}:{
        pre:await adWindow(db,scope,campaignId,preWindow,virtualTime),post:await adWindow(db,scope,campaignId,postWindow,virtualTime,src.receipt.recordedAt)};
      criterionResults.push(scoreCriterion(criterion.metric,criterion.direction,criterion.target,pair.pre,pair.post));
    }
    for(const eventId of [...before.eventIds,...after.eventIds])refs.push({collection:COLLECTIONS.businessEvents,recordId:eventId});
    for(const snapshotId of [...before.snapshotIds,...after.snapshotIds])refs.push({collection:COLLECTIONS.metricSnapshots,recordId:snapshotId});
    if(status!=='pending_measurement'){
      if(!before.complete||!after.complete){limitations.push('The same campaign needs complete, nonoverlapping observations across both equal-length windows.');}
      else{
        businessEffect=classifyAdvertising(before,after);
        if(businessEffect!=='inconclusive')status='completed';
        else limitations.push('ROAS has a zero-spend denominator; an observed business effect cannot be classified.');
      }
    }
    if(before.metrics.attributedOrders===0||after.metrics.attributedOrders===0)limitations.push('Zero attributed orders make campaign cost per acquisition unavailable in that window.');
    limitations.push('Observed campaign changes are associations. The simulator paces spend against budget; CTR and orders also depend on audience, scenario and random variation.');
    summary=status==='pending_measurement'?'Budget change verified; awaiting a full post-action campaign window.'
      :status==='completed'?`Comparable campaign windows show ${businessEffect} observed return; causal attribution is not established.`
      :'Budget change verified; comparable post-action business evidence is insufficient.';
  }else if(src.action.actionType==='customer.send_delay_notice'){
    const intended=src.action.params.orderIds,reached=new Set(src.callbacks.filter(e=>e.type==='customer.message_sent'&&e.payload.deliveryStatus==='sent').map(e=>e.payload.orderId as string));
    const messages=await db.collection(COLLECTIONS.simulatedMessages).find({...scope,orderId:{$in:intended},actionId:input.actionId},{projection:{_id:0}}).toArray();
    const duplicateOrders=messages.length-new Set(messages.map(m=>m.orderId)).size;
    operational.intendedRecipients=intended.length;operational.reachedRecipients=reached.size;operational.duplicateMessages=duplicateOrders;
    targetStateAchieved=applied&&report.stateMatches===true&&reached.size===intended.length&&intended.every(id=>reached.has(id))&&duplicateOrders===0;
    if(!targetStateAchieved)status='failed';
    limitations.push('A test-inbox notice verifies delivery only. This run has no comparable, linked recipient cohort for later shipping or support impact.');
    summary=targetStateAchieved?`Notices reached ${reached.size}/${intended.length} intended simulated recipients; business impact is unmeasured.`:'Notice delivery or recipient verification failed.';
  }else if(src.action.actionType==='storefront.publish_banner'){
    const banner=await db.collection(COLLECTIONS.simulatedStorefront).findOne({...scope,'banners.bannerId':src.action.params.bannerId},{projection:{_id:0,banners:1}});
    const bannerId=src.action.params.bannerId;
    const saved=(banner?.banners as Array<{bannerId:string;message:string;startsAt:string;expiresAt:string}>|undefined)?.find(b=>b.bannerId===bannerId);
    targetStateAchieved=applied&&!!saved&&saved.message===src.action.params.message&&saved.startsAt===src.action.params.startsAt&&saved.expiresAt===src.action.params.expiresAt;
    operational.bannerId=src.action.params.bannerId;operational.scheduledFrom=src.action.params.startsAt;operational.scheduledTo=src.action.params.expiresAt;
    operational.visibleAtVirtualTime=!!saved&&virtualTime>=saved.startsAt&&virtualTime<saved.expiresAt;
    if(!targetStateAchieved)status='failed';
    limitations.push('Publication and scheduled visibility are verified; conversion or order changes cannot be assigned to this banner without a comparable exposed cohort.');
    summary=targetStateAchieved?'Banner publication verified; downstream conversion impact is unmeasured.':'Banner publication verification failed.';
  }else throw new ExecutionError('Outcome evaluation does not support this action.','unsupported_action');
  if(!criterionResults.length)for(const criterion of base.successCriteria)criterionResults.push({metric:criterion.metric,direction:criterion.direction,target:criterion.target??null,
    before:null,after:null,met:null,reason:'No comparable, action-linked business cohort exists for this operational action.'});
  if(!applied){status='failed';limitations.unshift('Action receipt callbacks no longer verify.');}
  const known=criterionResults.length===base.successCriteria.length&&criterionResults.every(c=>c.met!==null);
  const result=BusinessOutcomeAssessment.parse({...base,status,businessEffect,actionApplied:applied,targetStateAchieved,
    successCriteriaMet:known?criterionResults.every(c=>c.met):null,criterionResults,beforeValue,afterValue,currency,before,after,
    virtualTime,sourceReferences:[...new Map(refs.map(r=>[`${r.collection}:${r.recordId}`,r])).values()],operational,summary,limitations,
    updatedAt:now,evaluatedAt:status==='pending_measurement'?null:now,error:null});
  return result;
}

export async function evaluateOutcome(db:Db,raw:unknown):Promise<BusinessOutcomeAssessmentT>{
  const input=EvaluateInput.parse(raw);await ensureIndexes(db);
  const src=await source(db,input);
  const duration=Math.max(...src.handoff.plan.successCriteria.map(c=>c.measurementWindowMinutes));
  if(duration>60*24*60)throw new ExecutionError('Measurement windows longer than 60 virtual days are unsupported.','invalid_window',400);
  const startAt=input.windowStartAt?new Date(input.windowStartAt).toISOString():src.anchorAt;
  if(ms(startAt)<ms(src.anchorAt)||ms(startAt)>ms(src.anchorAt)+90*86_400_000)throw new ExecutionError('Measurement must start at or after the action, within 90 virtual days.','invalid_window',400);
  const endAt=addMinutes(startAt,duration),beforeStart=addMinutes(src.anchorAt,-duration);
  const id=assessmentId(input,startAt),now=new Date().toISOString(),run=await getRunSummary(input.businessId,input.simulationRunId,db);
  const base=BusinessOutcomeAssessment.parse({schemaVersion:1,assessmentId:id,businessId:input.businessId,simulationRunId:input.simulationRunId,
    planId:input.planId,planVersion:input.planVersion,investigationId:src.handoff.plan.investigationId,diagnosisId:src.handoff.plan.diagnosisId,
    approvalId:src.approvalId,executionId:src.execution.executionId,actionId:input.actionId,idempotencyKey:src.execution.idempotencyKey,
    actionType:src.action.actionType,actionTitle:src.action.title,targetId:src.action.actionType==='ads.set_daily_budget'?src.action.params.campaignId:src.action.actionType==='storefront.publish_banner'?src.action.params.bannerId:null,
    strategy:src.handoff.plan.objective,strategyKey:src.strategyKey,diagnosis:src.handoff.diagnosis.summary,status:'pending_measurement',businessEffect:'inconclusive',
    actionApplied:true,targetStateAchieved:null,successCriteriaMet:null,successCriteria:src.handoff.plan.successCriteria,criterionResults:[],
    beforeValue:null,afterValue:null,currency:null,before:null,after:null,
    window:{startAt,endAt},beforeWindow:{startAt:beforeStart,endAt:src.anchorAt},anchorAt:src.anchorAt,virtualTime:run.run.virtualTime,
    receiptId:src.receipt.idempotencyKey,receiptEventIds:src.receipt.emittedEventIds,sourceReferences:[],operational:{},
    summary:'Awaiting measurement.',limitations:[],createdAt:now,updatedAt:now,evaluatedAt:null,error:null});
  const collection=db.collection<BusinessOutcomeAssessmentT & {leaseUntil?:Date}>(col);
  try{await collection.updateOne({assessmentId:id},{$setOnInsert:base},{upsert:true})}
  catch(error){if((error as {code?:number}).code!==11000)throw error} // Another evaluator claimed the same immutable key.
  const existing=await collection.findOne({assessmentId:id},{projection:{_id:0,leaseUntil:0}});
  if(!existing)throw new ExecutionError('Assessment could not be loaded.');
  if(['completed','insufficient_data'].includes(existing.status))return BusinessOutcomeAssessment.parse(existing);
  if(existing.status==='pending_measurement'&&existing.virtualTime===run.run.virtualTime&&existing.sourceReferences.length)return BusinessOutcomeAssessment.parse(existing);
  const eligible={$or:[{status:{$in:['pending_measurement','ready_to_evaluate','failed'] as const}},{status:'evaluating' as const,leaseUntil:{$lte:new Date()}}]};
  if(ms(run.run.virtualTime)>=ms(endAt))await collection.updateOne({assessmentId:id,status:'pending_measurement'},{$set:{status:'ready_to_evaluate'}});
  const claimed=await collection.findOneAndUpdate({assessmentId:id,...eligible},{$set:{status:'evaluating',leaseUntil:new Date(Date.now()+120_000)}},{returnDocument:'after'});
  if(!claimed)return BusinessOutcomeAssessment.parse(existing);
  try{
    const result=await assess(db,input,base,src);
    await collection.updateOne({assessmentId:id,status:'evaluating'},{$set:{...result},$unset:{leaseUntil:''}});
    return result;
  }catch(error){
    await collection.updateOne({assessmentId:id,status:'evaluating'},{$set:{status:'failed',error:error instanceof Error?error.message:'Evaluation failed',updatedAt:new Date().toISOString()},$unset:{leaseUntil:''}});
    throw error;
  }
}

export async function outcomeHistory(db:Db,raw:unknown){
  const scope=OutcomeScope.extend({investigationId:OutcomeScope.shape.simulationRunId.optional()}).parse(raw);
  const filter={businessId:scope.businessId,simulationRunId:scope.simulationRunId};
  const [executions,assessments,approvals,feedback,receipts]=await Promise.all([
    db.collection(COLLECTIONS.actionExecutions).find(filter,{projection:{_id:0,execution:1,planId:1,planVersion:1}}).sort({'execution.startedAt':-1}).limit(100).toArray(),
    db.collection(col).find(filter,{projection:{_id:0,leaseUntil:0}}).sort({createdAt:-1}).limit(300).toArray(),
    db.collection(COLLECTIONS.planApprovals).find(filter,{projection:{_id:0,planId:1,planVersion:1,handoff:1}}).limit(100).toArray(),
    db.collection(COLLECTIONS.outcomeFeedback).find(filter,{projection:{_id:0}}).limit(300).toArray(),
    db.collection(COLLECTIONS.actionReceipts).find(filter,{projection:{_id:0}}).limit(300).toArray(),
  ]);
  const byPlan=new Map(approvals.map(a=>[`${a.planId}:v${a.planVersion}`,a.handoff]));
  const byReceipt=new Map(receipts.map(r=>[r.idempotencyKey as string,r]));
  const feedbackByAssessment=new Map(feedback.map(f=>[f.assessmentId as string,f]));
  const rows=executions.flatMap(doc=>{
    const execution=ActionExecution.parse(doc.execution);
    if(execution.status!=='succeeded')return [];
    const handoff=byPlan.get(`${execution.planId}:v${execution.planVersion}`);
    if(!handoff)return [];
    const plan=PlanHandoff.parse(handoff).plan,action=plan.actions.find((a:ActionProposalT)=>a.actionId===execution.actionId);
    if(!action||scope.investigationId&&plan.investigationId!==scope.investigationId)return [];
    const history=assessments.filter(a=>a.executionId===execution.executionId).map(a=>({...BusinessOutcomeAssessment.parse(a),feedback:feedbackByAssessment.get(a.assessmentId)??null}));
    return [{execution,receipt:byReceipt.get(execution.idempotencyKey)??null,plan:{planId:plan.planId,planVersion:plan.planVersion,investigationId:plan.investigationId,objective:plan.objective,summary:plan.summary,successCriteria:plan.successCriteria},
      action,latest:history[0]??null,history}];
  });
  return {businessId:scope.businessId,simulationRunId:scope.simulationRunId,rows,
    counts:{actionsExecuted:rows.length,awaitingMeasurement:rows.filter(r=>!r.latest||r.latest.status==='pending_measurement'||r.latest.status==='ready_to_evaluate'||r.latest.status==='evaluating').length,
      measuredImprovement:rows.filter(r=>r.latest?.status==='completed'&&r.latest.businessEffect==='improved').length,
      noObservedImprovement:rows.filter(r=>r.latest?.status==='completed'&&['unchanged','deteriorated'].includes(r.latest.businessEffect)).length,
      inconclusiveOrFailed:rows.filter(r=>r.latest&&['insufficient_data','failed'].includes(r.latest.status)).length}};
}
