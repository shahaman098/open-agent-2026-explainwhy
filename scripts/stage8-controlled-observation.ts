/** One isolated approved budget action followed by genuine simulator ticks. No model call. */
import {readFileSync,writeFileSync} from 'node:fs';
import {getDb,getMongoClient} from '../src/lib/mongodb';
import {COLLECTIONS} from '../src/lib/collections';
import {approvePlan,executePlan,EXEC} from '../src/execution/service';
import {getRunSummary,tickRun} from '../src/simulator/runtime';
import {snapshotTickWindows} from '../src/analytics/metrics';
import {evaluateOutcome} from '../src/outcomes/service';
process.loadEnvFile('.env.local');
async function main(){
 const db=await getDb(),artifact=JSON.parse(readFileSync('docs/stage8-runs/controlled-preparation.json','utf8'));
 const scope={businessId:artifact.businessId as string,simulationRunId:artifact.simulationRunId as string,planId:artifact.planId as string,planVersion:artifact.planVersion as number};
 if(!scope.simulationRunId.startsWith('stage8_'))throw new Error('Only a Stage 8 isolated run may be ticked here.');
 const actions=artifact.handoff.plan.actions as Array<{actionId:string;actionType:string}>;
 if(actions.length!==1||actions[0].actionType!=='ads.set_daily_budget')throw new Error('Expected the saved one-action advertising plan.');
 let approval=(await db.collection(EXEC.approvals).findOne(scope))?.approval;
 if(!approval)approval=await approvePlan(db,scope,{decision:'approved',approvedActionIds:[actions[0].actionId],comment:'Explicit isolated Stage 8 controlled simulation'},'stage8_controlled_demo_operator');
 if(!(await db.collection(EXEC.runs).findOne(scope)))await executePlan(db,scope,approval.approvalId,'stage8_controlled_demo_operator');
 const callback=await db.collection(COLLECTIONS.businessEvents).findOne({businessId:scope.businessId,simulationRunId:scope.simulationRunId,type:'campaign.budget_updated','payload.actionId':actions[0].actionId});
 if(!callback)throw new Error('Budget callback missing after controlled execution.');
 const anchor=Date.parse(callback.occurredAt as string),target=new Date(anchor+1800*60_000).toISOString();
 const summary=await getRunSummary(scope.businessId,scope.simulationRunId,db),delta=(Date.parse(target)-Date.parse(summary.run.virtualTime))/60_000;
 if(delta>0){const ticks=Math.ceil(delta/summary.run.minutesPerTick);if(ticks>60)throw new Error('Controlled tick count exceeds the single-call cap.');
  await tickRun({simulationRunId:scope.simulationRunId,ticks},{businessId:scope.businessId,db,
   afterPersist:(state,windows,d)=>snapshotTickWindows(state.businessId,state.simulationRunId,windows,state.virtualTime,d)});
 }
 const a=await evaluateOutcome(db,{...scope,actionId:actions[0].actionId});
 const result={label:'Isolated copy of genuine saved plan. Budget change approved, executed and followed by real deterministic simulator ticks. No provider call or causal claim.',
  ...scope,actionId:a.actionId,assessmentId:a.assessmentId,status:a.status,businessEffect:a.businessEffect,successCriteriaMet:a.successCriteriaMet,
  virtualTime:a.virtualTime,window:a.window,before:a.before,after:a.after,criterionResults:a.criterionResults,summary:a.summary,limitations:a.limitations,
  receiptId:a.receiptId,receiptEventIds:a.receiptEventIds,sourceReferences:a.sourceReferences};
 writeFileSync('docs/stage8-runs/controlled-observation.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({simulationRunId:scope.simulationRunId,status:a.status,effect:a.businessEffect,criteria:a.successCriteriaMet,
  beforeCoverage:a.before?.coveredMinutes,afterCoverage:a.after?.coveredMinutes,before:a.before?.metrics,after:a.after?.metrics}));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await(await getMongoClient()).close()});
