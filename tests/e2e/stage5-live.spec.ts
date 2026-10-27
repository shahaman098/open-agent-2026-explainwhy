import { artifactPath } from "./artifacts";
import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";

// Replay a recorded report by default. Explicit prepared scopes may opt into a live provider run.
const run = process.env.STAGE5_LIVE_RUN ?? "stage5_1792885194280";
const investigation = process.env.STAGE5_LIVE_INV ?? "inv_stage5_1792885194280_d07498fe5b17";
test("detected incident retains its verified report and evidence", async ({ page, request }, info) => {
  test.setTimeout(720_000);
  const endpoint = `/api/investigations/${investigation}/ai?simulationRunId=${run}`;
  const snapshots: Array<{ status: string; stage: string; evidence: number; tools: number }> = [];
  page.on("response", async (response) => {
    if (response.url().includes(`/api/investigations/${investigation}/ai?`) && response.request().method() === "GET") {
      const body = await response.json().catch(() => null);
      if (body?.state) snapshots.push({ status: body.state.status, stage: body.state.stage, evidence: body.state.evidenceIds.length, tools: body.state.toolCount });
    }
  });
  await page.goto(`/dashboard/investigations/${investigation}?run=${run}`);
  await expect(page.getByTestId("incident-overview")).toHaveAttribute("data-investigation-id", investigation!);
  await page.getByTestId("open-signal-details").click();
  const initial = await (await request.get(endpoint)).json();
  if (process.env.E2E_LIVE_MODELS !== "1") expect(initial.report, "Recorded report fixture must exist; live provider work is opt-in").toBeTruthy();
  if (!initial.report) {
    await page.getByTestId("start-ai").click();
    await expect(page.getByTestId("ai-status")).toHaveText("queued");
    const worker = promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/investigator-worker.ts", "--once", `--run=${run}`, `--investigation=${investigation}`], { timeout: 660_000 });
    // Attach a handler immediately so a worker failure cannot become an unhandled rejection.
    const workerResult = worker.then(() => null, (error: Error) => error);
    await expect(page.getByTestId("ai-status")).toHaveText("running", { timeout: 60_000 });
    await expect(page.getByTestId("hypothesis-comparison")).toBeVisible({ timeout: 180_000 });
    await page.getByRole("dialog").getByRole("button", { name: "Evidence", exact: true }).click();
    await expect(page.getByTestId("evidence-item").first()).toBeVisible({ timeout: 300_000 });
    expect(await workerResult).toBeNull();
    expect(snapshots.some((s) => s.status === "running" && s.evidence > 0 && s.tools > 0)).toBe(true);
  }
  await page.getByRole("dialog").getByRole("button", { name: "Signal", exact: true }).click();
  await expect(page.getByTestId("executive-brief")).toBeVisible({ timeout: 60_000 });
  const result = await (await request.get(endpoint)).json();
  expect(["completed", "insufficient_evidence"]).toContain(result.state.status);
  expect(result.report.validation.passed).toBe(true);
  expect(result.report.sections.length).toBeGreaterThanOrEqual(7);
  expect(result.report.executiveBrief.explanation).toBe(result.report.diagnosis.summary);
  expect(result.report.handoff.diagnosisId).toBe(result.report.diagnosisId);
  expect(result.report.handoff.executable).toBe(false);
  expect(result.calls.filter((c: { metadata?: { requestId?: string } }) => c.metadata?.requestId?.startsWith("mreq_")).length).toBeGreaterThan(1);
  const cited = [...new Set<string>(result.report.diagnosis.hypotheses.flatMap((h: { evidenceIds: string[]; counterEvidenceIds: string[] }) => [...h.evidenceIds, ...h.counterEvidenceIds]))];
  expect(cited.length).toBeGreaterThan(0);
  const ledgerIds = new Set<string>(result.report.ledger.map((entry: { evidenceId: string }) => entry.evidenceId));
  for (const claim of result.report.claims as Array<{ evidenceIds: string[]; counterEvidenceIds: string[]; sourceIds: string[] }>) {
    for (const id of [...claim.evidenceIds, ...claim.counterEvidenceIds, ...claim.sourceIds]) expect(ledgerIds.has(id)).toBe(true);
  }
  if (result.report.impact.evidenceId) expect(ledgerIds.has(result.report.impact.evidenceId)).toBe(true);
  for (const id of cited) {
    const link = result.report.ledger.find((l: { evidenceId: string }) => l.evidenceId === id).sourceLinks[0];
    expect((await request.get(link)).ok()).toBe(true);
  }
  await expect(page.getByTestId("internal-evidence-card").first()).toBeVisible();
  const campaignCard = page.locator(".investigation-evidence-card.evidence-campaign").first();
  if (await campaignCard.count()) {
    const evidenceList = await (await request.get(`/api/investigations/${investigation}/evidence?simulationRunId=${run}&limit=100`)).json();
    const cardId = await campaignCard.getAttribute("data-evidence-id");
    const campaignItem = evidenceList.items.find((item: { evidence: { evidenceId: string } }) => item.evidence.evidenceId === cardId);
    expect(campaignItem?.campaignMetadata?.length).toBeGreaterThan(0);
    await expect(campaignCard.locator(".investigation-campaign-rows")).toContainText(campaignItem.campaignMetadata[0].name);
    await expect(campaignCard.locator(".investigation-campaign-rows")).toContainText("meta ads");
    await expect(campaignCard.locator(".investigation-campaign-rows a").first()).toHaveAttribute("href", /\/dashboard\/campaigns\/.*\?run=/);
  }
  await page.getByTestId("hypothesis-comparison").locator("summary").first().click();
  await expect(page.getByTestId("hypothesis-comparison").locator("details").first()).toHaveAttribute("open", "");
  const firstCitation = page.getByTestId("executive-brief").locator("a.investigation-citation").first();
  if (await firstCitation.count()) {
    const citationTarget = decodeURIComponent((await firstCitation.getAttribute("href"))!.slice(1));
    await firstCitation.click();
    const target = page.locator(`[id="${citationTarget}"]`);
    await expect(target).toHaveAttribute("data-testid", "evidence-item");
    await expect(target).toBeVisible();
    await target.getByTestId("evidence-toggle").click();
    await expect(target.getByTestId("evidence-detail")).toBeVisible();
  }
  await page.getByRole("dialog").getByRole("button", { name: "Signal", exact: true }).click();
  await page.getByTestId("ai-timeline").locator("summary").first().click();
  await expect(page.getByTestId("ai-timeline")).toHaveAttribute("open", "");
  await expect(page.getByTestId("ai-timeline").locator(".investigation-activity-step").first()).toContainText("ms");
  for (const id of ["full-report", "claim-matrix", "planner-readiness", "report-validation"]) {
    await page.getByTestId(id).locator("summary").click();
    await expect(page.getByTestId(id)).toHaveAttribute("open", "");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  mkdirSync("docs/stage5-runs", { recursive: true });
  await page.screenshot({ path: artifactPath(`docs/stage5-runs/${run}_${info.project.name}.png`), fullPage: true });
  await page.reload();
  await page.getByTestId("open-signal-details").click();
  await expect(page.getByTestId("executive-brief")).toContainText(result.report.diagnosis.summary);
  const refreshed = await (await request.get(endpoint)).json();
  expect(refreshed.report).toEqual(result.report);
  expect(refreshed.calls.length).toBe(result.calls.length);
  writeFileSync(artifactPath(`docs/stage5-runs/${run}_${info.project.name}_browser.json`), JSON.stringify({ investigation, run, snapshots, reportId: result.report.reportId, requestIds: result.calls.map((c: { metadata?: { requestId?: string } }) => c.metadata?.requestId).filter(Boolean), citationsResolved: cited.length, persistedAcrossReload: true, viewport: info.project.use.viewport }, null, 2));
});
