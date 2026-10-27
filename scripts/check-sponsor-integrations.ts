import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { recallHistoricalMemories } from "../src/integrations/meterless/history";
import { zetarisConfig, zetarisStatus } from "../src/integrations/zetaris/config";
import { queryZetaris } from "../src/integrations/zetaris/client";
import { campaignQuery, CampaignRow } from "../src/integrations/zetaris/campaigns";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
async function main() {
  const { values } = parseArgs({ options: { live: { type: "boolean", default: false }, business: { type: "string", default: "nike_demo" }, run: { type: "string" }, from: { type: "string" }, to: { type: "string" } } });
  // A labelled fixture verifies the real H-MEM engine without a model request or database writes.
  const scope = { businessId: "sponsor_fixture", simulationRunId: "fixture_run", investigationId: "current", cutoff: "2026-10-24T12:00:00.000Z", availableBefore: "2026-10-27T12:00:00.000Z" };
  const recall = recallHistoricalMemories(scope, "Advertising campaign clicks spend investigation", [{ ...scope, investigationId: "prior", reportId: "fixture_report", observedThrough: "2026-10-23T12:00:00.000Z", availableAt: "2026-10-26T12:00:00.000Z", title: "Advertising campaign clicks spend investigation", themes: ["advertising"], metrics: ["clicks", "spend"], summaries: ["Check tracking and campaign delivery before making changes."] }]);
  const meterlessPassed = recall.memories.length === 1 && recall.ledger.some((entry) => entry.action === "read");
  let zetaris: Record<string, unknown> = { ...zetarisStatus(), liveQueryVerified: false, status: "not_checked" };
  let failure: string | null = null;
  if (values.live) {
    try {
      const queryScope = z.object({ businessId: z.string().regex(/^[a-z0-9_]{1,64}$/), simulationRunId: z.string().regex(/^[a-z0-9_]{1,64}$/), window: z.object({ startAt: z.string().datetime({ offset: true }), endAt: z.string().datetime({ offset: true }) }), campaignIds: z.array(z.string()) }).parse({ businessId: values.business, simulationRunId: values.run, window: { startAt: values.from, endAt: values.to }, campaignIds: [] });
      const config = zetarisConfig(), result = await queryZetaris(campaignQuery(queryScope, config), { config });
      const rows = result.records.map((record) => CampaignRow.parse(record));
      if (!rows.length) throw new Error("Live Zetaris query returned no observations; no integration success recorded");
      if (rows.some((row) => row.business_id !== queryScope.businessId || row.simulation_run_id !== queryScope.simulationRunId || Date.parse(row.window_start) < Date.parse(queryScope.window.startAt) || Date.parse(row.window_end) > Date.parse(queryScope.window.endAt))) throw new Error("Live Zetaris query returned out-of-scope data");
      zetaris = { enabled: true, configured: true, liveQueryVerified: true, status: "queried", receipt: result.receipt, canonicalEvidenceVerified: false, note: "Connectivity and schema check only. Collect investigation evidence to verify every metric against canonical events." };
    } catch (error) { failure = error instanceof Error ? error.message : "Zetaris check failed"; zetaris = { ...zetaris, status: "failed", error: failure }; }
  }
  const report = { checkedAt: new Date().toISOString(), meterless: { passed: meterlessPassed, fixture: true, recall }, zetaris, submissionComplianceVerified: false };
  await mkdir("docs/sponsor-integrations", { recursive: true });
  await writeFile("docs/sponsor-integrations/latest-check.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (!meterlessPassed || failure) process.exitCode = 1;
}
main().catch(() => { console.error("Sponsor check failed; inspect configuration and command arguments"); process.exitCode = 1; });
