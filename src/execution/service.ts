import { readCampaign,readOrdersShipping,readStorefront,verifyAction } from '@/adapters';
import { assertAgentScope,dispatchAction } from "@/agents/dispatch";
import type { PlanHandoffT } from "@/execution/types";
import { digest } from '@/intelligence/investigator/store';
import { COLLECTIONS,ensureIndexes } from '@/lib/collections';
import { DELAY_BANNER_MESSAGE } from '@/planner/context';
import { canonicalPlan,plannerHandoff } from '@/planner/service';
import { withRunLock } from '@/simulator/runtime';
import { ActionExecution,ActionOutcome,AgentMission,PlanApproval,type ActionExecutionT,type ActionProposalT } from '@normal/contracts';
import type { Db } from 'mongodb';
import { randomUUID } from 'node:crypto';
import 'server-only';
import { z } from 'zod';
import { readiness,validateGraph } from './dependencies';
import { ExecutionError } from "./errors";

// Adapted from origin/kris: validate-approval, orchestrator and execute-action.
// Canonical contracts + MongoDB + Normal adapters replace the partner storage/tools.
export const EXEC = { approvals: COLLECTIONS.planApprovals, runs: COLLECTIONS.agentRuns, missions: COLLECTIONS.agentMissions, actions: COLLECTIONS.actionExecutions, outcomes: COLLECTIONS.actionOutcomes } as const;
export const ExecutionScope = z.object({ businessId: z.string().regex(/^[a-z0-9_]{1,64}$/), simulationRunId: z.string().regex(/^[a-z0-9_]{1,64}$/), planVersion: z.coerce.number().int().positive() }).strict();
export type ExecutionScopeT = z.infer<typeof ExecutionScope> & {planId:string};
export const ApprovalInput = z.object({ decision: z.enum(['approved','rejected','changes_requested']), approvedActionIds: z.array(z.string()).max(100), comment: z.string().trim().max(2000).optional() }).strict();
export { ExecutionError } from "./errors";
export async function ensureExecutionIndexes(db:Db) {
 await ensureIndexes(db);
 for (const name of [EXEC.approvals,EXEC.runs]) await db.collection(name).createIndex({businessId:1,simulationRunId:1,planId:1,planVersion:1},{unique:true});
 for (const [name,key] of [[EXEC.missions,'missionId'],[EXEC.actions,'idempotencyKey'],[EXEC.outcomes,'executionId']]) await db.collection(name).createIndex({[key]:1},{unique:true});
}
export async function loadExecutable(db:Db, scope:ExecutionScopeT):Promise<PlanHandoffT> {
 const doc = await db.collection(COLLECTIONS.plans).findOne(scope, {projection:{_id:0}});
 if (!doc?.planningJobId) throw new ExecutionError('A scoped, validated planner proposal is required.', 'plan_not_found',404);
 if (doc.status !== 'awaiting_approval') throw new ExecutionError('Submit this plan for approval first.');
 const job = await db.collection(COLLECTIONS.planningJobs).findOne({businessId:scope.businessId,simulationRunId:scope.simulationRunId,jobId:doc.planningJobId});
 if (!job || job.status !== 'submitted' || job.planId !== scope.planId || job.planVersion !== scope.planVersion) throw new ExecutionError('The selected plan version changed.', 'version_mismatch');
 return plannerHandoff(db,doc);
}
async function targetState(db:Db, scope:ExecutionScopeT, action:ActionProposalT) {
 const ctx = {...scope,db};
 assertAgentScope(action);
 if (action.actionType === 'ads.set_daily_budget') {
   const c = await readCampaign(ctx,action.params.campaignId);
   return c && {campaignId:c.campaignId,dailyBudgetMinor:c.dailyBudgetMinor,currency:c.currency,status:c.status,updatedAt:c.updatedAt};
 }
 if (action.actionType === 'customer.send_delay_notice') {
   const orders = await readOrdersShipping(ctx,action.params.orderIds);
   const messages = await db.collection(COLLECTIONS.simulatedMessages).find({businessId:scope.businessId,simulationRunId:scope.simulationRunId,orderId:{$in:action.params.orderIds},deliveryStatus:'sent'},{projection:{_id:0,messageId:1,orderId:1}}).sort({orderId:1}).toArray();
   return {orders:orders.sort((a,b)=>a.orderId.localeCompare(b.orderId)),messages};
 }
 return readStorefront(ctx);
}
async function checkAction(db:Db, scope:ExecutionScopeT, action:ActionProposalT) {
 const ctx = {...scope,db};
 assertAgentScope(action);
 if (action.actionType === 'ads.set_daily_budget') {
   const c = await readCampaign(ctx,action.params.campaignId);
   if (!c || c.status !== 'active' || c.currency !== action.params.currency || c.dailyBudgetMinor <= 0 || Math.abs(action.params.newDailyBudgetMinor / c.dailyBudgetMinor - 1) > .25 || action.params.newDailyBudgetMinor === c.dailyBudgetMinor) throw new ExecutionError('Campaign budget, ownership, currency or status changed.', 'stale_state');
 } else if (action.actionType === 'customer.send_delay_notice') {
   const orders = await readOrdersShipping(ctx,action.params.orderIds), front = await readStorefront(ctx);
   const sent = await db.collection(COLLECTIONS.simulatedMessages).countDocuments({businessId:scope.businessId,simulationRunId:scope.simulationRunId,orderId:{$in:action.params.orderIds},deliveryStatus:'sent'});
   if (action.params.templateId !== 'default' || sent || orders.length !== action.params.orderIds.length || new Set(action.params.orderIds).size !== orders.length || action.params.maxRecipients !== orders.length || orders.length > 200 || orders.some(o=>o.status !== 'placed' || o.shipment?.status !== 'delayed' || o.shipment.shippedAt || Date.parse(o.shipment.promisedAt) > Date.parse(front.virtualTime))) throw new ExecutionError('Notice recipients or shipping state are no longer eligible.', 'stale_state');
 } else if (action.actionType === 'storefront.publish_banner') {
   const front = await readStorefront(ctx), p = action.params;
   if (p.message !== DELAY_BANNER_MESSAGE || p.promoCode || front.activeBanners.length || p.startsAt !== front.virtualTime || Date.parse(p.expiresAt)-Date.parse(p.startsAt) > 48*3600000 || Date.parse(p.expiresAt) <= Date.parse(front.virtualTime)) throw new ExecutionError('Storefront state, banner copy or dates changed.', 'stale_state');
 } else throw new ExecutionError('Unsupported action type.', 'unsupported_action');
}
export async function approvePlan(db:Db, scope:ExecutionScopeT, raw:unknown, principal:string) {
 const input = ApprovalInput.parse(raw); await ensureExecutionIndexes(db);
 return withRunLock(db,scope.businessId,scope.simulationRunId,async()=>{
   if (await db.collection(EXEC.approvals).findOne(scope)) throw new ExecutionError('This immutable version already has a decision. A changed decision requires a new plan version.', 'decision_exists');
   const handoff = await loadExecutable(db,scope); validateGraph(handoff);
   const ids = handoff.plan.actions.map(a=>a.actionId), selected = input.approvedActionIds;
   if (new Set(selected).size !== selected.length || selected.some(id=>!ids.includes(id)) || (input.decision === 'approved' ? !selected.length : selected.length > 0)) throw new ExecutionError('Decision and selected actions disagree.', 'invalid_decision');
   if (handoff.plan.actions.some(a=>selected.includes(a.actionId) && a.dependsOnActionIds.some(id=>!selected.includes(id)))) throw new ExecutionError('Approve required dependencies too.', 'dependency_not_approved');
   const targets:Record<string,string> = {};
   for (const a of handoff.plan.actions.filter(a=>selected.includes(a.actionId))) { await checkAction(db,scope,a); targets[a.actionId] = digest(await targetState(db,scope,a)); }
   const approval = PlanApproval.parse({schemaVersion:1,businessId:scope.businessId, approvalId:`approval_${randomUUID()}`,planId:scope.planId,planVersion:scope.planVersion,decision:input.decision,approvedActionIds:selected,rejectedActionIds:ids.filter(id=>!selected.includes(id)),reviewedByUserId:principal,reviewedAt:new Date().toISOString(),expiresAt:new Date(Math.min(Date.now()+30*60000,Date.parse(handoff.plan.expiresAt))).toISOString(),...(input.comment?{comment:input.comment}:{})});
   await db.collection(EXEC.approvals).insertOne({...scope,approval,handoff,planHash:digest(handoff.plan),targets});
   return approval;
 });
}
export async function executionSnapshot(db:Db, scope:ExecutionScopeT) {
 const [decision,run,missions,executions,outcomes] = await Promise.all([
   db.collection(EXEC.approvals).findOne(scope,{projection:{_id:0}}),db.collection(EXEC.runs).findOne(scope,{projection:{_id:0}}),
   db.collection(EXEC.missions).find(scope,{projection:{_id:0}}).toArray(), db.collection(EXEC.actions).find(scope,{projection:{_id:0}}).toArray(),db.collection(EXEC.outcomes).find(scope,{projection:{_id:0}}).toArray()
 ]);
 return {approval:decision?.approval??null,reviewedHandoff:decision?.handoff??null,run,missions:missions.map(d=>d.mission),executions:executions.map(d=>d.execution),outcomes:outcomes.map(d=>d.outcome)};
}
export async function executePlan(db:Db, scope:ExecutionScopeT, approvalId:string, principal:string) {
 await ensureExecutionIndexes(db);
 return withRunLock(db,scope.businessId,scope.simulationRunId,async()=>{
   if (await db.collection(EXEC.runs).findOne(scope)) throw new ExecutionError('This version already has an execution attempt. Inspect its durable receipts; automatic replay is disabled.', 'duplicate_execution');
   const record = await db.collection(EXEC.approvals).findOne({...scope,'approval.approvalId':approvalId});
   if (!record) throw new ExecutionError('Exact-version approval is required.', 'not_approved');
   const approval = PlanApproval.parse(record.approval);
   if (approval.decision !== 'approved' || approval.reviewedByUserId !== principal || Date.parse(approval.expiresAt) <= Date.now()) throw new ExecutionError('Approval rejected, expired or belongs to a different reviewer.', 'not_approved');
   const h = await loadExecutable(db,scope);
   if (digest(h.plan) !== record.planHash) throw new ExecutionError('Immutable plan changed after review.', 'stale_state');
   validateGraph(h);
   const actions = h.plan.actions.filter(a=>approval.approvedActionIds.includes(a.actionId));
   const startedAt = new Date().toISOString();
   await db.collection(EXEC.runs).insertOne({...scope,runId:`run_${randomUUID()}`,approvalId,status:'running',startedAt});
   const completed = new Map<string,ActionExecutionT>();
   try {
    for (const agent of new Set(actions.map(a=>a.agent))) {
      const mission = AgentMission.parse({schemaVersion:1,businessId:scope.businessId,missionId:`${scope.simulationRunId}:${scope.planId}:v${scope.planVersion}:${agent}`,planId:scope.planId,planVersion:scope.planVersion,agent,actionIds:actions.filter(a=>a.agent===agent).map(a=>a.actionId),goal:`Execute approved ${agent} operations`,status:'running',createdAt:startedAt,updatedAt:startedAt});
      await db.collection(EXEC.missions).insertOne({...scope,missionId:mission.missionId,mission});
    }
    // Dependency ordering from the partner orchestrator; independent actions remain serial
    // so a failed action stops further changes and leaves an inspectable partial result.
    const pending = [...actions]; let failed = false;
    while (pending.length) {
      const index = pending.findIndex(a=>readiness(a,approval.approvedActionIds,completed)==='ready');
      const action = pending.splice(index < 0 ? 0 : index,1)[0];
      const key = `${scope.businessId}:${scope.simulationRunId}:${scope.planId}:v${scope.planVersion}:${action.actionId}`;
      const execution = ActionExecution.parse({schemaVersion:1,businessId:scope.businessId,executionId:`exec_${randomUUID()}`,planId:scope.planId,planVersion:scope.planVersion,approvalId,actionId:action.actionId,missionId:`${scope.simulationRunId}:${scope.planId}:v${scope.planVersion}:${action.agent}`,idempotencyKey:key,status:'running',attempts:1,toolName:action.actionType,dryRun:false,startedAt:new Date().toISOString()});
      await db.collection(EXEC.actions).insertOne({...scope,idempotencyKey:key,execution});
      try {
        if (failed || index < 0) throw new ExecutionError('Stopped after a failed action or unsatisfied dependency.', 'dependency_failed');
        if (Date.parse(approval.expiresAt)<=Date.now() || Date.parse(h.plan.expiresAt)<=Date.now()) throw new ExecutionError('Approval or plan expired.', 'plan_expired');
        const current = await db.collection(COLLECTIONS.plans).findOne(scope,{projection:{_id:0}});
        if (!current || digest(canonicalPlan(current)) !== record.planHash || digest(await targetState(db,scope,action)) !== record.targets[action.actionId]) throw new ExecutionError('Approved target state or plan changed.', 'stale_state');
        await checkAction(db,scope,action);
        const ctx = {...scope,db,actionId:action.actionId,executionId:execution.executionId,idempotencyKey:key};
        const result = await dispatchAction(action,ctx);
        const verified = await verifyAction(ctx,key);
        if (!verified.stateMatches || !verified.callbackEventsPresent) throw new ExecutionError('Adapter read-back did not verify. Review before any further attempt.', 'verification_failed');
        execution.status='succeeded'; execution.result={affectedEntityIds:result.affectedEntityIds,verification:result.verification};
      } catch(e) {
        failed = true; execution.status = e instanceof ExecutionError && e.code === 'dependency_failed' ? 'cancelled' : 'failed';
        execution.error={code:e instanceof ExecutionError?e.code:'adapter_failed',message:e instanceof Error?e.message:'Execution failed',retryable:false};
      }
      execution.finishedAt=new Date().toISOString(); ActionExecution.parse(execution);
      await db.collection(EXEC.actions).updateOne({idempotencyKey:key},{$set:{execution}}); completed.set(action.actionId,execution);
      const outcome=ActionOutcome.parse({schemaVersion:1,businessId:scope.businessId,outcomeId:`out_${execution.executionId}`,executionId:execution.executionId,actionId:action.actionId,status:execution.status==='succeeded'?'verified':'not_verified',observedMetricSnapshotIds:[],summary:execution.result?.verification??execution.error!.message,observedAt:execution.finishedAt});
      await db.collection(EXEC.outcomes).insertOne({...scope,executionId:execution.executionId,outcome});
    }
    for (const doc of await db.collection(EXEC.missions).find(scope).toArray()) {
      const status = doc.mission.actionIds.every((id:string)=>completed.get(id)?.status==='succeeded')?'succeeded':'failed';
      await db.collection(EXEC.missions).updateOne({missionId:doc.missionId},{$set:{'mission.status':status,'mission.updatedAt':new Date().toISOString()}});
    }
    await db.collection(EXEC.runs).updateOne(scope,{$set:{status:failed?'failed':'succeeded',finishedAt:new Date().toISOString()}});
   } catch(e) {
    await db.collection(EXEC.runs).updateOne(scope,{$set:{status:'needs_review',error:e instanceof Error?e.message:'Interrupted',finishedAt:new Date().toISOString()}}); throw e;
   }
   return executionSnapshot(db,scope);
 });
}
