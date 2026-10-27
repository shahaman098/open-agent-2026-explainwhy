import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

const RUN = "e2e_dashboard";
const OTHER = "e2e_run";

async function investigationFor(request: APIRequestContext, run: string): Promise<string> {
  const body = await (await request.get(`/api/investigations?simulationRunId=${run}`)).json();
  return body.items[0]?.investigation.investigationId ?? "";
}

async function expectLayoutFits(page: Page) {
  const clipped = await page.locator("main > *, [data-testid=dashboard-nav]").evaluateAll((elements) =>
    elements.filter((element) => { const r = element.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).map((element) => element.getAttribute("data-testid") ?? element.className));
  expect(clipped).toEqual([]);
  const nav = await page.getByTestId("dashboard-nav").boundingBox();
  const main = await page.locator("main").boundingBox();
  expect(nav!.y + nav!.height).toBeLessThanOrEqual(main!.y);
}

async function overviewCardRects(page: Page, loading: boolean) {
  const selectors = loading ? {
    risk: ".skeleton-risk", signals: ".skeleton-signals", revenue: ".skeleton-revenue",
    metrics: ".skeleton-metrics", activity: ".skeleton-activity", campaigns: ".skeleton-campaigns",
  } : {
    risk: ".risk-card", signals: ".top-signals-card", revenue: ".revenue-card",
    metrics: ".metric-card", activity: ".activity-card", campaigns: ".campaign-card",
  };
  const rects: Record<string, { x: number; y: number; width: number; height: number }> = {};
  for (const [name, selector] of Object.entries(selectors)) {
    const rect = await page.locator(selector).boundingBox();
    if (!rect) throw new Error(`${name} card is missing`);
    rects[name] = rect;
  }
  return rects;
}

test.describe.serial("unified dashboard and evidence retrieval", () => {
  let investigationId = "";
  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    const start = await request.post("/api/dev/simulator/start", { data: { simulationRunId: RUN, seed: 42, reset: true, makeActive: false } });
    expect(start.status()).toBe(201);
    for (const ticks of [36, 36]) expect((await request.post("/api/dev/simulator/tick", { data: { simulationRunId: RUN, ticks } })).ok()).toBe(true);
    expect((await request.post("/api/dev/simulator/inject", { data: { simulationRunId: RUN, scenario: "ad_fatigue", severity: 0.8 } })).ok()).toBe(true);
    expect((await request.post("/api/dev/simulator/tick", { data: { simulationRunId: RUN, ticks: 24 } })).ok()).toBe(true);
    await expect.poll(async () => investigationFor(request, RUN), { timeout: 120_000, intervals: [2_000] }).not.toBe("");
    investigationId = await investigationFor(request, RUN);
    // The isolation checks switch to another run; make sure one exists without resetting it.
    const runs = await (await request.get("/api/dev/simulator/runs")).json();
    if (!runs.runs.some((r: { simulationRunId: string }) => r.simulationRunId === OTHER)) {
      expect((await request.post("/api/dev/simulator/start", { data: { simulationRunId: OTHER, seed: 42, reset: false, makeActive: false } })).status()).toBe(201);
    }
  });

  test("overview shows the selected run's real metrics, monitoring activity and incidents", async ({ page, request }) => {
    await page.goto(`/dashboard?run=${RUN}`);
    await expect(page.getByTestId("dashboard-run-select")).toHaveValue(RUN);
    await expect(page.getByTestId("overview-kpis")).toBeVisible();
    const breakdown = await (await request.get(`/api/metrics/breakdown?simulationRunId=${RUN}&days=7`)).json();
    await expect(page.getByTestId("overview-kpis").locator(".metric").filter({ hasText: "Orders" }).locator("strong")).toHaveText(breakdown.total.counters.orders.toLocaleString("en-GB"));
    await expect(page.getByTestId("overview-activity")).toContainText("05 Oct 00:00");
    await expect(page.getByTestId("overview-activity")).toContainText("Open an investigation to start the Mubit investigator");
    await expect(page.getByTestId("overview-incident").first()).toContainText("Advertising performance deterioration");
    await expect(page.locator(`a[href="/dashboard/investigations/${investigationId}?run=${RUN}"]`).first()).toBeVisible();
    await expectLayoutFits(page);
    // Run switching changes every panel; the other run has no investigation.
    await page.getByTestId("dashboard-run-select").selectOption(OTHER);
    await expect(page).toHaveURL(new RegExp(`run=${OTHER}`));
    await expect(page.locator(`a[href*="/dashboard/investigations/${investigationId}"]`)).toHaveCount(0);
    await page.getByTestId("dashboard-run-select").selectOption(RUN);
    await page.locator(`a[href="/dashboard/investigations/${investigationId}?run=${RUN}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/investigations/${investigationId}\\?run=${RUN}`));
    await expect(page.getByTestId("incident-overview")).toHaveAttribute("data-investigation-id", investigationId);
  });

  test("overview shows skeletons during data retrieval and keeps campaigns in the responsive layout", async ({ page, isMobile }) => {
    let release!: () => void;
    let loadingRects: Awaited<ReturnType<typeof overviewCardRects>> | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/metrics/breakdown?*", async (route) => { await gate; await route.continue(); });
    try {
      await page.goto(`/dashboard?run=${RUN}`);
      const skeleton = page.getByTestId("page-skeleton");
      await expect(skeleton).toBeVisible();
      await expect(page.locator(".skeleton-risk")).toBeVisible();
      await expect(skeleton.locator(".skeleton-block").first()).toHaveCSS("animation-name", "skeleton-shimmer");
      loadingRects = await overviewCardRects(page, true);
    } finally { release(); }
    await expect(page.getByTestId("page-skeleton")).toHaveCount(0);
    if (!loadingRects) throw new Error("Overview skeleton did not render");
    const loadedRects = await overviewCardRects(page, false);
    if (!isMobile) for (const name of Object.keys(loadedRects)) for (const dimension of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(loadedRects[name][dimension] - loadingRects[name][dimension]), `${name} ${dimension} shifted after loading`).toBeLessThanOrEqual(1);
    }
    const campaigns = page.getByTestId("campaign-carousel");
    const signals = page.getByTestId("overview-signals");
    await expect(campaigns).toBeVisible();
    const campaignBox = (await campaigns.boundingBox())!;
    const signalBox = (await signals.boundingBox())!;
    const slides = await campaigns.locator(".campaign-slide").all();
    expect(slides.length).toBeGreaterThan(3);
    // Read both cards in one frame so the shared entrance animation cannot skew their relative positions.
    const [first, second] = await campaigns.locator(".campaign-slide").evaluateAll(elements => elements.slice(0, 2).map(element => { const {x, y, width, height} = element.getBoundingClientRect(); return {x, y, width, height}; }));
    await expect.poll(async () => page.locator(".revenue-card .bar").first().evaluate((bar) => bar.getBoundingClientRect().height)).toBeGreaterThan(10);
    if (isMobile) {
      expect(campaignBox.y).toBeGreaterThan(signalBox.y);
      expect(second.y).toBeCloseTo(first.y, 0);
    } else {
      const riskBox = (await page.getByTestId("overview-run").boundingBox())!;
      expect(riskBox.width).toBeGreaterThan(370);
      expect(signalBox.width).toBeGreaterThan(470);
      expect(campaignBox.width).toBeGreaterThan(280);
      expect(campaignBox.x).toBeGreaterThan(signalBox.x + signalBox.width - 2);
      expect(second.y).toBeGreaterThan(first.y + first.height - 2);
      expect(Math.max(...Object.values(loadedRects).map((rect) => rect.y + rect.height))).toBeLessThanOrEqual(page.viewportSize()!.height);
      for (const selector of [".activity-card ol"]) {
        const list = page.locator(selector);
        expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
        await expect(list).toHaveAttribute("tabindex", "0");
      }
      const signalCarousel = page.getByRole("group", { name: "Recent signals" });
      await expect(signalCarousel.locator(".signal-item")).toHaveCount(1);
      const signalCount = await signalCarousel.locator(".signal-carousel-count").textContent();
      await signalCarousel.getByRole("button", { name: "Next signal" }).click();
      await expect(signalCarousel.locator(".signal-carousel-count")).not.toHaveText(signalCount!);
      const track = campaigns.locator(".campaign-track");
      expect(await track.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      for (let i = 1; i < slides.length; i++) await campaigns.getByRole("button", { name: "Next campaign" }).click();
      await expect(campaigns.locator(".campaign-controls > span")).toHaveText(`${slides.length} / ${slides.length}`);
      await expect.poll(async () => track.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await expectLayoutFits(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      expect(Math.max(...Object.values(await overviewCardRects(page, false)).map((rect) => rect.y + rect.height))).toBeLessThanOrEqual(900);
      await page.setViewportSize({ width: 1920, height: 1080 });
      const wideSignals = (await signals.boundingBox())!;
      const wideCampaigns = (await campaigns.boundingBox())!;
      expect(wideSignals.width).toBeGreaterThan(700);
      expect(wideCampaigns.x).toBeGreaterThan(wideSignals.x + wideSignals.width - 2);
      expect(Math.max(...Object.values(await overviewCardRects(page, false)).map((rect) => rect.y + rect.height))).toBeLessThanOrEqual(1080);
    }
    await expectLayoutFits(page);
  });

  test("rapid run changes never leave a stale investigation link or navigate with its run", async ({ page }) => {
    await page.goto(`/dashboard?run=${RUN}`);
    await expect(page.locator(`a[href*="/dashboard/investigations/${investigationId}"]`).first()).toBeVisible();
    const selector = page.getByTestId("dashboard-run-select").first();
    await selector.selectOption(OTHER);
    await selector.selectOption(RUN);
    const open = page.locator(`a[href*="/dashboard/investigations/${investigationId}"]`).first();
    await expect(open).toHaveAttribute("href", new RegExp(`run=${RUN}$`));
    await open.click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/investigations/${investigationId}\\?run=${RUN}`));
    await expect(page.getByTestId("incident-overview")).toHaveAttribute("data-investigation-id", investigationId);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/dashboard\\?run=${RUN}`));
    await expect(selector).toHaveValue(RUN);
    await page.goForward();
    await expect(page.getByTestId("incident-overview")).toHaveAttribute("data-investigation-id", investigationId);
  });

  test("signals consolidate persisted incident observations, expand exact evidence and preserve investigation navigation", async ({ page, request }) => {
    const response = await request.get(`/api/signals?businessId=nike_demo&simulationRunId=${RUN}&limit=100`);
    expect(response.ok()).toBe(true);
    const groups = await response.json();
    const group = groups.items.find((item: { investigationId: string | null }) => item.investigationId === investigationId);
    expect(group).toBeTruthy();
    expect(group.observationCount).toBeGreaterThan(1);

    await page.goto(`/dashboard/signals?run=${RUN}`);
    const card = page.getByTestId("signal-group").filter({ has: page.locator(`a[href*="/dashboard/investigations/${investigationId}"]`) }).first();
    await expect(card).toBeVisible();
    await expect(card.getByTestId("signal-investigation-link")).toHaveAttribute("href", new RegExp(`/dashboard/investigations/${investigationId}\\?run=${RUN}$`));
    await card.getByRole("button", { name: "View details", exact: true }).click();
    const drawer = page.getByTestId("signal-drawer");
    await expect(drawer).toBeVisible();
    const related = groups.items.filter((item: { incidentId: string | null }) => item.incidentId === group.incidentId);
    const expectedCount = new Set(related.flatMap((item: { observations: Array<{ anomalyId: string; isBusinessAggregate: boolean }> }) => item.observations.filter((observation) => !observation.isBusinessAggregate).map((observation) => observation.anomalyId))).size;
    if (expectedCount > 4) await drawer.getByRole("button", { name: /Show all/ }).click();
    await expect(drawer.getByTestId("signal-observation")).toHaveCount(expectedCount);
    await expect(drawer.locator(".inbox-drawer-metrics")).toContainText("Current");
    await drawer.getByRole("button", { name: "Close details" }).click();
    await expect(drawer).toHaveCount(0);
    await card.getByTestId("signal-investigation-link").click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/investigations/${investigationId}\\?run=${RUN}$`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/dashboard/signals\\?run=${RUN}$`));
    await page.goForward();
    await expect(page.getByTestId("incident-overview")).toHaveAttribute("data-investigation-id", investigationId);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    const documentWidth = await page.locator("html").evaluate((element) => element.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewportWidth + 1);
  });

  test("an unknown run never silently displays the active run", async ({ page }) => {
    await page.goto("/dashboard?run=e2e_missing_stage4");
    await expect(page.getByTestId("dashboard-run-select")).toHaveValue("e2e_missing_stage4");
    await expect(page.getByTestId("overview-error")).toBeVisible();
    await expect(page.getByTestId("overview-kpis")).toHaveCount(0);
  });

  test("architecture flow derives stage statuses from data and marks future stages explicitly", async ({ page }) => {
    await page.goto(`/dashboard/architecture?run=${RUN}`);
    await expect(page.getByTestId("process-flow")).toBeVisible();
    await expect(page.getByTestId("stage-observe")).toHaveAttribute("data-status", "operational");
    await expect(page.getByTestId("stage-detect")).toHaveAttribute("data-status", "operational");
    await expect(page.getByTestId("stage-investigate")).toHaveAttribute("data-status", "waiting_for_data");
    await expect(page.getByTestId("stage-execute")).toHaveAttribute("data-status", "waiting_for_data");
    await page.getByTestId("stage-retrieve").click();
    await expect(page).toHaveURL(/stage=retrieve/);
    await expect(page.getByTestId("stage-panel")).toContainText("8 tools registered");
    await expect(page.getByTestId("stage-panel").locator("tbody tr")).toHaveCount(8);
    await expectLayoutFits(page);
    await page.getByTestId("stage-plan").click();
    await expect(page.getByTestId("stage-panel")).toHaveAttribute("data-capability-status", "Waiting for data");
    await expect(page.getByTestId("stage-panel")).toContainText("ProposedPlan");
    await page.getByTestId("stage-approve").click();
    await expect(page.getByTestId("stage-panel")).toHaveAttribute("data-capability-status", "Waiting for data");
  });

  test("investigation workspace collects evidence, shows tools and real records, resolves a source, survives refresh and isolates runs", async ({ page, request }) => {
    test.setTimeout(240_000);
    await page.goto(`/dashboard/investigations/${investigationId}?run=${RUN}`);
    await expect(page.getByTestId("incident-overview")).toContainText("Advertising performance deterioration");
    await page.getByTestId("open-signal-details").click();
    await expect(page.getByTestId("related-anomalies").locator("tbody tr")).toHaveCount((await (await request.get(`/api/investigations/${investigationId}?simulationRunId=${RUN}`)).json()).anomalies.length);
    await expect(page.getByTestId("start-ai")).toBeEnabled();
    await expect(page.getByTestId("ai-investigation")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Decision / Plan", exact: true }).click();
    await expect(page.getByTestId("generate-plan")).toBeDisabled();
    await expect(page.getByTestId("planning-blocked")).toContainText("saved Stage 5 report");
    await expect(page.getByTestId("execution-intake").getByRole("link", { name: "Open Approvals" })).toHaveAttribute("href", `/dashboard/approvals?run=${RUN}`);
    await page.getByRole("dialog").getByRole("button", { name: "Evidence", exact: true }).click();
    await expect(page.getByTestId("evidence-empty")).toBeVisible();

    await page.getByTestId("collect-evidence").click();
    await expect(page.getByTestId("collection-summary")).toContainText("Status completed", { timeout: 90_000 });
    await expect(page.getByTestId("selected-tools")).toContainText("revenue_analysis");
    await expect(page.getByTestId("selected-tools")).toContainText("advertising_analysis");
    await expect(page.getByTestId("selected-tools")).toContainText("checkout_analysis");
    const api = await (await request.get(`/api/investigations/${investigationId}/evidence?simulationRunId=${RUN}&limit=100`)).json();
    expect(api.total).toBeGreaterThanOrEqual(4);
    await expect(page.getByTestId("evidence-item")).toHaveCount(api.total);
    await page.getByRole("dialog").locator("summary").filter({ hasText: "Evidence collection and tool timeline" }).click();
    await expect(page.locator('[data-testid="tool-run"][data-status="completed"]').first()).toBeVisible();
    await expect(page.getByTestId("tool-run")).toHaveCount(api.latestCollection.selectedTools.length);

    // Expand the advertising evidence: measurements, verification and a source record that resolves independently.
    await page.getByTestId("filter-tool").selectOption("advertising_analysis");
    const advertisingCount = api.items.filter((item: {tool: string}) => item.tool === "advertising_analysis").length;
    expect(advertisingCount).toBeGreaterThan(0);
    await expect(page.getByTestId("evidence-item")).toHaveCount(advertisingCount);
    await page.getByTestId("evidence-toggle").first().click();
    await expect(page.getByTestId("evidence-detail").first()).toContainText("ctr");
    await expect(page.getByTestId("evidence-verification").first()).toContainText("source_records_resolve");
    const link = page.getByTestId("source-link").first();
    const href = (await link.getAttribute("href"))!;
    const eventId = new URL(href, "http://localhost").searchParams.get("eventId")!;
    const ledger = await (await request.get(href)).json();
    expect(ledger.events).toHaveLength(1);
    expect(ledger.events[0].eventId).toBe(eventId);
    expect(ledger.events[0].simulationRunId).toBe(RUN);
    expect(ledger.events[0].type).toBe("ad.metrics_observed");

    await expectLayoutFits(page);
    await page.getByTestId("tool-run").first().click();
    await expect(page.getByTestId("tool-run-detail")).toContainText(RUN);

    // Collecting again reuses the same cutoff; nothing is duplicated.
    await page.getByTestId("collect-evidence").click();
    await expect(page.getByTestId("collect-result")).toContainText("existing collection", { timeout: 60_000 });
    await expect(page.getByTestId("collection-run")).toHaveCount(1);

    await page.getByTestId("refresh-evidence").click();
    await expect(page.getByTestId("collection-summary")).toContainText("attempt 2", { timeout: 90_000 });
    const refreshed = await (await request.get(`/api/investigations/${investigationId}/evidence?simulationRunId=${RUN}&limit=100`)).json();
    expect(refreshed.items.map((i: { evidence: { evidenceId: string } }) => i.evidence.evidenceId).sort()).toEqual(api.items.map((i: { evidence: { evidenceId: string } }) => i.evidence.evidenceId).sort());
    expect(refreshed.total).toBe(api.total);
    await page.reload();
    await page.getByTestId("open-evidence-details").click();
    await expect(page.getByTestId("evidence-item")).toHaveCount(api.total);
    await expect(page.getByTestId("collection-summary")).toContainText("Status completed");

    // Another run must not see this investigation or its evidence.
    await page.getByRole("button", { name: "Close details" }).click();
    await page.getByTestId("dashboard-run-select").selectOption(OTHER);
    await expect(page.getByTestId("investigation-not-found")).toBeVisible();
    expect((await request.get(`/api/investigations/${investigationId}/evidence?simulationRunId=${OTHER}`)).status()).toBe(404);
    await page.getByTestId("dashboard-run-select").selectOption(RUN);
    await page.getByTestId("open-evidence-details").click();
    await expect(page.getByTestId("evidence-item")).toHaveCount(api.total);
  });
  test("AI investigation queues idempotently, survives refresh, and can be cancelled without a browser worker", async ({ page, request }) => {
    const endpoint = `/api/investigations/${investigationId}/ai?simulationRunId=${RUN}`;
    await page.goto(`/dashboard/investigations/${investigationId}?run=${RUN}`);
    await page.getByTestId("open-signal-details").click();
    await expect(page.getByTestId("start-ai")).toBeEnabled();
    await page.getByTestId("start-ai").click();
    await expect(page.getByTestId("ai-status")).toHaveText("queued");
    const first = await (await request.get(endpoint)).json();
    const duplicate = await (await request.post(endpoint, { data: { action: "start" } })).json();
    expect(duplicate.state.jobId).toBe(first.state.jobId);
    expect(first.calls).toEqual([]);
    await page.reload();
    await page.getByTestId("open-signal-details").click();
    await expect(page.getByTestId("ai-status")).toHaveText("queued");
    await page.getByTestId("cancel-ai").click();
    await expect(page.getByTestId("ai-status")).toHaveText("cancelled");
    expect((await (await request.get(endpoint)).json()).calls).toEqual([]);
    expect((await request.get(`/api/investigations/${investigationId}/ai?simulationRunId=${OTHER}`)).status()).toBe(404);
    await expectLayoutFits(page);
  });

});
