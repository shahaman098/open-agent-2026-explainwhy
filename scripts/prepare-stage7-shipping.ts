import {getDb,getMongoClient} from '../src/lib/mongodb';
import {seedExecutionFixture} from '../tests/execution/fixtures';
import {writeFileSync} from 'node:fs';
process.loadEnvFile('.env.local');
async function main(){const db=await getDb(),scope=await seedExecutionFixture(db,`stage7_shipping_${Date.now()}`,true,'nike_demo');
const products=await db.collection('simulated_products').find({businessId:'nike_demo',simulationRunId:'stage5_1792885194280'},{projection:{_id:0}}).toArray();await db.collection('simulated_products').insertMany(products.map(p=>({...p,simulationRunId:scope.simulationRunId})));
writeFileSync('docs/stage7-runs/shipping-fixture.json',JSON.stringify({...scope,label:'Explicit test fixture for ordered notice → factual banner execution. No live shipping diagnosis or Mubit call.'},null,2));console.log(scope)}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await (await getMongoClient()).close()});
