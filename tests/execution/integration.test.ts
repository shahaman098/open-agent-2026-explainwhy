import {GET as campaignGet} from "@/app/api/dev/simulator/campaigns/[id]/route";
import {buildSimulatorEvent} from "@/simulator/events";
import * as adapters from "@/adapters";
import {createHash} from "node:crypto";
import { GET as productGet } from '@/app/api/demo-store/products/route';
import { POST as approveRoute } from '@/app/api/plans/[id]/approve/route';
import { approvePlan,EXEC,executePlan,executionSnapshot,loadExecutable } from '@/execution/service';
import { COLLECTIONS } from '@/lib/collections';
import { getDb } from '@/lib/mongodb';
import { NIKE_REFERENCE_CATALOGUE } from '@/reference/nike-catalogue';
import { productImages } from '@/reference/product-images';
import { ActionExecution,ActionOutcome,AgentMission,PlanApproval } from '@normal/contracts';
import type { Db } from 'mongodb';
import { existsSync,readFileSync } from 'node:fs';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { seedExecutionFixture } from './fixtures';
const prefix=`stage7_test_${Date.now()}`;let db:Db;let n=0;
const seed=(shipping=false)=>seedExecutionFixture(db,`${prefix}_${n++}`,shipping);
const approve=async(scope:Awaited<ReturnType<typeof seed>>)=>{const h=await loadExecutable(db,scope);return approvePlan(db,scope,{decision:'approved',approvedActionIds:h.plan.actions.map(a=>a.actionId)},'test_human')};
beforeAll(async()=>{db=await getDb()});
afterAll(async()=>{for(const c of [...Object.values(COLLECTIONS),...Object.values(EXEC)])await db?.collection(c).deleteMany({simulationRunId:{$regex:`^${prefix}`}})});
describe('partner approval + Normal execution',()=>{
 it('requires exact human approval and rejects wrong version, owner, scope and decision',async()=>{
  const scope=await seed();await expect(executePlan(db,scope,'missing','test_human')).rejects.toThrow('approval');
  await expect(approvePlan(db,{...scope,planVersion:2},{decision:'approved',approvedActionIds:['x']},'test_human')).rejects.toThrow();
  await expect(loadExecutable(db,{...scope,businessId:'foreign'})).rejects.toThrow();
  await expect(approvePlan(db,scope,{decision:'approved',approvedActionIds:['unknown']},'test_human')).rejects.toThrow('disagree');
  const a=await approve(scope);expect(PlanApproval.safeParse(a).success).toBe(true);
  await expect(executePlan(db,scope,a.approvalId,'other')).rejects.toThrow('reviewer');
  await expect(approve(scope)).rejects.toThrow('already');
 });
 it('executes once under concurrent requests, verifies callback and stores canonical missions/results',async()=>{
  const scope=await seed(),before=await db.collection(COLLECTIONS.plans).findOne(scope),a=await approve(scope);
  const results=await Promise.allSettled([executePlan(db,scope,a.approvalId,'test_human'),executePlan(db,scope,a.approvalId,'test_human')]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const snap=await executionSnapshot(db,scope);expect(snap.run?.status).toBe('succeeded');
  expect(ActionExecution.safeParse(snap.executions[0]).success).toBe(true);expect(AgentMission.safeParse(snap.missions[0]).success).toBe(true);expect(ActionOutcome.safeParse(snap.outcomes[0]).success).toBe(true);
  const run={businessId:scope.businessId,simulationRunId:scope.simulationRunId};
  expect((await db.collection(COLLECTIONS.simulatedCampaigns).findOne(run))?.dailyBudgetMinor).toBe(8000);
  expect(await db.collection(COLLECTIONS.actionReceipts).countDocuments(run)).toBe(1);
  expect(await db.collection(COLLECTIONS.businessEvents).countDocuments({...run,type:'campaign.budget_updated'})).toBe(1);
  expect(await db.collection(COLLECTIONS.plans).findOne(scope)).toEqual(before);
  await expect(executePlan(db,scope,a.approvalId,'test_human')).rejects.toThrow('already');
 });
 it('rejects stale budget after approval without creating a receipt',async()=>{
  const scope=await seed(),a=await approve(scope),run={businessId:scope.businessId,simulationRunId:scope.simulationRunId};
  await db.collection(COLLECTIONS.simulatedCampaigns).updateOne(run,{$set:{dailyBudgetMinor:11000}});
  await expect(executePlan(db,scope,a.approvalId,'test_human')).rejects.toThrow('stale');expect(await db.collection(COLLECTIONS.actionReceipts).countDocuments(run)).toBe(0);
 });
 it('rejects expiry, immutable parameter tampering and superseded selected versions',async()=>{
  const scope=await seed(),a=await approve(scope);
  await db.collection(EXEC.approvals).updateOne(scope,{$set:{'approval.expiresAt':'2000-01-01T00:00:00Z'}});
  await expect(executePlan(db,scope,a.approvalId,'test_human')).rejects.toThrow('expired');
  const s2=await seed(),a2=await approve(s2);await db.collection(COLLECTIONS.plans).updateOne(s2,{$set:{'actions.0.params.newDailyBudgetMinor':7500}});
  await expect(executePlan(db,s2,a2.approvalId,'test_human')).rejects.toThrow('immutable');
  const s3=await seed(),a3=await approve(s3);const p=await db.collection(COLLECTIONS.plans).findOne(s3);await db.collection(COLLECTIONS.planningJobs).updateOne({jobId:p!.planningJobId},{$set:{planVersion:2}});
  await expect(executePlan(db,s3,a3.approvalId,'test_human')).rejects.toThrow('version changed');
 });
 it('rejects disallowed dependencies and runs notice before banner with durable effects',async()=>{
  const scope=await seed(true),h=await loadExecutable(db,scope);
  await expect(approvePlan(db,scope,{decision:'approved',approvedActionIds:[h.plan.actions[1].actionId]},'test_human')).rejects.toThrow('dependencies');
  const a=await approve(scope),snap=await executePlan(db,scope,a.approvalId,'test_human');expect(snap.executions.map(e=>e.status)).toEqual(['succeeded','succeeded']);
  expect(snap.executions[0].finishedAt<=snap.executions[1].startedAt).toBe(true);
  const run={businessId:scope.businessId,simulationRunId:scope.simulationRunId};expect(await db.collection(COLLECTIONS.simulatedMessages).countDocuments(run)).toBe(2);expect((await db.collection(COLLECTIONS.simulatedStorefront).findOne(run))?.banners).toHaveLength(1);
 });
 it('records rejection without permitting execution and gates HTTP approval',async()=>{
  const scope=await seed();const a=await approvePlan(db,scope,{decision:'rejected',approvedActionIds:[],comment:'Human declined'},'test_human');
  await expect(executePlan(db,scope,a.approvalId,'test_human')).rejects.toThrow('rejected');
  const response=await approveRoute(new Request('http://localhost/api/plans/x/approve',{method:'POST',body:'{}'}),{params:Promise.resolve({id:'x'})});expect(response.status).toBe(404);
 });
 it('serves scoped storefront products and does not fall back for a foreign run',async()=>{
  const scope=await seed();
  const response=await productGet(new Request(`http://localhost/api/demo-store/products?businessId=foreign&simulationRunId=${scope.simulationRunId}`));expect(response.status).toBeGreaterThanOrEqual(400);
  const good=await productGet(new Request(`http://localhost/api/demo-store/products?businessId=${scope.businessId}&simulationRunId=${scope.simulationRunId}`));expect(good.status).toBe(200);const body=await good.json();expect(body.products).toHaveLength(17);expect(new Set(body.products.map((p:{productId:string})=>p.productId)).size).toBe(17);expect(body.products.every((p:{images:unknown[]})=>p.images.length>0)).toBe(true);
 });

 it('exposes deduplicated campaign metrics, history, budget and strict run isolation through the existing API',async()=>{
  const scope=await seed();const run={businessId:scope.businessId,simulationRunId:scope.simulationRunId};
  const payload={campaignId:'campaign_A',window:{startAt:'2026-10-23T17:00:00Z',endAt:'2026-10-23T18:00:00Z'},impressions:1000,clicks:20,spendMinor:1234,attributedOrders:2,attributedRevenueMinor:6000,frequency:1,currency:'GBP' as const};
  const event=buildSimulatorEvent('ad.metrics_observed',payload,{...run,occurredAt:'2026-10-23T18:00:00Z',receivedAt:'2026-10-23T18:01:00Z',sourceRecordId:`${scope.simulationRunId}_metrics`});
  await db.collection(COLLECTIONS.businessEvents).insertMany([event,{...event,eventId:event.eventId+'_duplicate',provenance:{...event.provenance,sourceRecordId:event.provenance.sourceRecordId+'_duplicate'}}]);
  vi.stubEnv('NODE_ENV','development');
  try{
   const response=await campaignGet(new Request(`http://localhost/api/dev/simulator/campaigns/campaign_A?businessId=${scope.businessId}&simulationRunId=${scope.simulationRunId}`),{params:Promise.resolve({id:'campaign_A'})});
   expect(response.status).toBe(200);const body=await response.json();expect(body.campaign.dailyBudgetMinor).toBe(10000);expect(body.performance).toMatchObject({spendMinor:1234,impressions:1000,clicks:20,attributedOrders:2,attributedRevenueMinor:6000,ctr:.02,roas:4.86});expect(body.daily.reduce((n:number,d:{counters:{adSpendMinor:number}})=>n+d.counters.adSpendMinor,0)).toBe(1234);
   const foreign=await campaignGet(new Request(`http://localhost/api/dev/simulator/campaigns/campaign_A?businessId=foreign&simulationRunId=${scope.simulationRunId}`),{params:Promise.resolve({id:'campaign_A'})});expect(foreign.status).toBe(404);
  }finally{vi.unstubAllEnvs()}
 });
 it('retains successful receipts on partial failure and refuses to replay ambiguous work',async()=>{
  const scope=await seed(true),a=await approve(scope);
  const fail=vi.spyOn(adapters,'publishBanner').mockRejectedValueOnce(new Error('fixture failure before banner write'));
  try{const snapshot=await executePlan(db,scope,a.approvalId,'test_human');expect(snapshot.run?.status).toBe('failed');expect(snapshot.executions.map(e=>e.status)).toEqual(['succeeded','failed']);expect(snapshot.executions[1].error.retryable).toBe(false);expect(await db.collection(COLLECTIONS.actionReceipts).countDocuments({simulationRunId:scope.simulationRunId})).toBe(1);
  await expect(executePlan(db,scope,a.approvalId,'test_human')).rejects.toThrow('already');}finally{fail.mockRestore()}
 });
 it('rejects a shipment that changes after approval',async()=>{
  const scope=await seed(true),a=await approve(scope);await db.collection(COLLECTIONS.simulatedShipments).updateOne({simulationRunId:scope.simulationRunId},{$set:{status:'shipped',shippedAt:'2026-10-23T18:30:00Z'}});
  await expect(executePlan(db,scope,a.approvalId,'test_human')).rejects.toThrow('stale');expect(await db.collection(COLLECTIONS.actionReceipts).countDocuments({simulationRunId:scope.simulationRunId})).toBe(0);
 });
 it('matches available images to exact reference identity and keeps Shopify isolated',()=>{
  for(const p of NIKE_REFERENCE_CATALOGUE){const images=productImages(p.referenceProductId,p.styleCode,p.imageUrl);expect(images.length).toBeGreaterThan(0);for(const image of images)if(image.src.startsWith('/'))expect(existsSync(`public${image.src}`)).toBe(true)}
  expect(productImages('unknown','wrong')).toEqual([]);
  const shopify=readFileSync('src/components/partner/ShopifyDemo.tsx','utf8');expect(shopify).not.toMatch(/fetch\(|mongodb|@\/simulator|@\/execution/);expect(shopify).toContain('Synthetic Shopify intro demo');
  const first=shopify.indexOf('const SYNTHETIC_ORDERS'),last=shopify.indexOf('\n];',first)+3;expect(createHash('sha256').update(shopify.slice(first,last)).digest('hex')).toBe('2bd6f9efe1345e1784b6e3eb4dc4d0684b2dfd491177586cd579e0382874b6cc');
 });
});
