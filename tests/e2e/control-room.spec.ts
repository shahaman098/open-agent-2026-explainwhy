import { expect, test } from "@playwright/test";
import { E2E_RUN, resetE2ERun } from "./helpers";
import { fillVerified } from "./form-fill";

test.describe.serial("business control room", () => {
  test.beforeAll(async ({ request }) => { await resetE2ERun(request, 42); });

  test("starts from a seed, advances time, renders database-backed metrics and charts", async ({ page, request }) => {
    await page.goto("/dev/simulator");
    await expect(page.getByText("Nike names and imagery are used in an unaffiliated synthetic simulation.", { exact: false }).first()).toBeVisible();
    await fillVerified(page, { "Seed": "42", "Run id (optional)": E2E_RUN });
    await page.getByTestId("start-run").click();
    await expect(page.getByTestId("notice")).toContainText(`Run ${E2E_RUN} created`);
    await expect(page.getByTestId("virtual-time")).toContainText("01 Oct 00:00");

    await page.getByTestId("tick-24").click();
    await expect(page.getByTestId("notice")).toContainText("Advanced 24h", { timeout: 90_000 });
    await expect(page.getByTestId("virtual-time")).toContainText("02 Oct 00:00");

    // KPIs and charts must match the API, not decoration.
    const breakdown = await (await request.get(`/api/metrics/breakdown?simulationRunId=${E2E_RUN}&days=7`)).json();
    expect(breakdown.total.counters.orders).toBeGreaterThan(5);
    const kpis = page.getByTestId("kpis");
    await expect(kpis).toContainText(`${breakdown.total.counters.orders} orders`);
    await expect(page.getByTestId("revenue-chart").locator("[data-mark=bar]")).toHaveCount(breakdown.daily.length);
    await expect(page.getByTestId("ctr-chart").locator("[data-mark=line]")).toHaveCount(1);
    await expect(page.getByTestId("campaigns-table").locator("tbody tr")).toHaveCount(5);
    await expect(page.getByTestId("inventory-table").locator("tbody tr")).toHaveCount(17);
    await expect(page.getByTestId("events-log").locator(".event").first()).toBeVisible();
  });

  test("injects a scenario, and refreshing preserves MongoDB-backed state", async ({ page, request }) => {
    await page.goto("/dev/simulator");
    await page.locator("select").first().selectOption(E2E_RUN);
    await expect(page.getByTestId("scenario-pill")).toContainText("Healthy baseline");
    await fillVerified(page, { "Scenario": "Ad fatigue", "Severity": "0.8" });
    await page.getByTestId("inject").click();
    await expect(page.getByTestId("notice")).toContainText("Ad fatigue active at severity 0.80");
    await expect(page.getByTestId("scenario-pill")).toContainText("Ad fatigue · 0.80");
    const before = await page.getByTestId("virtual-time").textContent();

    await page.reload();
    await page.locator("select").first().selectOption(E2E_RUN);
    await expect(page.getByTestId("scenario-pill")).toContainText("Ad fatigue · 0.80");
    await expect(page.getByTestId("virtual-time")).toHaveText(before!);
    const state = await (await request.get(`/api/dev/simulator/state?simulationRunId=${E2E_RUN}`)).json();
    expect(state.run.activeScenario).toBe("ad_fatigue");
    expect(JSON.stringify(state)).not.toContain("ctrFatigueStrength");
  });

  test("+72h exceeds the canonical 60-tick request limit and is advanced as sequential requests", async ({ page, request }) => {
    test.setTimeout(240_000);
    await page.goto("/dev/simulator");
    await page.locator("select").first().selectOption(E2E_RUN);
    await expect(page.getByTestId("virtual-time")).toContainText("02 Oct 00:00");
    await page.getByTestId("tick-72").click();
    await expect(page.getByTestId("notice")).toContainText("Advanced 72h", { timeout: 200_000 });
    await expect(page.getByTestId("virtual-time")).toContainText("05 Oct 00:00");
    const state = await (await request.get(`/api/dev/simulator/state?simulationRunId=${E2E_RUN}`)).json();
    expect(state.run.virtualTime).toBe("2026-10-05T00:00:00.000Z");
  });
});
