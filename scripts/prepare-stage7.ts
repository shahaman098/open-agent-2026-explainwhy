/** Isolated copy of the existing saved Stage 5/6 advertising run. No model calls. */
import {writeFileSync,mkdirSync} from 'node:fs';
import {getDb,getMongoClient} from '../src/lib/mongodb';
import {COLLECTIONS,ensureIndexes} from '../src/lib/collections';
import {digest} from '../src/intelligence/investigator/store';
import {planningContext,contextHash} from '../src/planner/context';
import {plannerHandoff} from '../src/planner/service';
import type {Document} from 'mongodb';
process.loadEnvFile('.env.local');
const stage8=process.argv.includes('--stage8');
const source='stage5_1792885194280',simulationRunId=`${stage8?'stage8_':'stage7_'}${Date.now()}`;
async function main(){
 const db=await getDb();await ensureIndexes(db);
 const names=[COLLECTIONS.simulatorState,COLLECTIONS.simulatedProducts,COLLECTIONS.simulatedCampaigns,COLLECTIONS.simulatedStorefront,COLLECTIONS.simulatedOrders,COLLECTIONS.simulatedShipments,COLLECTIONS.simulatedCustomers,COLLECTIONS.simulatedSessions,COLLECTIONS.businessEvents,COLLECTIONS.metricSnapshots,COLLECTIONS.evidence,COLLECTIONS.evidenceDetails,COLLECTIONS.investigationJobs,COLLECTIONS.investigationReports,COLLECTIONS.diagnoses,COLLECTIONS.investigations,COLLECTIONS.anomalies,COLLECTIONS.planningJobs,COLLECTIONS.plans];
 const sourceDocs:Record<string,Document[]>={};const replacements=new Map<string,string>([[source,simulationRunId]]);
 for(const name of names){const docs=await db.collection(name).find({businessId:'nike_demo',simulationRunId:source},{projection:{_id:0}}).toArray();sourceDocs[name]=docs;
  for(const doc of docs)for(const [key,value] of Object.entries(doc))if(typeof value==='string'&&key.endsWith('Id')&&!['businessId','productId','campaignId','referenceProductId','simulationRunId'].includes(key))replacements.set(value,value.includes(source)?value.replaceAll(source,simulationRunId):`${simulationRunId}_${value}`);
 }
 const transform=(value:unknown):unknown=>{
  if(typeof value==='string')return replacements.get(value)??value.replaceAll(source,simulationRunId);
  if(Array.isArray(value))return value.map(transform);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,transform(v)]));
  return value;
 };
 // All generated plan action identifiers must be moved together with the plan ID.
 const originalPlan=sourceDocs.plans[0];
 for(const action of originalPlan.actions)replacements.set(action.actionId,action.actionId.replace(originalPlan.planId,replacements.get(originalPlan.planId)!));
 for(const name of names){const docs=transform(sourceDocs[name]) as Document[];
  if(name===COLLECTIONS.simulatorState)for(const doc of docs){doc.status='paused';doc.lock=null;doc.lastTickKey=null;}
  if(docs.length)await db.collection(name).insertMany(docs);
 }
 const doc=await db.collection(COLLECTIONS.plans).findOne({businessId:'nike_demo',simulationRunId},{projection:{_id:0}});
 if(!doc)throw new Error('Source plan missing');
 const scope={businessId:'nike_demo',simulationRunId,investigationId:doc.investigationId};
 const context=await planningContext(db,scope),hash=contextHash(context);
 await db.collection(COLLECTIONS.plans).updateOne({planId:doc.planId},{$set:{contextHash:hash}});
 await db.collection(COLLECTIONS.planningJobs).updateOne({...scope,jobId:doc.planningJobId},{$set:{contextHash:hash}});
 const handoff=await plannerHandoff(db,{...doc,contextHash:hash});
 mkdirSync(stage8?'docs/stage8-runs':'docs/stage7-runs',{recursive:true});
 const result={...scope,planId:doc.planId,planVersion:doc.planVersion,sourceRun:source,sourcePlanId:originalPlan.planId,sourcePlanHash:digest(originalPlan),label:'Isolated acceptance copy of saved genuine Stage 5/6 report and strategy; no model call',counts:Object.fromEntries(Object.entries(sourceDocs).map(([k,v])=>[k,v.length])),handoff};
 writeFileSync(stage8?'docs/stage8-runs/controlled-preparation.json':'docs/stage7-runs/acceptance.json',JSON.stringify(result,null,2));console.log(JSON.stringify({simulationRunId,planId:doc.planId,actions:handoff.plan.actions.map(a=>a.params)}));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await (await getMongoClient()).close()});
