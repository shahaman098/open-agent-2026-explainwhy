import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { financialAnimation } from "../src/integrations/animation-studio/scene";
import { submitAnimation, readStudioJob } from "../src/integrations/animation-studio/client";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const folder = ".local/animation-check";
async function main() {
  const packet = financialAnimation({ businessId: "animation_fixture", simulationRunId: "fixture_run", investigationId: "fixture_investigation" }, {
    simulationRunId: "fixture_run", dataOrigin: "simulated", verification: { passed: true },
    evidence: { schemaVersion: 1, businessId: "animation_fixture", investigationId: "fixture_investigation", evidenceId: "fixture_revenue_comparison", category: "sales",
      title: "Synthetic revenue comparison for renderer verification", observation: "Fixture only; no real business or model diagnosis.",
      measurements: [{ metric: "revenue_minor", value: 75000, baseline: 100000, unit: "GBP minor units" }],
      sourceRecords: [{ collection: "fixture", recordId: "synthetic_animation_test" }], retrievedAt: "2026-10-27T12:00:00.000Z" },
  }, "revenue_minor");
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/packet.json`, JSON.stringify(packet, null, 2) + "\n");
  console.log(`Labelled fixture packet written to ${folder}/packet.json. No model request made.`);
  if (!process.argv.includes("--render")) return;
  const job = await submitAnimation(packet);
  // Save immediately. If the polling process stops, inspect this ID instead of creating another render.
  await writeFile(`${folder}/receipt.json`, JSON.stringify({ fixture: true, animationId: packet.animationId, studioJobId: job.id, status: job.status }, null, 2) + "\n");
  console.log(`Studio accepted fixture job ${job.id}.`);
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    const current = await readStudioJob(job.id);
    if (["complete", "failed", "cancelled", "interrupted"].includes(current.status)) {
      await writeFile(`${folder}/receipt.json`, JSON.stringify({ fixture: true, animationId: packet.animationId, ...current, endToEndSponsorInvestigation: false }, null, 2) + "\n");
      console.log(JSON.stringify(current));
      if (current.status !== "complete") process.exitCode = 1;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("Render wait expired; inspect the saved job ID before submitting another render.");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Animation verification failed"); process.exitCode = 1; });
