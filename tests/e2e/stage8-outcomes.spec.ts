import { artifactPath } from "./artifacts";
import {expect,test} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
test.beforeEach(async()=>{await promisify(execFile)(process.execPath,['--conditions=react-server','--import','tsx','tests/e2e/seed.mts','--outcomes'],{timeout:90000});});
test.use({extraHTTPHeaders:process.env.E2E_DEMO_KEY?{'x-normal-demo-key':process.env.E2E_DEMO_KEY}:{}});
const advertising=JSON.parse(readFileSync('docs/stage7-runs/acceptance.json','utf8'));
const shipping=JSON.parse(readFileSync('docs/stage7-runs/shipping-fixture.json','utf8'));
const controlled=JSON.parse(readFileSync('docs/stage8-runs/controlled-observation.json','utf8'));

test('Stage 8 shows persisted execution, operational verification and honest pending business impact',async({page,request})=>{
 test.setTimeout(120_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const url=`/dashboard/outcomes?run=${advertising.simulationRunId}`;
 const before=await (await request.get(`/api/outcomes?businessId=nike_demo&simulationRunId=${advertising.simulationRunId}`)).json();
 expect(before.counts).toMatchObject({actionsExecuted:1,awaitingMeasurement:1,measuredImprovement:0,noObservedImprovement:0});
 const saved=before.rows[0].latest;expect(saved.status).toBe('pending_measurement');expect(saved.before.complete).toBe(true);
 expect(saved.before.coveredMinutes).toBe(1800);expect(saved.after.coveredMinutes).toBe(0);
 await page.goto(url);await expect(page.getByTestId('outcomes-page')).toBeVisible();
 await expect(page.getByTestId('outcome-detail')).toContainText('£90.00');
 await expect(page.getByTestId('outcome-detail')).toContainText('£67.50');
 await expect(page.getByTestId('outcome-detail')).toContainText('Business effect');
 await expect(page.getByTestId('outcome-detail')).toContainText('Before 30 h / 30 h · After 0 h / 30 h');
 await expect(page.locator('.outcome-metric-explorer button').first()).toContainText('£122.31 → —');
 await page.locator('summary').filter({hasText:'Execution receipt'}).click();
 await expect(page.locator('.outcome-disclosures pre')).toContainText('"toolName": "ads.set_daily_budget"');
 await page.screenshot({path:artifactPath('docs/stage8-runs/outcomes-advertising.png'),fullPage:true});
 await page.getByRole('button',{name:'Recheck assessment'}).click();
 await expect(page.getByTestId('outcome-detail')).toContainText('full post-action window is needed');
 const repeated=await (await request.get(`/api/outcomes?businessId=nike_demo&simulationRunId=${advertising.simulationRunId}`)).json();
 expect(repeated.rows[0].history).toHaveLength(1);expect(repeated.rows[0].latest.assessmentId).toBe(saved.assessmentId);
 await page.reload();await expect(page.getByTestId('outcome-detail')).toContainText('£67.50');
 await page.getByRole('link',{name:'Reviewed plan v1'}).click();
 await page.getByRole('button').filter({hasText:advertising.handoff.plan.objective}).click();
 await expect(page.getByTestId('execution-results')).toContainText('succeeded');
 await page.goto(`/dashboard/investigations/${advertising.investigationId}?run=${advertising.simulationRunId}`);
 await page.getByTestId('open-outcome-details').click();
 await expect(page.getByTestId('outcome-detail')).toContainText('Reduce basketball search daily budget');
 await page.screenshot({path:artifactPath('docs/stage8-runs/outcomes-investigation.png'),fullPage:true});

 await page.goto(`/dashboard/outcomes?run=${shipping.simulationRunId}`);
 await expect(page.getByTestId('outcomes-page')).toBeVisible();
 const ship=await (await request.get(`/api/outcomes?businessId=nike_demo&simulationRunId=${shipping.simulationRunId}`)).json();
 expect(ship.counts).toMatchObject({actionsExecuted:2,awaitingMeasurement:2,measuredImprovement:0});
 const notice=ship.rows.find((r:{action:{actionType:string}})=>r.action.actionType==='customer.send_delay_notice');
 await page.getByTestId(`outcome-action-${notice.action.actionId}`).click();
 await expect(page.getByTestId('outcome-detail')).toContainText('2 intended → 2 reached');
 await expect(page.getByTestId('outcome-detail')).toContainText('business impact is unmeasured');
 await expect(page).toHaveURL(/action=/);
 await page.screenshot({path:artifactPath('docs/stage8-runs/outcomes-shipping.png'),fullPage:true});
 await page.reload();await expect(page.getByTestId('outcomes-page')).toBeVisible();
 await page.goto(`/dashboard/outcomes?run=${controlled.simulationRunId}`);
 await expect(page.getByTestId('outcomes-page')).toBeVisible();
 const compared=await (await request.get(`/api/outcomes?businessId=nike_demo&simulationRunId=${controlled.simulationRunId}`)).json();
 expect(compared.counts).toMatchObject({actionsExecuted:1,awaitingMeasurement:0,measuredImprovement:0,noObservedImprovement:1});
 expect(compared.rows[0].latest).toMatchObject({status:'completed',businessEffect:'unchanged',successCriteriaMet:false});
 await expect(page.getByTestId('outcome-detail')).toContainText('£122.31');
 await expect(page.getByTestId('outcome-detail')).toContainText('£91.92');
 await expect(page.getByTestId('outcome-detail')).toContainText('0.60%');
 await expect(page.getByTestId('outcome-detail')).toContainText('0.49%');
 await expect(page.getByTestId('outcome-detail')).toContainText('Not met');
 await page.screenshot({path:artifactPath('docs/stage8-runs/outcomes-controlled.png'),fullPage:true});
 await page.reload();await expect(page.getByTestId('outcome-detail')).toContainText('£91.92');
 expect(errors).toEqual([]);
 writeFileSync(artifactPath('docs/stage8-runs/browser.json'),JSON.stringify({advertisingRun:advertising.simulationRunId,advertisingAssessmentId:saved.assessmentId,
  advertisingStatus:saved.status,advertisingBeforeMinutes:saved.before.coveredMinutes,advertisingAfterMinutes:saved.after.coveredMinutes,
  shippingRun:shipping.simulationRunId,shippingActions:ship.rows.map((r:{action:{actionType:string};latest:{status:string;businessEffect:string}})=>({type:r.action.actionType,status:r.latest.status,effect:r.latest.businessEffect})),
  controlledRun:controlled.simulationRunId,controlledStatus:compared.rows[0].latest.status,
  controlledEffect:compared.rows[0].latest.businessEffect,controlledCriteriaMet:compared.rows[0].latest.successCriteriaMet,
  pageErrors:errors},null,2));
});
