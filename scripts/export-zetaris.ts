import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { BusinessEvent } from "@explainwhy/contracts";
import { getDb, getMongoClient } from "../src/lib/mongodb";
import { COLLECTIONS } from "../src/lib/collections";
import { campaignCsv } from "../src/integrations/zetaris/export";
import type { SimulatedCampaign } from "../src/types/domain";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
async function main() {
  const { values } = parseArgs({ options: { business: { type: "string", default: "nike_demo" }, run: { type: "string" }, from: { type: "string" }, to: { type: "string" }, out: { type: "string", default: ".local/zetaris-data" } } });
  const scope = z.object({ businessId: z.string().regex(/^[a-z0-9_]{1,64}$/), simulationRunId: z.string().regex(/^[a-z0-9_]{1,64}$/), window: z.object({ startAt: z.string().datetime({ offset: true }), endAt: z.string().datetime({ offset: true }) }), campaignIds: z.array(z.string()) }).parse({ businessId: values.business, simulationRunId: values.run, window: { startAt: values.from, endAt: values.to }, campaignIds: [] });
  if (Date.parse(scope.window.endAt) <= Date.parse(scope.window.startAt)) throw new Error("--to must be after --from");
  scope.window.startAt = new Date(scope.window.startAt).toISOString();
  scope.window.endAt = new Date(scope.window.endAt).toISOString();
  const db = await getDb();
  const events = await db.collection(COLLECTIONS.businessEvents).find({ businessId: scope.businessId, simulationRunId: scope.simulationRunId, type: "ad.metrics_observed", "payload.window.startAt": { $gte: scope.window.startAt }, "payload.window.endAt": { $lte: scope.window.endAt } }, { projection: { _id: 0 } }).limit(100_001).toArray();
  if (!events.length || events.length > 100_000) throw new Error("Export needs 1–100000 advertising observations; choose a narrower populated window");
  const campaigns = await db.collection<SimulatedCampaign>(COLLECTIONS.simulatedCampaigns).find({ businessId: scope.businessId, simulationRunId: scope.simulationRunId }, { projection: { _id: 0 } }).toArray();
  const data = campaignCsv(events.map((event) => BusinessEvent.parse(event)), campaigns, scope);
  const destination = resolve(values.out!); await mkdir(destination, { recursive: true });
  await writeFile(resolve(destination, "ads.csv"), data.ads); await writeFile(resolve(destination, "campaigns.csv"), data.campaigns);
  const manifest = { provider: "Zetaris", exportedAt: new Date().toISOString(), dataOrigin: "synthetic", scope, counts: data.counts, containsPersonalData: false, liveZetarisQueryVerified: false };
  await writeFile(resolve(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ ...manifest, destination }));
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Export failed"); process.exitCode = 1; }).finally(async () => { if (process.env.MONGODB_URI) await getMongoClient().then((client) => client.close()).catch(() => {}); });
