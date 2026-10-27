import { expect, test } from "@playwright/test";

const RUN = "e2e_monitor";

test.describe.serial("anomaly monitor", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    const start = await request.post("/api/dev/simulator/start", { data: { simulationRunId: RUN, seed: 42, reset: true, makeActive: false } });
    expect(start.status()).toBe(201);
    for (const ticks of [36, 36]) expect((await request.post("/api/dev/simulator/tick", { data: { simulationRunId: RUN, ticks } })).ok()).toBe(true);
    expect((await request.post("/api/dev/simulator/inject", { data: { simulationRunId: RUN, scenario: "ad_fatigue", severity: 0.8 } })).ok()).toBe(true);
    const tick = await request.post("/api/dev/simulator/tick", { data: { simulationRunId: RUN, ticks: 24 } });
    expect(tick.ok()).toBe(true);
    expect(tick.headers()["x-normal-auto-monitor"]).toBe("scheduled");
  });

  test("automatic post-tick monitoring analyses the newest hour without a manual scan", async ({ request }) => {
    await expect.poll(async () => (await (await request.get(`/api/dev/monitor/run?simulationRunId=${RUN}`)).json()).lastAsOf, { timeout: 90_000, intervals: [1_000] })
      .toBe("2026-10-05T00:00:00.000Z");
    const inv = await (await request.get(`/api/investigations?simulationRunId=${RUN}`)).json();
    expect(inv.total).toBe(1);
  });

  test("shows API-backed incidents and anomalies, runs an idempotent scan, filters by severity and opens the investigation", async ({ page, request }) => {
    await page.goto("/dev/monitor");
    await expect(page.getByText("Nike names and imagery are used in an unaffiliated synthetic simulation.", { exact: false }).first()).toBeVisible();
    await page.getByTestId("monitor-run-select").selectOption(RUN);
    const api = await (await request.get(`/api/anomalies?simulationRunId=${RUN}&limit=100`)).json();
    await expect(page.getByTestId("anomaly-total")).toHaveText(String(api.total));
    await expect(page.getByTestId("anomaly-row")).toHaveCount(api.items.length);
    await expect(page.getByTestId("incident").first()).toContainText("Advertising performance deterioration");

    await page.getByTestId("run-scan").click();
    await expect(page.getByTestId("scan-summary")).toContainText("repeat of an already processed window");
    await expect(page.getByTestId("anomaly-total")).toHaveText(String(api.total));

    const critical = await (await request.get(`/api/anomalies?simulationRunId=${RUN}&severity=critical&limit=100`)).json();
    await page.getByTestId("sev-critical").click();
    await expect(page.getByTestId("anomaly-row")).toHaveCount(critical.items.length);

    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByTestId("anomaly-row").first().click();
    await expect(page.getByTestId("anomaly-reason")).toContainText("observation, not a diagnosis");

    await page.getByTestId("open-investigation").first().click();
    const panel = page.getByTestId("investigation-panel");
    await expect(panel).toContainText("Advertising performance deterioration");
    await expect(panel).toContainText("no diagnosis has been made");

    await page.reload();
    await page.getByTestId("monitor-run-select").selectOption(RUN);
    await expect(page.getByTestId("anomaly-total")).toHaveText(String(api.total));
    await expect(page.getByTestId("last-asof")).toContainText("05 Oct 00:00");
  });
});
