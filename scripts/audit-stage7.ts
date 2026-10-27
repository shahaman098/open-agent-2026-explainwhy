/** Read-only audit of the saved acceptance runs. Does not approve, execute or call a model. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { getDb, getMongoClient } from '../src/lib/mongodb';
import { COLLECTIONS } from '../src/lib/collections';
import { canonicalPlan } from '../src/planner/service';
import { digest } from '../src/intelligence/investigator/store';
import { executionSnapshot } from '../src/execution/service';
import { verifyAction } from '../src/adapters';

process.loadEnvFile('.env.local');
async function main() {
  const db = await getDb();
  const acceptance = JSON.parse(readFileSync('docs/stage7-runs/acceptance.json', 'utf8'));
  const shipping = JSON.parse(readFileSync('docs/stage7-runs/shipping-fixture.json', 'utf8'));
  const results = [];
  for (const [input, expectedActions] of [[acceptance, 1], [shipping, 2]] as const) {
    const scope = {businessId: input.businessId, simulationRunId: input.simulationRunId, planId: input.planId, planVersion: input.planVersion};
    const runScope = {businessId: scope.businessId, simulationRunId: scope.simulationRunId};
    const snapshot = await executionSnapshot(db, scope);
    assert.equal(snapshot.run?.status, 'succeeded');
    assert.equal(snapshot.approval?.decision, 'approved');
    assert.equal(snapshot.executions.length, expectedActions);
    const receipts = await db.collection(COLLECTIONS.actionReceipts).find(runScope, {projection: {_id: 0}}).toArray();
    assert.equal(receipts.length, expectedActions);
    const checks = [];
    for (const execution of snapshot.executions) {
      assert.equal(execution.status, 'succeeded');
      const check = await verifyAction({...runScope, db}, execution.idempotencyKey);
      assert.equal(check.stateMatches, true);
      assert.equal(check.callbackEventsPresent, true);
      checks.push({executionId: execution.executionId, ...check});
    }
    const plan = await db.collection(COLLECTIONS.plans).findOne(scope, {projection: {_id: 0}});
    assert.ok(plan);
    assert.equal(digest(canonicalPlan(plan)), digest(snapshot.reviewedHandoff!.plan));
    results.push({...scope, approvalId: snapshot.approval!.approvalId, runId: snapshot.run!.runId, immutableReviewedPlan: true, receiptCount: receipts.length, checks});
  }
  const adScope = {businessId: acceptance.businessId, simulationRunId: acceptance.simulationRunId};
  const campaign = await db.collection(COLLECTIONS.simulatedCampaigns).findOne({...adScope, campaignId: 'cmp_basketball_search'});
  assert.equal(campaign?.dailyBudgetMinor, 6750);
  const orders = await db.collection(COLLECTIONS.simulatedOrders).find({...adScope, origin: 'demo_storefront'}, {projection: {_id: 0, orderId: 1, status: 1, lines: 1, netRevenueMinor: 1, currency: 1}}).toArray();
  assert.equal(orders.length, 1);
  const shippingScope = {businessId: shipping.businessId, simulationRunId: shipping.simulationRunId};
  assert.equal(await db.collection(COLLECTIONS.simulatedMessages).countDocuments(shippingScope), 2);
  const storefront = await db.collection(COLLECTIONS.simulatedStorefront).findOne(shippingScope);
  assert.equal(storefront?.banners.length, 1);
  const source = await db.collection(COLLECTIONS.plans).findOne({businessId: acceptance.businessId, simulationRunId: acceptance.sourceRun, planId: acceptance.sourcePlanId, planVersion: acceptance.planVersion}, {projection: {_id: 0}});
  assert.equal(digest(source), acceptance.sourcePlanHash);
  const activeRun = (await db.collection(COLLECTIONS.businesses).findOne({businessId: acceptance.businessId}))?.activeSimulationRunId;
  assert.equal(activeRun, 'demo_nike');
  const output = {auditedAt: new Date().toISOString(), activeRun, originalPlanUnchanged: true, budgetMinor: campaign!.dailyBudgetMinor, executions: results, storefrontOrders: orders, shippingMessages: 2, banners: storefront!.banners};
  writeFileSync('docs/stage7-runs/audit.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify({activeRun, originalPlanUnchanged: true, budgetMinor: campaign!.dailyBudgetMinor, receiptCounts: results.map(r => r.receiptCount), storefrontOrders: orders.length, shippingMessages: 2, banners: 1}));
}
main().catch(error => {console.error(error); process.exitCode = 1}).finally(async () => {await (await getMongoClient()).close()});
