import { artifactPath } from "./artifacts";
import { expect, test } from "@playwright/test";

const RUN = "demo_nike";
const SHOTS = "docs/signals-redesign";

test("consolidated incident inbox and accessible detail drawer", async ({ page, request }) => {
  const response = await request.get(`/api/signals?businessId=nike_demo&simulationRunId=${RUN}&limit=100`);
  expect(response.ok()).toBe(true);
  const groups = await response.json();
  const advertising = groups.items.find((group: { incidentTitle: string | null; metric: string }) => group.metric === "ctr" && group.incidentTitle?.includes("Advertising"));
  expect(advertising).toBeTruthy();
  expect(advertising.headline.changePercent).toBeCloseTo(-82.4, 1);

  await page.goto(`/dashboard/signals?run=${RUN}`);
  const card = page.getByTestId("signal-group").filter({ hasText: "Advertising performance deterioration" });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("5 affected campaigns");
  await expect(card).toContainText("-82.4%");
  await expect(card).toContainText("Current");
  await expect(card).toContainText("Baseline");
  await expect(page.locator(".inbox-header")).toHaveCount(0);
  const impact = card.getByTestId("signal-impact");
  await expect(impact).toBeVisible();
  await expect(impact.getByTestId("signal-impact-row")).toHaveCount(5);
  await expect(impact.getByTestId("signal-impact-row").first()).toContainText("-85.5%");
  await expect(impact.locator(".inbox-impact-fill").last()).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await expect(page.locator(".inbox-chart-frame")).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await page.screenshot({ path: artifactPath(`${SHOTS}/default-desktop.png`), fullPage: true });

  const campaign = impact.getByTestId("signal-impact-row").first();
  await campaign.click();
  await expect(page.getByTestId("signal-drawer").locator(".inbox-drawer-metrics")).toContainText("-85.5%");
  await expect(page.getByTestId("signal-drawer")).toContainText("Pegasus 42");
  await expect(page.getByTestId("signal-drawer").locator(".inbox-chart svg")).toBeVisible();
  await expect(page.getByTestId("signal-drawer")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await page.screenshot({ path: artifactPath(`${SHOTS}/campaign-drawer-desktop.png`) });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("signal-drawer")).toHaveCount(0);
  await expect(campaign).toBeFocused();

  const detailsButton = card.getByRole("button", { name: "View details", exact: true });
  await detailsButton.focus();
  await detailsButton.click();
  const drawer = page.getByTestId("signal-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS("transition-duration", "0.25s");
  await expect(drawer).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  const overlayBox = await page.getByTestId("signal-drawer-overlay").boundingBox();
  expect(overlayBox).toMatchObject({ x: 0, y: 0, ...page.viewportSize()! });
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(page.getByRole("button", { name: "Close details" })).toBeFocused();
  await expect(drawer).toContainText("-82.4%");
  await expect(drawer).toContainText("5 affected campaigns");
  await expect(drawer.locator(".inbox-chart svg")).toBeVisible();
  await expect(drawer.locator(".inbox-chart-frame")).toHaveCSS("height", "238px");
  await expect(drawer.getByTestId("signal-observation")).toHaveCount(4);
  await drawer.getByRole("button", { name: "Show all 5 observations" }).click();
  await expect(drawer.getByTestId("signal-observation")).toHaveCount(5);
  const evidenceLink = drawer.getByRole("link", { name: "Open source" }).first();
  await expect(evidenceLink).toHaveAttribute("href", /\/api\/dev\/simulator\/events\?/);
  const source = await request.get((await evidenceLink.getAttribute("href"))!);
  expect(source.ok()).toBe(true);
  await expect(drawer.getByRole("heading", { name: "Investigator summary" })).toHaveCount(0);
  const scroll = drawer.locator(".inbox-drawer-scroll");
  expect(await scroll.evaluate((element) => element.scrollHeight)).toBeGreaterThan(await scroll.evaluate((element) => element.clientHeight));
  await expect(drawer.getByRole("link", { name: "Open full investigation" })).toHaveAttribute("href", new RegExp(`/dashboard/investigations/${advertising.investigationId}\\?run=${RUN}$`));
  await drawer.getByRole("heading", { name: "Evidence" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: artifactPath(`${SHOTS}/drawer-evidence-desktop.png`) });
  await drawer.locator(".inbox-drawer-scroll").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: artifactPath(`${SHOTS}/drawer-desktop.png`) });

  await drawer.getByRole("link", { name: "Open full investigation" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close details" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("link", { name: "Open full investigation" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(detailsButton).toBeFocused();
  await detailsButton.click();
  await expect(page.getByTestId("signal-drawer-overlay")).toHaveClass(/is-open/);
  await page.getByTestId("signal-drawer-overlay").click({ position: { x: 50, y: 200 } });
  await expect(drawer).toHaveCount(0);
  await detailsButton.click();
  await drawer.getByRole("link", { name: "Open full investigation" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/investigations/${advertising.investigationId}\\?run=${RUN}$`));
  await expect(page.getByTestId("incident-overview")).toHaveAttribute("data-investigation-id", advertising.investigationId);
});

test("a different run does not show the preserved demo incident", async ({ page }) => {
  await page.goto("/dashboard/signals?run=e2e_missing_stage4");
  await expect(page.getByTestId("signal-group")).toHaveCount(0);
  await expect(page.getByText("No incidents detected for this run.")).toBeVisible();
});
