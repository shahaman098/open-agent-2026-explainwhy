import { artifactPath } from "./artifacts";
import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";

test.use({ extraHTTPHeaders: process.env.E2E_DEMO_KEY ? { "x-normal-demo-key": process.env.E2E_DEMO_KEY } : {} });
const advertising = JSON.parse(readFileSync("docs/stage7-runs/acceptance.json", "utf8"));
const controlled = JSON.parse(readFileSync("docs/stage8-runs/controlled-observation.json", "utf8"));
const checkout = JSON.parse(readFileSync("docs/stage6-runs/checkout-advisory.json", "utf8"));
const directory = "docs/investigation-redesign";
mkdirSync(directory, { recursive: true });

test("minimal advertising canvas opens all four detail panels and preserves saved records", async ({ page, request, isMobile }) => {
  test.setTimeout(90_000);
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().includes("/api/") && request.method() !== "GET") writes.push(request.method()); });
  const before = await (await request.get(`/api/outcomes?businessId=nike_demo&simulationRunId=${advertising.simulationRunId}`)).json();
  const reviewBefore = await (await request.get(`/api/approvals?businessId=nike_demo&simulationRunId=${advertising.simulationRunId}`)).json();
  const bundle = await (await request.get(`/api/investigations/${advertising.investigationId}?simulationRunId=${advertising.simulationRunId}`)).json();
  await page.goto(`/dashboard/investigations/${advertising.investigationId}?run=${advertising.simulationRunId}`);
  const story = page.getByTestId("incident-story");
  await expect(story).toContainText("£90.00 → £67.50/day");
  await expect(story.getByTestId("investigation-status")).toHaveText("Executed");
  await expect(story.getByTestId("canvas-decision")).toContainText("Basketball Shoes — Search (Google)");
  await expect(story.getByTestId("canvas-outcome")).toContainText("Pending measurement");
  await expect(page.getByTestId("full-report")).toHaveCount(0);
  await expect(page.getByTestId("internal-evidence-card")).toHaveCount(0);
  if (!isMobile) expect((await page.getByTestId("decision-canvas").boundingBox())!.height).toBeLessThan(610);
  await expect(page.locator(".decision-column")).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: artifactPath(`${directory}/advertising-desktop.png`) });

  await page.getByTestId("open-signal-details").click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS("animation-name", "decision-drawer-in");
  await expect(drawer.getByTestId("related-anomalies").locator("tbody tr")).toHaveCount(bundle.anomalies.length);
  await expect(drawer.getByTestId("executive-brief")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(page.getByTestId("open-signal-details")).toBeFocused();

  await page.getByTestId("open-evidence-details").click();
  const evidenceId = advertising.handoff.plan.actions[0].evidenceIds[0];
  const evidence = page.locator(`[id="evidence-${evidenceId}"]`);
  await expect(evidence).toBeVisible();
  await evidence.getByTestId("evidence-toggle").click();
  await expect(evidence.getByTestId("evidence-detail")).toBeVisible();
  const sourceLink = await evidence.getByTestId("source-link").first().getAttribute("href");
  expect((await request.get(sourceLink!)).ok()).toBe(true);

  await drawer.getByRole("button", { name: "Decision / Plan", exact: true }).click();
  await expect(drawer.getByTestId("selected-plan")).toContainText(advertising.handoff.plan.objective);
  await drawer.getByTestId("planned-action").locator("summary").click();
  await expect(drawer.getByTestId("planned-action")).toContainText("6750");
  await expect(drawer.getByTestId("execution-intake").getByRole("link", { name: "Open Approvals" })).toHaveAttribute("href", `/dashboard/approvals?run=${advertising.simulationRunId}`);

  await drawer.getByRole("button", { name: "Outcome", exact: true }).click();
  await expect(drawer.getByTestId("outcome-detail")).toContainText("pending measurement");
  await expect(drawer.getByTestId("outcome-detail")).toContainText("£67.50");
  await drawer.locator("summary").filter({ hasText: "Source records and original receipt" }).click();
  await expect(drawer.locator(".outcome-refs pre")).toContainText(before.rows[0].receipt.idempotencyKey);
  await drawer.locator(".decision-drawer-body").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: artifactPath(`${directory}/outcome-sidebar-desktop.png`) });
  await drawer.getByRole("button", { name: "Close details" }).click();
  await page.reload();
  await expect(page.getByTestId("canvas-outcome")).toContainText("Pending measurement");
  const after = await (await request.get(`/api/outcomes?businessId=nike_demo&simulationRunId=${advertising.simulationRunId}`)).json();
  expect(after).toEqual(before);
  expect(await (await request.get(`/api/approvals?businessId=nike_demo&simulationRunId=${advertising.simulationRunId}`)).json()).toEqual(reviewBefore);
  expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test("controlled comparison and unmet CTR criterion stay in their own run", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const preparation = JSON.parse(readFileSync("docs/stage8-runs/controlled-preparation.json", "utf8"));
  await page.goto(`/dashboard/investigations/${preparation.investigationId}?run=${controlled.simulationRunId}`);
  await expect(page.getByTestId("investigation-status")).toHaveText("Measured");
  await expect(page.getByTestId("canvas-outcome")).toContainText("Criteria not met");
  await expect(page.getByTestId("canvas-outcome")).toContainText("0.60% → 0.49%");
  await page.screenshot({ path: artifactPath(`${directory}/controlled-desktop.png`) });
  await page.getByTestId("open-outcome-details").click();
  const detail = page.getByTestId("outcome-detail");
  await expect(detail).toContainText("£122.31"); await expect(detail).toContainText("£91.92");
  await expect(detail).toContainText("0.60%"); await expect(detail).toContainText("0.49%");
  await expect(detail).toContainText("One or more unmet");
  await expect(detail).not.toContainText(advertising.simulationRunId);
  expect(errors).toEqual([]);
});

test("checkout keeps three advisory strategies inside its decision panel", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const job = checkout.result.job;
  await page.goto(`/dashboard/investigations/${job.investigationId}?run=${job.simulationRunId}&businessId=${job.businessId}`);
  const archive = page.getByTestId("advisory-archive");
  await expect(archive).toContainText("Advisory only");
  await expect(archive).toContainText("No executable action");
  await expect(archive.locator(".canvas-archive-strategies")).toHaveCount(0);
  await page.screenshot({ path: artifactPath(`${directory}/checkout-advisory-desktop.png`) });
  await page.getByTestId("open-decision-details").click();
  await expect(page.locator(".canvas-archive-strategies article")).toHaveCount(3);
  await expect(page.getByRole("dialog")).toContainText("No adapter action");
  await page.getByRole("dialog").getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("live source records were not recreated");
  expect(errors).toEqual([]);
});

test("unavailable measurement service leaves execution and measurement distinct", async ({ page }) => {
  await page.route("**/api/outcomes?**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Outcome service unavailable" } }) }));
  await page.goto(`/dashboard/investigations/${advertising.investigationId}?run=${advertising.simulationRunId}`);
  await expect(page.getByRole("status")).toContainText("Outcome service unavailable");
  await expect(page.getByTestId("canvas-outcome")).toContainText("Not measured");
  await expect(page.getByTestId("investigation-status")).toHaveText("Executed");
});
