import { existsSync } from "node:fs";
import { getDb, getMongoClient } from "../src/lib/mongodb";
import { ensureInvestigatorIndexes } from "../src/intelligence/investigator/store";
import { runNextInvestigation } from "../src/intelligence/investigator/controller";
import { Scope } from "../src/intelligence/investigator/schemas";
import { providerConfig } from "../src/intelligence/investigator/provider";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
let stop = false;
process.on("SIGINT", () => { stop = true; }); process.on("SIGTERM", () => { stop = true; });
async function main() {
  const db = await getDb(); await ensureInvestigatorIndexes(db);
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const scope = arg("run") ? Scope.parse({ businessId: arg("business") || "nike_demo", simulationRunId: arg("run"), investigationId: arg("investigation") }) : undefined;
  const config = providerConfig();
  console.log(`Normal investigation worker ready (${config.investigatorModel}; diagnosis ${config.diagnosisModel}; Gemini transport ${config.geminiTransport})`);
  do { const worked = await runNextInvestigation(db, scope); if (process.argv.includes("--once")) break; if (!worked) await new Promise((resolve) => setTimeout(resolve, 1500)); } while (!stop);
}
main().catch(() => { console.error("Investigation worker stopped: database or configuration failure"); process.exitCode = 1; }).finally(async () => { if (globalThis._normalMongoClientPromise) await (await getMongoClient()).close(); });
