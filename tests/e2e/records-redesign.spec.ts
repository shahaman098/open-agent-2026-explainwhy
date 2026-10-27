import { artifactPath } from "./artifacts";
import { expect, test } from "@playwright/test";

test("Investigations is a focused record list with a working case link", async ({ page }) => {
  await page.goto("/dashboard/investigations?run=demo_nike");
  const index = page.getByTestId("investigations-page");
  await expect(index.getByRole("heading", { name: "Investigations" })).toBeVisible();
  await expect(index.getByText(/Advertising performance deterioration across \d+ campaigns/)).toBeVisible();
  await expect(index.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator(".section-stats")).toHaveCount(0);
  await expect(page.locator(".cr-head h1")).toHaveCount(0);
  await expect(index.getByPlaceholder("Search investigations")).toHaveCount(0);
  await index.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
  await page.screenshot({ path: artifactPath("docs/records-redesign/investigations.png") });
  await index.getByRole("link", { name: /Open Advertising performance deterioration across \d+ campaigns/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/investigations\/inv_demo_nike_d07498fe5b17\?run=demo_nike/);
});

test("Approvals shows a concise plan review and preserves selection without submitting", async ({ page }) => {
  await page.goto("/dashboard/approvals?run=stage5_1792885194280");
  const index = page.getByTestId("approvals-page");
  await expect(index.getByRole("heading", { name: "Approvals" })).toBeVisible();
  await expect(index.getByText("1 plan")).toBeVisible();
  await expect(page.locator(".cr-head h1")).toHaveCount(0);
  await page.screenshot({ path: artifactPath("docs/records-redesign/approvals-list.png") });

  await index.getByRole("button", { name: /Reduce the weakest recent campaign budget/ }).click();
  const review = page.getByRole("region", { name: "Selected plan review" });
  await expect(review.getByText("£67.50")).toBeVisible();
  await expect(review.getByText("Supporting evidence")).toBeVisible();
  await expect(review.locator("pre")).toHaveCount(0);
  await expect(review.getByRole("button", { name: "Approve exact version" })).toBeEnabled();
  await review.getByText("Supporting evidence").click();
  await expect(review.locator(".plan-evidence p").first()).toBeVisible();
  await review.getByText("Supporting evidence").click();
  await review.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
  await page.screenshot({ path: artifactPath("docs/records-redesign/approvals-review.png"), fullPage: true });
  await review.getByRole("checkbox").uncheck();
  await expect(review.getByText("0 of 1 selected")).toBeVisible();
  await expect(review.getByRole("button", { name: "Approve selected" })).toBeDisabled();
  await expect(review.getByRole("link", { name: "View investigation" })).toHaveAttribute("href", /inv_stage5_1792885194280_d07498fe5b17.*run=stage5_1792885194280/);
});

test("Approvals has a useful empty state for the demo run", async ({ page }) => {
  await page.goto("/dashboard/approvals?run=demo_nike");
  await expect(page.getByText("No plans are waiting in this run.", { exact: false })).toBeVisible();
});

test("Approvals reads an existing executed plan without offering a second decision", async ({ page }) => {
  await page.goto("/dashboard/approvals?run=stage7_1792893488465");
  const index = page.getByTestId("approvals-page");
  await expect(index.locator(".approval-list-row")).toHaveCount(1);
  await index.locator(".approval-list-row").click();
  const review = page.getByRole("region", { name: "Selected plan review" });
  await expect(review.getByTestId("approval-decision")).toContainText("approved");
  await expect(review.getByTestId("execution-results")).toContainText("succeeded");
  await expect(review.getByRole("button", { name: "Approve exact version" })).toHaveCount(0);
});
