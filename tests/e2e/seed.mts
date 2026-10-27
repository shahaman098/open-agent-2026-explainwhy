/** Deterministic browser fixtures in a dedicated database. No provider requests. */
import { readFileSync } from 'node:fs';
import type { Document } from 'mongodb';
import { getDb, getMongoClient } from '@/lib/mongodb';
import { COLLECTIONS, ensureIndexes } from '@/lib/collections';
import { seedReferenceData } from '@/reference/service';
import { startRun, tickRun, injectScenario } from '@/simulator/runtime';
import { snapshotTickWindows } from '@/analytics/metrics';
import { runMonitor } from '@/intelligence/monitor';
import { collectInvestigationEvidence } from '@/intelligence/evidence/orchestrator';
import { contextHash, planningContext } from '@/planner/context';
import { validateStrategy } from '@/planner/validation';
import { approvePlan, executePlan } from '@/execution/service';
import { evaluateOutcome } from '@/outcomes/service';
import { seedExecutionFixture } from '../execution/fixtures';

process.loadEnvFile('.env.local');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const source = 'stage5_1792885194280';
const sourceScope = {businessId:'nike_demo',simulationRunId:source};
const investigator = read(`docs/stage5-runs/${source}.json`).result;
const planning = read('docs/stage6-runs/advertising-plan.json');
const advertising = read('docs/stage7-runs/acceptance.json');
const controlled = read('docs/stage8-runs/controlled-preparation.json');
const shipping = read('docs/stage7-runs/shipping-fixture.json');
const db = await getDb();
if (!db.databaseName.startsWith('normal_e2e') && !db.databaseName.startsWith('normal_browser_e2e')) throw new Error('Browser fixtures require an isolated normal_e2e database.');
const move = <T,>(value:T,from:string,to:string):T => JSON.parse(JSON.stringify(value),(_key,v)=>{
 if(typeof v!=='string')return v;
 const moved=v.replaceAll(from,to);
 return to!==from && !moved.includes(to) && /^(evd_|diag_|aij_|report_|evc_|evr_|plj_)/.test(moved) ? `${to}_${moved}` : moved;
});
const baseCollections = [COLLECTIONS.simulatorState,COLLECTIONS.simulatedProducts,COLLECTIONS.simulatedCampaigns,COLLECTIONS.simulatedStorefront,COLLECTIONS.simulatedOrders,COLLECTIONS.simulatedShipments,COLLECTIONS.simulatedCustomers,COLLECTIONS.simulatedSessions,COLLECTIONS.simulatedReviews,COLLECTIONS.businessEvents,COLLECTIONS.metricSnapshots,COLLECTIONS.investigations,COLLECTIONS.anomalies,COLLECTIONS.incidents,COLLECTIONS.detectionFindings,COLLECTIONS.detectionObservations,COLLECTIONS.monitorRuns,COLLECTIONS.monitorState,COLLECTIONS.evidence,COLLECTIONS.evidenceDetails,COLLECTIONS.evidenceToolRuns,COLLECTIONS.evidenceCollections,COLLECTIONS.investigationJobs,COLLECTIONS.investigationReports,COLLECTIONS.investigationCalls,COLLECTIONS.diagnoses];
async function clearRun(run:string){for(const name of Object.values(COLLECTIONS))await db.collection(name).deleteMany({simulationRunId:run});}
async function cloneRun(run:string){
 await clearRun(run);
 for(const name of baseCollections){
  const docs=await db.collection(name).find(sourceScope,{projection:{_id:0}}).toArray();
  if(docs.length)await db.collection(name).insertMany(move(docs,source,run));
 }
}
async function installPlan(run:string,artifact:typeof advertising){
 const scope={businessId:'nike_demo',simulationRunId:run,investigationId:artifact.investigationId};
 const job=move(planning.result.job,source,run);
 job.jobId=artifact.planId.replace(/^plan_/,'');job.planId=artifact.planId;job.status='submitted';job.stage='approval_handoff_ready';
 job.history=job.history.map((entry:Document)=>({...entry,planId:artifact.planId}));
 const context=await planningContext(db,scope);
 const selected=job.output.strategies.find((strategy:Document)=>strategy.key===job.selectedKey);
 const validated=validateStrategy(context,selected,artifact.planId,artifact.planVersion);
 if(!validated.plan)throw new Error(`Fixture plan failed validation: ${validated.check.errors.join('; ')}`);
 job.contextHash=contextHash(context);
 await db.collection(COLLECTIONS.planningJobs).replaceOne(scope,job,{upsert:true});
 const plan={...validated.plan,status:'awaiting_approval',simulationRunId:run,planningJobId:job.jobId,contextHash:job.contextHash};
 await db.collection(COLLECTIONS.plans).replaceOne(scope,plan,{upsert:true});
 return {...scope,planId:plan.planId,planVersion:plan.planVersion};
}
async function execute(scope:Awaited<ReturnType<typeof installPlan>>){
 const plan=await db.collection(COLLECTIONS.plans).findOne(scope);
 const approval=await approvePlan(db,scope,{decision:'approved',approvedActionIds:plan!.actions.map((action:Document)=>action.actionId)},'e2e_fixture');
 const result=await executePlan(db,scope,approval.approvalId,'e2e_fixture');
 if(result.run?.status!=='succeeded')throw new Error('Fixture execution failed');
 for(const action of plan!.actions)await evaluateOutcome(db,{businessId:scope.businessId,simulationRunId:scope.simulationRunId,planId:scope.planId,planVersion:scope.planVersion,actionId:action.actionId});
}
async function prepareExecution(){
 await cloneRun(advertising.simulationRunId);
 const scope=await installPlan(advertising.simulationRunId,advertising);
 await clearRun(shipping.simulationRunId);
 await seedExecutionFixture(db,shipping.simulationRunId,true,'nike_demo');
 return scope;
}
async function main(){
 await ensureIndexes(db);await seedReferenceData(db);
 if(process.argv.includes('--execution')){await prepareExecution();return;}
 if(process.argv.includes('--outcomes')){
  for(const run of [advertising.simulationRunId,shipping.simulationRunId]){
   const plan=await db.collection(COLLECTIONS.plans).findOne({simulationRunId:run});
   if(!plan)throw new Error('Outcome fixture plan missing');
   for(const action of plan.actions)await evaluateOutcome(db,{businessId:plan.businessId,simulationRunId:run,planId:plan.planId,planVersion:plan.planVersion,actionId:action.actionId});
  }
  return;
 }
 await clearRun(source);
 await startRun({...sourceScope,seed:42,makeActive:false});
 const options={businessId:'nike_demo',db,afterPersist:(state:{businessId:string;simulationRunId:string;virtualTime:string},windows:Array<{startAt:string;endAt:string}>,d:typeof db)=>snapshotTickWindows(state.businessId,state.simulationRunId,windows,state.virtualTime,d)};
 for(const ticks of [36,36])await tickRun({simulationRunId:source,ticks},options);
 await runMonitor(sourceScope,{db});
 await injectScenario({simulationRunId:source,scenario:'ad_fatigue',severity:0.85},'nike_demo',db);
 await tickRun({simulationRunId:source,ticks:36},options);
 await runMonitor(sourceScope,{db});
 const scope={...sourceScope,investigationId:investigator.state.investigationId};
 await collectInvestigationEvidence(scope,{db});
 const details=await db.collection(COLLECTIONS.evidenceDetails).find(scope,{projection:{_id:0}}).toArray();
 const fresh=await db.collection(COLLECTIONS.evidence).find(scope,{projection:{_id:0}}).toArray();
 // Reuse the explicitly recorded model report; evidence remains checked against regenerated source records.
 await db.collection(COLLECTIONS.evidence).deleteMany(scope);
 for(const evidence of planning.handoff.evidence){
  const same=fresh.find(row=>row.title===evidence.title)??fresh.find(row=>row.category===evidence.category);
  const detail=details.find(row=>row.evidenceId===same?.evidenceId);
  await db.collection(COLLECTIONS.evidence).insertOne({...evidence,simulationRunId:source});
  if(detail)await db.collection(COLLECTIONS.evidenceDetails).replaceOne({...scope,evidenceId:evidence.evidenceId},{...detail,evidenceId:evidence.evidenceId},{upsert:true});
 }
 await db.collection(COLLECTIONS.investigationJobs).replaceOne(scope,{...investigator.state,affected:investigator.report.handoff.affectedEntities},{upsert:true});
 await db.collection(COLLECTIONS.investigationReports).replaceOne(scope,{...scope,reportId:investigator.report.reportId,report:investigator.report},{upsert:true});
 await db.collection(COLLECTIONS.diagnoses).replaceOne(scope,{...investigator.report.diagnosis,simulationRunId:source},{upsert:true});
 const calls=[...investigator.calls,...planning.result.calls];
 if(calls.length)await db.collection(COLLECTIONS.investigationCalls).insertMany(calls);
 // The observed-only demo uses the same seed and 24-hour incident as the control-room browser flow.
 await clearRun('demo_nike');
 await startRun({businessId:'nike_demo',simulationRunId:'demo_nike',seed:42,makeActive:false});
 for(const ticks of [36,36])await tickRun({simulationRunId:'demo_nike',ticks},options);
 await runMonitor({businessId:'nike_demo',simulationRunId:'demo_nike'},{db});
 await injectScenario({simulationRunId:'demo_nike',scenario:'ad_fatigue',severity:0.8},'nike_demo',db);
 await tickRun({simulationRunId:'demo_nike',ticks:24},options);
 await runMonitor({businessId:'nike_demo',simulationRunId:'demo_nike'},{db});
 const demoInvestigation=await db.collection(COLLECTIONS.investigations).findOne({simulationRunId:'demo_nike'});
 if(!demoInvestigation)throw new Error('Demo incident missing');
 await collectInvestigationEvidence({businessId:'nike_demo',simulationRunId:'demo_nike',investigationId:demoInvestigation.investigationId},{db});
 await installPlan(source,{...planning.handoff,...sourceScope,investigationId:scope.investigationId,planId:planning.handoff.plan.planId,planVersion:1});
 await execute(await prepareExecution());
 await cloneRun(controlled.simulationRunId);
 const controlledScope=await installPlan(controlled.simulationRunId,controlled);
 await execute(controlledScope);
 await tickRun({simulationRunId:controlled.simulationRunId,ticks:30},{...options});
 const cplan=await db.collection(COLLECTIONS.plans).findOne(controlledScope);
 await evaluateOutcome(db,{businessId:controlledScope.businessId,simulationRunId:controlledScope.simulationRunId,planId:controlledScope.planId,planVersion:controlledScope.planVersion,actionId:cplan!.actions[0].actionId});
 const shipPlan=await db.collection(COLLECTIONS.plans).findOne({simulationRunId:shipping.simulationRunId});
 await execute({businessId:'nike_demo',simulationRunId:shipping.simulationRunId,investigationId:shipPlan!.investigationId,planId:shipPlan!.planId,planVersion:1});
 const archive=read('docs/stage6-runs/checkout-advisory.json').result;
 await db.collection(COLLECTIONS.planningJobs).replaceOne({jobId:archive.job.jobId},archive.job,{upsert:true});
 const sources=read('docs/stage5-runs/source-card-integration-fixture.json').sources;
 for(const src of sources)await db.collection(COLLECTIONS.externalSources).replaceOne({sourceId:src.sourceId},src,{upsert:true});
 await db.collection(COLLECTIONS.businesses).updateOne({businessId:'nike_demo'},{$set:{activeSimulationRunId:'demo_nike'}});
 console.log('Browser fixtures ready: simulated observations, recorded reports, approval/execution and outcomes; zero provider calls.');
}
try{await main();}finally{await(await getMongoClient()).close();}
