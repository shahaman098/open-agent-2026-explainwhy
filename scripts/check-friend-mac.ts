import { existsSync } from "node:fs";
import { totalmem, platform, arch } from "node:os";
import { DocClient, poolConfigFromUrl } from "../src/lib/docstore/client";
import { getDbName } from "../src/lib/mongodb";
import { z } from "zod";
import { providerConfig, callModel } from "../src/intelligence/investigator/provider";
import { brightDataStatus, searchBrightData } from "../src/integrations/brightdata/search";
import { zetarisConfig, zetarisStatus } from "../src/integrations/zetaris/config";
import { studioBase, studioStatus } from "../src/integrations/animation-studio/client";
import { HMEM } from "../src/vendor/meterless-hmem";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const live = process.argv.includes("--live");
type Check = { status: "blocked" | "configured" | "verified"; detail: string };
const checks: Record<string, Check> = {};
const blockedDetail: Record<string, string> = {
  nemotron: "Set NVIDIA_INFERENCE_MODE=local and a working loopback /v1 endpoint/model, or configure the hosted NVIDIA key. Run --live to test JSON output.",
  brightdata: "Enable external research, select brightdata, and set BRIGHTDATA_API_KEY plus a valid BRIGHTDATA_SERP_ZONE. A live failure may indicate credentials, zone, quota or connectivity.",
  zetaris: "Enable Zetaris and configure its running endpoint, token, numeric organisation ID and both registered relation names. Local images require authorized access.",
  animation_studio: "Enable the animation bridge, start Studio on the same Mac, and check its loopback endpoint plus Blender/FFmpeg installation.",
  mongodb: "Configure a reachable MongoDB transaction-capable deployment and its database name.",
};
async function check(name: string, action: () => Promise<Check>) {
  try { checks[name] = await action(); }
  catch { checks[name] = { status: "blocked", detail: blockedDetail[name] || `${name} failed its check; no upstream response body or credential is printed.` }; }
}
async function main() {
  await check("nemotron", async () => {
    const config = providerConfig();
    if (live) {
      const response = await callModel({ model: config.investigatorModel, system: "Return only the requested JSON acknowledgement.", input: "Return ok true.", schema: z.object({ ok: z.literal(true) }), schemaName: "host_connectivity", maxOutputTokens: 1024 });
      return { status: "verified", detail: `${config.local ? "Local" : "Hosted"} ${config.investigatorModel}: JSON acknowledgement verified; request ${response.metadata.requestId}. This is not a diagnosis-quality evaluation.` };
    }
    return { status: "configured", detail: `${config.local ? "Local" : "Hosted"} ${config.investigatorModel}; no inference request made.` };
  });
  await check("brightdata", async () => {
    if (!brightDataStatus().configured || process.env.EXPLAINWHY_EXTERNAL_RESEARCH_ENABLED !== "true" || process.env.EXPLAINWHY_RESEARCH_PROVIDER !== "brightdata") throw new Error();
    if (live) { const result = await searchBrightData("site:ons.gov.uk retail sales official statistics"); return { status: "verified", detail: `${result.candidates.length} public source candidates; request ${result.requestId}. Publisher retrieval/claim review still happens in the investigation.` }; }
    return { status: "configured", detail: "Bright Data SERP zone and research routing configured; no search request made." };
  });
  await check("zetaris", async () => {
    zetarisConfig();
    return { status: "configured", detail: "Credentials/relations configured. Use npm run sponsors:check -- --live --business … --run … --from … --to … to verify a scoped query, then collect evidence to verify canonical metrics." };
  });
  await check("meterless_hmem", async () => {
    const memory = new HMEM(); memory.add({ content: "Financial chart baseline comparison", type: "factual", layer: "working", confidence: 0.7, source: "preflight_fixture", chatId: "preflight" });
    if (!memory.query("Financial chart baseline comparison", { chatId: "preflight" }).memories.length) throw new Error();
    return { status: "verified", detail: "Actual H-MEM engine add/recall passed using a labelled in-memory fixture. Persistent investigation recall requires the database and an earlier published report." };
  });
  await check("animation_studio", async () => {
    const base = studioBase();
    if (live) { const status = await studioStatus(); if (!status.ready) throw new Error(); return { status: "verified", detail: `${base}: renderer readiness endpoint passed. No render submitted.` }; }
    return { status: "configured", detail: `${base}; no render submitted.` };
  });
  await check("supabase_postgres", async () => {
    if (!process.env.DATABASE_URL?.trim()) throw new Error();
    if (live) { const client = new DocClient(poolConfigFromUrl(process.env.DATABASE_URL)); try { await client.db(getDbName()).command({ ping: 1 }); } finally { await client.close(); } }
    return { status: live ? "verified" : "configured", detail: live ? "Database ping succeeded; no application records modified." : "Database URL present; connectivity not checked." };
  });
  const configured = Object.values(checks).every((value) => value.status !== "blocked");
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), live, host: { platform: platform(), arch: arch(), memoryGiB: Math.round(totalmem() / 1024 ** 3) }, checks, zetarisMissing: zetarisStatus().missing, configured, endToEndVerified: false }, null, 2));
  if (!configured) process.exitCode = 1;
}
main().catch(() => { console.error("Host preflight could not complete."); process.exitCode = 1; });
