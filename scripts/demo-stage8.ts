/** Re-evaluate only the saved Stage 7 isolated executions; no model or business action. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {getDb,getMongoClient} from '../src/lib/mongodb';
import {evaluateOutcome,outcomeHistory} from '../src/outcomes/service';
process.loadEnvFile('.env.local');
async function main(){
 const db=await getDb(),advertising=JSON.parse(readFileSync('docs/stage7-runs/acceptance.json','utf8'));
 const shipping=JSON.parse(readFileSync('docs/stage7-runs/shipping-fixture.json','utf8'));
 const results=[];
 for(const input of [advertising,shipping]){
   const history=await outcomeHistory(db,{businessId:input.businessId,simulationRunId:input.simulationRunId});
   for(const row of history.rows){const a=await evaluateOutcome(db,{businessId:input.businessId,simulationRunId:input.simulationRunId,
     planId:row.plan.planId,planVersion:row.plan.planVersion,actionId:row.action.actionId});
     results.push({businessId:a.businessId,simulationRunId:a.simulationRunId,assessmentId:a.assessmentId,planId:a.planId,planVersion:a.planVersion,
       actionId:a.actionId,actionType:a.actionType,status:a.status,actionApplied:a.actionApplied,targetStateAchieved:a.targetStateAchieved,
       businessEffect:a.businessEffect,summary:a.summary,beforeValue:a.beforeValue,afterValue:a.afterValue,
       beforeCoverage:a.before&&{coveredMinutes:a.before.coveredMinutes,requiredMinutes:a.before.requiredMinutes},
       afterCoverage:a.after&&{coveredMinutes:a.after.coveredMinutes,requiredMinutes:a.after.requiredMinutes},
       callbackEvents:a.receiptEventIds,sourceReferences:a.sourceReferences.length});
   }
 }
 mkdirSync('docs/stage8-runs',{recursive:true});writeFileSync('docs/stage8-runs/demonstration.json',JSON.stringify({label:'Read-only measurement of existing Stage 7 isolated executions; assessment records only.',assessments:results},null,2));
 console.log(JSON.stringify(results.map(({actionType,status,businessEffect,beforeCoverage,afterCoverage})=>({actionType,status,businessEffect,beforeCoverage,afterCoverage}))));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await(await getMongoClient()).close()});
