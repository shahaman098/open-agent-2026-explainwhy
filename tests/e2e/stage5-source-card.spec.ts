import { artifactPath } from "./artifacts";
import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import type { ExternalSourceT, ReportT, StateT, ScopeT } from "@/intelligence/investigator/schemas";

// Read-only integration fixture: genuine Mongo sources, production report composer and workspace.
// UI API responses are intercepted. No persisted investigation, provider response or business cause is invented.
test("persisted Nike source cards preserve attribution, rejection, links and scope", async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const runScript = (args: string[] = []) => promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/prepare-stage5-card-check.ts", ...args], { timeout: 90_000 });
  await runScript();
  const fixture = JSON.parse(readFileSync(artifactPath("docs/stage5-runs/source-card-integration-fixture.json"), "utf8")) as {
    mode: string; scope: ScopeT; sources: ExternalSourceT[]; report: ReportT; state: StateT; associations: Record<string, number>;
  };
  const { scope, sources, state, report } = fixture;
  const accepted = sources.find((source) => source.claimSupport === "supported")!;
  const rejected = sources.find((source) => source.claimSupport === "insufficient")!;
  const base = `/api/investigations/${scope.investigationId}`;
  const foreignRun = "source_card_other_run";
  const errors: string[] = [], apiMethods: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let aiReads = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    apiMethods.push(route.request().method());
    expect(route.request().method()).toBe("GET");
    if (url.pathname === "/api/dev/simulator/runs") return route.fulfill({ json: { activeSimulationRunId: scope.simulationRunId, runs: [scope.simulationRunId, foreignRun].map((simulationRunId) => ({ simulationRunId, seed: 0, status: "paused", virtualTime: accepted.retrievedAt })) } });
    if (!url.pathname.startsWith(base) || url.searchParams.get("simulationRunId") !== scope.simulationRunId) return route.fulfill({ status: 404, json: { error: { message: "No source-card fixture in this run" } } });
    if (url.pathname === base) return route.fulfill({ json: {
      investigation: { ...scope, title: "Source-card integration fixture · Nike operating-model announcement · no live AI run", status: "awaiting_review", startedAt: accepted.retrievedAt, updatedAt: accepted.retrievedAt, anomalyIds: [], evidenceIds: [] },
      simulationRunId: scope.simulationRunId, incident: null, anomalies: [], findings: [], affected: { campaigns: [], products: [], channels: [], categories: [] }, timeWindows: { incident: accepted.eventWindow },
      note: "Read-only browser integration fixture using the original persisted source records. No detected incident, provider response or causal diagnosis is asserted. Report is a local test artifact, not a saved live AI report.",
    } });
    if (url.pathname === `${base}/evidence`) return route.fulfill({ json: { total: 0, items: [], investigationStatus: "awaiting_review", latestCollection: null } });
    if (url.pathname === `${base}/evidence-trace`) return route.fulfill({ json: { investigationStatus: "awaiting_review", evidenceIds: [], collections: [], toolRuns: [] } });
    if (url.pathname === `${base}/ai`) {
      expect(url.searchParams.get("businessId")).toBe(scope.businessId);
      aiReads++;
      // Deliberate repeated/foreign-scope payload rows exercise the display boundary. Originals remain unchanged.
      return route.fulfill({ json: { state, report, calls: [], researchTraces: [], sources: [
        { ...accepted, businessId: "other_business" }, { ...accepted, simulationRunId: foreignRun }, { ...accepted, investigationId: "other_investigation" }, ...sources, accepted,
      ] } });
    }
    return route.fulfill({ status: 404, json: { error: { message: "Not part of the read-only fixture" } } });
  });
  const workspace = `/dashboard/investigations/${scope.investigationId}?run=${scope.simulationRunId}`;
  try {
    await page.goto(workspace);
    await expect(page.getByTestId("incident-overview")).toContainText("no live AI run");
    await page.getByTestId("open-signal-details").click();
    await expect(page.getByTestId("executive-brief")).toContainText(report.diagnosis.summary);
    await page.getByRole("dialog").getByRole("button", { name: "Evidence", exact: true }).click();
    const explorer = page.getByTestId("evidence-explorer");
    await expect(explorer.getByTestId("external-evidence-card")).toHaveCount(2);
    const card = explorer.locator(`[data-source-id="${accepted.sourceId}"]`);
    const negative = explorer.locator(`[data-source-id="${rejected.sourceId}"]`);
    await expect(card.getByRole("heading")).toHaveText(accepted.title);
    await expect(card.locator(".investigation-source-meta")).toContainText("about.nike.com · Recognized official host");
    await expect(card.locator("time")).toHaveAttribute("datetime", accepted.publishedAt!);
    await expect(card.locator("time")).toContainText("01 Oct");
    await expect(card).toContainText(accepted.proposedClaim);
    await expect(card.locator("blockquote")).toHaveText(accepted.excerpt);
    await expect(card.locator(".pill")).toHaveText("supported");
    await expect(card).toContainText("HTTP 200 · contextual · incident relevance not assessed");
    await expect(card.locator("img")).toHaveAttribute("src", accepted.previewImageUrl!);
    await card.scrollIntoViewIfNeeded();
    await expect.poll(() => card.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(negative).toHaveClass(/evidence-unverified/);
    await expect(negative).toContainText("Unverified research");
    await expect(negative).toContainText(rejected.proposedClaim);
    await expect(negative).toContainText("not independent corroboration");
    await expect(negative.locator(".pill")).toHaveText("insufficient");
    await expect(negative.locator("img")).toHaveCount(0);
    await page.screenshot({ path: artifactPath("docs/stage5-runs/source-card-integration-desktop.png"), fullPage: true });

    await explorer.getByTestId("filter-role").selectOption("support");
    await expect(explorer.getByTestId("external-evidence-card")).toHaveCount(1);
    await expect(negative).toHaveCount(0);
    await explorer.getByTestId("filter-role").selectOption("all");
    await explorer.getByTestId("filter-verification").selectOption("unverified");
    await expect(explorer.getByTestId("external-evidence-card")).toHaveCount(1);
    await expect(negative).toBeVisible();
    await explorer.getByTestId("filter-verification").selectOption("verified");
    await expect(card).toBeVisible();
    await expect(negative).toHaveCount(0);
    await explorer.getByTestId("filter-verification").selectOption("all");

    await page.getByRole("dialog").getByRole("button", { name: "Signal", exact: true }).click();
    const dossier = page.getByTestId("full-report");
    await dossier.locator(":scope > summary").click();
    const external = dossier.locator("section").filter({ has: page.getByRole("heading", { name: "External research", exact: true }) });
    await expect(external.getByTestId("external-evidence-card")).toHaveCount(1);
    await expect(external).toContainText(accepted.proposedClaim);
    await expect(external).not.toContainText(rejected.proposedClaim);
    await expect(external.locator("a.investigation-citation")).toHaveAttribute("href", `#source-${accepted.sourceId}`);
    await external.locator("a.investigation-citation").click();
    await expect(page.locator(":target")).toHaveAttribute("id", `source-${accepted.sourceId}`);
    await page.getByRole("dialog").getByRole("button", { name: "Signal", exact: true }).click();
    await page.getByTestId("claim-matrix").locator(":scope > summary").click();
    const negativeClaim = page.getByTestId("claim-matrix").locator(".investigation-report-section").filter({ hasText: rejected.proposedClaim });
    await expect(negativeClaim).toContainText("insufficient evidence");
    await expect(negativeClaim.locator("a.investigation-citation")).toHaveAttribute("href", `#source-${rejected.sourceId}`);
    await expect(page.getByTestId("research-sources").locator(":scope > details")).toHaveCount(2);

    await page.getByRole("dialog").getByRole("button", { name: "Evidence", exact: true }).click();
    const originalLink = card.getByRole("link", { name: "Original source" });
    await expect(originalLink).toHaveAttribute("href", accepted.originalUrl);
    await expect(originalLink).toHaveAttribute("rel", "noopener noreferrer");
    const [original, documentResponse] = await Promise.all([
      page.waitForEvent("popup"),
      page.context().waitForEvent("response", { predicate: (response) => response.url() === accepted.originalUrl && response.request().resourceType() === "document" }),
      originalLink.click(),
    ]);
    expect(documentResponse.status()).toBe(200);
    await original.waitForLoadState("domcontentloaded");
    await expect(original).toHaveURL(accepted.originalUrl);
    await expect(original.getByRole("heading", { level: 1 })).toContainText("Operating Model");
    const originalTitle = await original.title();
    await original.close();

    const beforeReload = aiReads;
    await page.reload();
    await page.getByTestId("open-signal-details").click();
    await expect(page.getByTestId("executive-brief")).toContainText(report.diagnosis.summary);
    await page.getByRole("dialog").getByRole("button", { name: "Evidence", exact: true }).click();
    await expect(explorer.getByTestId("external-evidence-card")).toHaveCount(2);
    expect(aiReads).toBeGreaterThan(beforeReload);
    await page.goto(`/dashboard/investigations/${scope.investigationId}?run=${foreignRun}`);
    await expect(page.getByTestId("investigation-not-found")).toBeVisible();
    await expect(page.getByTestId("external-evidence-card")).toHaveCount(0);
    // Real server ownership gate, outside the browser's intercepted read responses.
    const isolationStatuses = await Promise.all([
      `${base}/ai?businessId=nike_demo&simulationRunId=${scope.simulationRunId}`,
      `${base}/ai?businessId=${scope.businessId}&simulationRunId=${foreignRun}`,
    ].map(async (path) => (await request.get(path)).status()));
    expect(isolationStatuses).toEqual([404, 404]);
    expect(errors).toEqual([]);
    writeFileSync(artifactPath("docs/stage5-runs/source-card-integration-browser.json"), JSON.stringify({ mode: fixture.mode, scope, associations: fixture.associations,
      acceptedSourceId: accepted.sourceId, rejectedSourceId: rejected.sourceId, originalUrl: accepted.originalUrl, originalTitle, originalHttpStatus: documentResponse.status(),
      sourceImageLoaded: true, claimsLinked: true, unsupportedExcludedFromSupport: true, samePageClaimAssessmentsRetained: true, duplicateIdsRemoved: true,
      reportFixtureSurvivedReload: true, businessRunIsolation: isolationStatuses, apiMethods: [...new Set(apiMethods)], newProviderCalls: 0, browserErrors: errors, viewport: info.project.use.viewport,
    }, null, 2));
  } finally { await runScript(["--verify"]); }
});
