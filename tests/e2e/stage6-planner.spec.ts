import { artifactPath } from "./artifacts";
import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { PlanHandoff, planReferenceErrors } from "@normal/contracts";

// Default: replay the saved report and strategies. E2E_LIVE_MODELS=1 permits fresh provider work.
test("completed investigation retains strategies and a non-executed canonical approval handoff", async ({ page, request }) => {
  test.setTimeout(240_000);
  const run = "stage5_1792885194280", investigation = "inv_stage5_1792885194280_d07498fe5b17";
  const endpoint = `/api/investigations/${investigation}/planning?businessId=nike_demo&simulationRunId=${run}`;
  const exec = promisify(execFile);
  await exec(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/demo-stage6.ts", "--prepare"], { timeout: 60_000 });
  await page.goto(`/dashboard/investigations/${investigation}?run=${run}`);
  await page.getByTestId("open-signal-details").click();
  await expect(page.getByTestId("executive-brief")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Decision / Plan", exact: true }).click();
  const planner = page.getByTestId("solution-planning");
  await planner.scrollIntoViewIfNeeded();
  let view = await (await request.get(endpoint)).json();
  expect(view.eligible).toBe(true);
  if (process.env.E2E_LIVE_MODELS !== "1") { expect(view.stale).toBe(false); expect(view.job?.status).toBe("submitted"); }
  if (view.stale) { await planner.getByTestId("refresh-planning").click(); await expect(planner.getByTestId("planning-status")).toHaveText("queued"); view = await (await request.get(endpoint)).json(); }
  if (!view.job) { await planner.getByTestId("generate-plan").click(); await expect(planner.getByTestId("planning-status")).toHaveText("queued"); }
  if (!view.job || ["queued", "running"].includes(view.job.status)) {
    const worker = exec(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/planner-worker.ts", "--once", `--run=${run}`, `--investigation=${investigation}`], { timeout: 180_000 });
    const workerResult = worker.then(() => null, (error: Error) => error);
    await expect(planner.getByTestId("strategy-comparison")).toBeVisible({ timeout: 160_000 });
    expect(await workerResult).toBeNull();
  }
  view = await (await request.get(endpoint)).json();
  const executable = (candidate: typeof view) => candidate.job.output.strategies.find((strategy: { actions: unknown[]; key: string }) => strategy.actions.length && candidate.job.checks.find((check: { strategyKey: string; passed: boolean }) => check.strategyKey === strategy.key)?.passed);
  if (!executable(view) && !view.job.repair && view.job.checks.some((check: { passed: boolean }) => !check.passed)) {
    await planner.getByTestId("repair-strategies").click();
    await expect(planner.getByTestId("planning-status")).toHaveText("queued");
    await exec(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/planner-worker.ts", "--once", `--run=${run}`, `--investigation=${investigation}`], { timeout: 180_000 });
    await expect(planner.getByTestId("planning-status")).toHaveText("awaiting selection", { timeout: 30000 });
    view = await (await request.get(endpoint)).json();
  }
  expect(view.job.output.strategies.length).toBeGreaterThanOrEqual(2);
  expect(view.job.output.strategies.length).toBeLessThanOrEqual(4);
  expect(view.calls.some((call: { metadata?: { requestId?: string } }) => call.metadata?.requestId?.startsWith("mreq_"))).toBe(true);
  const chosen = executable(view);
  expect(chosen, JSON.stringify(view.job.checks)).toBeTruthy();
  if (view.job.selectedKey !== chosen.key) await planner.locator(`[data-strategy-key="${chosen.key}"]`).getByRole("button", { name: "Select strategy" }).click();
  await expect(planner.getByTestId("selected-plan")).toBeVisible();
  await expect(planner.getByTestId("planned-action").first()).toContainText("£67.50");
  await expect(planner.getByTestId("planned-action").first()).toContainText("Approval required");
  view = await (await request.get(endpoint)).json();
  if (view.job.status !== "submitted") await planner.getByTestId("prepare-handoff").click();
  await expect(planner.getByTestId("planning-handoff")).toContainText(/ready for approval/i);
  await expect(planner.getByTestId("prepare-handoff")).toBeDisabled();
  const href = await planner.getByTestId("plan-handoff-link").getAttribute("href");
  const response = await request.get(href!); expect(response.ok()).toBe(true);
  const handoff = PlanHandoff.parse(await response.json());
  expect(planReferenceErrors(handoff.plan, handoff.diagnosis, handoff.evidence)).toEqual([]);
  expect(handoff.plan.status).toBe("awaiting_approval");
  expect(handoff.plan.actions.every((action) => action.requiresApproval && action.actionType === "ads.set_daily_budget")).toBe(true);
  const saved = await (await request.get(endpoint)).json();
  await planner.getByTestId("planning-history").locator("summary").click();
  await expect(planner.getByTestId("planning-history")).toContainText("awaiting approval");
  mkdirSync("docs/stage6-runs", { recursive: true });
  await planner.screenshot({ path: artifactPath("docs/stage6-runs/planning-desktop.png") });
  await page.reload();
  await page.getByTestId("open-decision-details").click();
  await expect(page.getByTestId("selected-plan")).toContainText(handoff.plan.objective);
  const refreshed = await (await request.get(endpoint)).json();
  expect(refreshed.plan).toEqual(saved.plan); expect(refreshed.calls.length).toBe(saved.calls.length);
  expect((await request.get(`${endpoint.replace(run, "other_stage6_run")}`)).ok()).toBe(true);
  expect((await (await request.get(endpoint.replace(run, "other_stage6_run"))).json()).job).toBeNull();
  expect((await request.get(href!.replace(run, "other_stage6_run"))).status()).toBe(404);
  await exec(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/demo-stage6.ts"], { timeout: 60_000 });
  writeFileSync(artifactPath("docs/stage6-runs/planning-browser.json"), JSON.stringify({ run, investigation, planId: handoff.plan.planId, planVersion: handoff.plan.planVersion,
    strategies: saved.job.output.strategies.length, requests: saved.calls.map((call: { metadata?: { requestId?: string } }) => call.metadata?.requestId), canonicalHandoff: true, persistedAcrossReload: true, demoPreserved: true, executed: false }, null, 2));
});
