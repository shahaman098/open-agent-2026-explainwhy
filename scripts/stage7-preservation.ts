import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { getDb, getMongoClient } from '../src/lib/mongodb';
import { canonicalJson } from '../src/intelligence/evidence/provenance';
process.loadEnvFile('.env.local');
const path = 'docs/stage7-runs/preservation';
async function main() {
 const db = await getDb();
 const before = process.argv.includes('--before');
 const prior = before ? null : JSON.parse(readFileSync(`${path}-before.json`, 'utf8'));
 const collections = prior ? Object.keys(prior.collections) : (await db.listCollections().toArray()).map(c => c.name).sort();
 const result: { collections: Record<string, {count:number; hash:string}>; active: unknown } = {collections:{}, active: (await db.collection('businesses').findOne({businessId:'nike_demo'}))?.activeSimulationRunId};
 for (const name of collections) {
   const hash = createHash('sha256'); let count = 0;
   const filter = name.startsWith('reference_') || name === 'businesses' ? {} : { $or: [{simulationRunId: {$not: /^stage7_/}}, {simulationRunId: {$exists:false}}] };
   for await (const doc of db.collection(name).find(filter).sort({_id:1})) { hash.update(canonicalJson(doc)); count++; }
   result.collections[name] = {count, hash:hash.digest('hex')};
 }
 writeFileSync(`${path}-${before ? 'before' : 'after'}.json`, JSON.stringify(result,null,2));
 if (prior && canonicalJson(prior) !== canonicalJson(result)) throw new Error('Preservation mismatch');
 console.log(JSON.stringify({collections:collections.length,active:result.active,preserved:!before}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(async()=>{await (await getMongoClient()).close()});
