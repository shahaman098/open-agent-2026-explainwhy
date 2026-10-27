import type {Db} from 'mongodb';
import {COLLECTIONS,ensureIndexes} from '@/lib/collections';
import {InvestigationState} from '@/intelligence/investigator/schemas';
import {composeReport} from '@/intelligence/investigator/reports';
import {startPlanning,runNextPlanning,selectStrategy,submitPlan} from '@/planner/service';
import {createInitialWorld} from '@/simulator/bootstrap';
import {NIKE_REFERENCE_CATALOGUE} from '@/reference/nike-catalogue';
import {contextFixture,strategyFixture} from '../planner/fixtures';
export async function seedExecutionFixture(db:Db,simulationRunId:string,shipping=false,businessId='nike_test') {
 await ensureIndexes(db);
 const fixture=contextFixture(shipping?'delivery_delays':'ad_fatigue');
 const scope={businessId,simulationRunId,investigationId:`${simulationRunId}_inv`};
 const original=fixture.evidence.find(e=>e.evidenceId===(shipping?'e_ship_01':'e_ads_01'))!;
 const evidence={...original,businessId,investigationId:scope.investigationId,evidenceId:`${simulationRunId}_e`,sourceRecords:[{collection:COLLECTIONS.businessEvents,recordId:`${simulationRunId}_fixture_event`}]};
 const diagnosis={...fixture.diagnosis,businessId,investigationId:scope.investigationId,diagnosisId:`${simulationRunId}_diag`,hypotheses:fixture.diagnosis.hypotheses.map(h=>({...h,evidenceIds:[evidence.evidenceId]}))};
 const state=InvestigationState.parse({schemaVersion:1,...scope,jobId:`${simulationRunId}_job`,status:'completed',stage:'completed',createdAt:fixture.cutoff,updatedAt:fixture.cutoff,startedAt:fixture.cutoff,completedAt:fixture.cutoff,round:1,toolCount:1,researchCount:0,sourceCount:0,callCount:0,reservedTokens:0,actualTokens:0,estimatedCostUsd:0,budget:{maxRounds:1,maxTools:1,maxResearchRounds:0,maxSources:0,maxCalls:2,maxTokens:5000,maxWallMs:60000,maxCostUsd:null},cutoff:fixture.cutoff,incidentWindow:evidence.window,baselineWindow:null,evidenceIds:[evidence.evidenceId],sourceIds:[],hypotheses:[],steps:[],error:null,stopReason:null,reportId:`report_${simulationRunId}_job`,attempts:1});
 const report=composeReport(state,diagnosis,[evidence],[],['campaign_A']);
 const runScope={businessId,simulationRunId};
 // Build a complete run locally so tests do not depend on saved demo records.
 const virtualStartAt=new Date(Date.parse(fixture.storefront.virtualTime)-24*60*60*1000).toISOString();
 const {world}=createInitialWorld({...runScope,seed:42,catalogue:NIKE_REFERENCE_CATALOGUE,config:{initialCustomers:0},virtualStartAt,createdAt:fixture.storefront.updatedAt});
 await db.collection(COLLECTIONS.simulatorState).insertOne({...world.state,status:'paused',virtualTime:fixture.storefront.virtualTime});
 await db.collection(COLLECTIONS.simulatedProducts).insertMany([...world.products.values()]);
 await db.collection(COLLECTIONS.simulatedCampaigns).insertOne({...fixture.campaigns[0],...runScope});
 await db.collection(COLLECTIONS.simulatedStorefront).insertOne({...runScope,banners:[],promotions:[],updatedAt:fixture.storefront.updatedAt});
 await db.collection(COLLECTIONS.investigations).insertOne({...scope,status:'awaiting_review'});
 await db.collection(COLLECTIONS.investigationJobs).insertOne({...state,affected:['campaign_A']});
 await db.collection(COLLECTIONS.investigationReports).insertOne({...scope,reportId:report.reportId,report});
 await db.collection(COLLECTIONS.diagnoses).insertOne({...diagnosis,simulationRunId});
 await db.collection(COLLECTIONS.evidence).insertOne({...evidence,simulationRunId});
 await db.collection(COLLECTIONS.businessEvents).insertOne({...runScope,eventId:evidence.sourceRecords[0].recordId,provenance:{connectorId:'stage7_test_fixture',sourceRecordId:evidence.sourceRecords[0].recordId}});
 await db.collection(COLLECTIONS.evidenceDetails).insertOne({...scope,...fixture.evidenceDetails![0],evidenceId:evidence.evidenceId,verification:{passed:true}});
 const selected=strategyFixture(shipping); selected.evidenceIds=[evidence.evidenceId];selected.actions.forEach(a=>a.evidenceIds=[evidence.evidenceId]);
 if(shipping){
  const ids=[];
  for(const [index,order] of fixture.delayedOrders.entries()){
   const orderId=`${simulationRunId}_order_${index}`;ids.push(orderId);
   await db.collection(COLLECTIONS.simulatedOrders).insertOne({...runScope,...order,orderId});
   await db.collection(COLLECTIONS.simulatedShipments).insertOne({...runScope,...order.shipment,orderId,shipmentId:`${orderId}_shipment`});
  }
  selected.actions[0].notice!.orderIds=ids;
 }
 await startPlanning(db,scope);
 await runNextPlanning(db,scope,async()=>({value:{strategies:[selected,{...selected,key:'observe',actions:[],advisory:['Continue observing.']}],recommendedKey:selected.key,recommendation:'Explicit test fixture, no model request.'},toolCalls:[],metadata:{provider:'mubit',model:'test_fixture_no_request',requestId:'fixture_no_request',providerRequestId:null,route:'fixture',latencyMs:0,inputTokens:0,outputTokens:0,totalTokens:0,estimatedCostUsd:null}}));
 await selectStrategy(db,scope,'bounded');const submitted=await submitPlan(db,scope);
 if(!submitted.plan)throw new Error('Fixture proposal failed');
 return {...runScope,planId:submitted.plan.planId,planVersion:submitted.plan.planVersion};
}
