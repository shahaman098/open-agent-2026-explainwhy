import { artifactPath } from "./artifacts";
import { expect, test } from "@playwright/test";

test("Activity shows run-scoped tools and compact filters without the old dashboard blocks", async ({ page, request }) => {
  await page.goto("/dashboard/activity?run=demo_nike");
  const stream = page.getByTestId("activity-page");
  await expect(stream.getByText("Activity stream")).toBeVisible();
  await expect(stream.getByText("Advertising Analysis")).toBeVisible();
  const activity = await (await request.get("/api/activity?businessId=nike_demo&simulationRunId=demo_nike")).json();
  const advertising = activity.items.find((item: {title: string}) => item.title === "Advertising Analysis");
  expect(advertising).toBeTruthy();
  await expect(stream.getByText(advertising.detail, { exact: true })).toBeVisible();
  await expect(stream.getByText("Mubit agent call", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Agent execution activity")).toHaveCount(0);
  await expect(page.getByText("Recent events")).toHaveCount(0);
  await expect(page.locator(".cr-head h1")).toHaveCount(0);
  await expect(page.locator(".activity-row[data-kind='tool']").first()).toBeVisible();
  const otherBusiness = await page.request.get("/api/activity?businessId=other_demo&simulationRunId=demo_nike");
  expect(otherBusiness.ok()).toBeTruthy();
  expect((await otherBusiness.json()).items).toEqual([]);
  await stream.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
  await page.screenshot({ path: artifactPath("docs/activity-redesign/default.png") });

  await stream.getByRole("button", { name: "Agents & tools" }).click();
  await expect(page.locator(".activity-row[data-kind='business']")).toHaveCount(0);
  await stream.getByPlaceholder("Search activity").fill("advertising");
  await expect(page.locator(".activity-row")).toHaveCount(1);
  await expect(page.getByText("Advertising Analysis")).toBeVisible();
  await stream.getByPlaceholder("Search activity").fill("");
  await stream.getByLabel("Filter by status").selectOption("empty");
  await expect(page.getByText("Historical Incidents")).toBeVisible();
  await expect(page.getByText("Advertising Analysis")).toHaveCount(0);
  await stream.getByLabel("Filter by status").selectOption("all");
  await stream.getByRole("button", { name: "Business data" }).click();
  await expect(page.locator(".activity-row[data-kind='business']").first()).toBeVisible();
  await expect(page.locator(".activity-row[data-kind='tool']")).toHaveCount(0);
});

test("Activity shows persisted Mubit agent calls and links to investigation", async ({ page }) => {
  await page.goto("/dashboard/activity?run=stage5_1792885194280");
  const stream = page.getByTestId("activity-page");
  await expect(stream.getByText("Mubit agent call · Solution planning").first()).toBeVisible();
  await stream.getByRole("button", { name: "Agents & tools" }).click();
  await stream.getByPlaceholder("Search activity").fill("root cause diagnosis");
  await expect(stream.getByText("Mubit agent call · Root cause diagnosis")).toBeVisible();
  await page.screenshot({ path: artifactPath("docs/activity-redesign/mubit-filter.png"), fullPage: true });
  await stream.getByRole("link", { name: "Open Mubit agent call · Root cause diagnosis" }).click();
  await expect(page).toHaveURL(/\/dashboard\/investigations\/inv_stage5_1792885194280_d07498fe5b17/);
});
