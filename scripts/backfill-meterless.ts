import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { getDb, getMongoClient } from "../src/lib/mongodb";
import { COLLECTIONS } from "../src/lib/collections";
import { InvestigationReport } from "../src/intelligence/investigator/schemas";
import { captureReportMemory } from "../src/integrations/meterless/persistence";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
async function main() {
  const { values } = parseArgs({ options: { business: { type: "string", default: "nike_demo" }, run: { type: "string" } } });
  const scope = z.object({ businessId: z.string().regex(/^[a-z0-9_]{1,64}$/), simulationRunId: z.string().regex(/^[a-z0-9_]{1,64}$/) }).parse({ businessId: values.business, simulationRunId: values.run });
  const db = await getDb();
  const jobs = db.collection(COLLECTIONS.investigationJobs).find({ ...scope, status: { $in: ["completed", "insufficient_evidence"] }, completedAt: { $type: "string" }, reportId: { $type: "string" } }).sort({ _id: 1 }).batchSize(50);
  let captured = 0;
  for await (const job of jobs) {
    const source = await db.collection(COLLECTIONS.investigationReports).findOne({ ...scope, investigationId: job.investigationId, reportId: job.reportId });
    if (!source) continue;
    const report = InvestigationReport.parse(source.report);
    await captureReportMemory(db, { ...scope, investigationId: String(job.investigationId), cutoff: z.string().datetime().parse(job.cutoff) }, report);
    captured++;
  }
  console.log(JSON.stringify({ ...scope, completedReportsCaptured: captured, modelRequestsMade: 0, note: "Original report availability and virtual cutoff retained. Per-report writes are idempotent." }));
}
main().catch(() => { console.error("Memory backfill failed; check database configuration and saved report schemas"); process.exitCode = 1; }).finally(async () => { if (globalThis._explainwhyMongoClientPromise) await getMongoClient().then((client) => client.close()).catch(() => {}); });
