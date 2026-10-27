import { existsSync } from "node:fs";
import { getDb, getMongoClient } from "../src/lib/mongodb";
import { COLLECTIONS } from "../src/lib/collections";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
async function main() {
  const simulationRunId = process.argv[2]; if (!/^[a-z0-9_]{1,64}$/.test(simulationRunId || "")) throw new Error("Supply run ID");
  const db = await getDb();
  const jobs = await db.collection(COLLECTIONS.investigationJobs).find({ simulationRunId }, { projection: { _id: 0, jobId: 1, status: 1, stopReason: 1, steps: 1 } }).toArray();
  const calls = await db.collection(COLLECTIONS.investigationCalls).find({ simulationRunId }, { projection: { _id: 0, callId: 1, task: 1, status: 1, metadata: 1, result: 1, error: 1, validationStatus: 1 } }).toArray();
  console.log(JSON.stringify({ jobs, calls }, null, 2));
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(async () => { if (globalThis._normalMongoClientPromise) await (await getMongoClient()).close(); });
