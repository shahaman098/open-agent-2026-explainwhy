// Collects deterministic evidence for a prepared incident (no model calls) and prints what the investigator will see.
import { getDb, getMongoClient } from "../src/lib/mongodb";
import { COLLECTIONS } from "../src/lib/collections";
import { collectInvestigationEvidence } from "../src/intelligence/evidence/orchestrator";
import { existsSync } from "node:fs";
if (process.env.MONGODB_URI === undefined && existsSync(".env.local")) process.loadEnvFile(".env.local");
const [simulationRunId, investigationId] = [process.argv[2], process.argv[3]];
async function main() {
  const db = await getDb();
  const incident = await db.collection(COLLECTIONS.incidents).findOne({ businessId: "nike_demo", simulationRunId, investigationId }, { projection: { _id: 0, title: 1, primaryTheme: 1, themes: 1, onsetAt: 1, severity: 1 } });
  console.log(JSON.stringify({ incident }, null, 1));
  const summary = await collectInvestigationEvidence({ investigationId, businessId: "nike_demo", simulationRunId }, { db });
  console.log(JSON.stringify(summary.outcomes.map((o) => ({ tool: o.tool, status: o.status, evidence: o.evidenceIds.length })), null, 0));
  const ids = summary.outcomes.flatMap((o) => o.evidenceIds);
  for (const e of await db.collection(COLLECTIONS.evidence).find({ businessId: "nike_demo", simulationRunId, evidenceId: { $in: ids } }, { projection: { _id: 0, evidenceId: 1, title: 1, observation: 1, measurements: 1 } }).toArray())
    console.log(`\n## ${e.title}\n${e.observation}\n${(e.measurements as Array<{ metric: string; value: number; baseline?: number }>).map((m) => `${m.metric}=${m.value}${m.baseline !== undefined ? ` (base ${m.baseline})` : ""}`).join("; ")}`);
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(async () => { if (globalThis._explainwhyMongoClientPromise) await (await getMongoClient()).close(); });
