import { existsSync } from "node:fs";
import { getDb, getMongoClient } from "../src/lib/mongodb";
import { Scope } from "../src/intelligence/investigator/schemas";
import { runNextPlanning } from "../src/planner/service";
import { providerConfig } from "../src/intelligence/investigator/provider";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
let stop = false;
process.on("SIGINT", () => { stop = true; }); process.on("SIGTERM", () => { stop = true; });
async function main() {
  const db = await getDb();
  const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const scope = arg("run") ? Scope.parse({ businessId: arg("business") || "nike_demo", simulationRunId: arg("run"), investigationId: arg("investigation") }) : undefined;
  const config = providerConfig();
  console.log(`Normal solution planner worker ready (${config.plannerModel}; Gemini transport ${config.geminiTransport}; planning only; no action execution)`);
  do { const worked = await runNextPlanning(db, scope); if (process.argv.includes("--once")) break; if (!worked) await new Promise((resolve) => setTimeout(resolve, 1500)); } while (!stop);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : "Planner worker failed"); process.exitCode = 1; }).finally(async () => { if (globalThis._normalMongoClientPromise) await (await getMongoClient()).close(); });
