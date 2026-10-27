/** Hash all pre-existing business/run data, including Stage 7 execution records. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {getDb,getMongoClient} from '../src/lib/mongodb';
import {canonicalJson} from '../src/intelligence/evidence/provenance';
process.loadEnvFile('.env.local');
const root='docs/stage8-runs/preservation';
async function main(){
 const db=await getDb(),before=process.argv.includes('--before');
 const baseline=before?null:JSON.parse(readFileSync(`${root}-before.json`,'utf8'));
 const names=baseline?Object.keys(baseline.collections):(await db.listCollections().toArray()).map(c=>c.name).filter(n=>!['business_outcome_assessments','outcome_feedback'].includes(n)).sort();
 const result:{active:string|null;collections:Record<string,{count:number;hash:string}>}={active:(await db.collection('businesses').findOne({businessId:'nike_demo'}))?.activeSimulationRunId??null,collections:{}};
 for(const name of names){const h=createHash('sha256');let count=0;for await(const doc of db.collection(name).find({$or:[{simulationRunId:{$not:/^stage8_/}},{simulationRunId:{$exists:false}}]}).sort({_id:1})){h.update(canonicalJson(doc));count++}result.collections[name]={count,hash:h.digest('hex')}}
 mkdirSync('docs/stage8-runs',{recursive:true});writeFileSync(`${root}-${before?'before':'after'}.json`,JSON.stringify(result,null,2));
 if(baseline&&canonicalJson(baseline)!==canonicalJson(result))throw new Error('Stage 5–7 preservation mismatch');
 console.log(JSON.stringify({collections:names.length,active:result.active,preserved:!before}));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await(await getMongoClient()).close()});
