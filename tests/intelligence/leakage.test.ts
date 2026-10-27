import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Code-inspection guard for the detector's data boundary. The production detection path is everything under
 * src/intelligence EXCEPT the isolated evaluation harness (src/intelligence/evaluation), plus the API routes.
 * It must never import simulator modules or reference simulator control/ground-truth data.
 */
const ROOT = process.cwd();
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });
}
const production = [
  ...files(join(ROOT, "src/intelligence")).filter((p) => !p.includes(`${join("src", "intelligence", "evaluation")}`)),
  ...["src/app/api/dev/monitor/run/route.ts", "src/app/api/anomalies/route.ts", "src/app/api/investigations/route.ts", "src/app/api/investigations/[id]/route.ts", "src/app/api/incidents/route.ts",
    "src/app/api/investigations/[id]/evidence/route.ts", "src/app/api/investigations/[id]/evidence-trace/route.ts", "src/app/api/dev/investigations/[id]/collect-evidence/route.ts", "src/app/api/intelligence/capabilities/route.ts"].map((p) => join(ROOT, p)),
];

const FORBIDDEN_TOKENS = [
  "simulator_state", "simulator_ground_truth", "simulatorState", "simulatorGroundTruth", "ScenarioGroundTruth", "ScenarioName",
  "scenarioParams", "activeScenario", "scenarioSeverity", "hiddenFaultParameters", "deriveScenarioParams", "SCENARIO_TARGETS",
  "plannedOutcome", "qualityScore", "popularity", "satisfaction", "drivers", "getRunSummary", "loadState", "loadWorld",
  "ad_fatigue", "delivery_delays", "viral_demand", "negative_reviews", "promo_checkout_failure",
];
const ALLOWED_COLLECTION_KEYS = new Set([
  "businessEvents", "simulatedProducts", "metricSnapshots", "anomalies", "investigations", "detectionFindings",
  "detectionObservations", "incidents", "monitorRuns", "monitorState", "monitoringWindows", "monitoringJobs", "monitoringWorkers",
  // Evidence retrieval owns these; diagnoses/plans are read (never written) by historical-incident retrieval.
  "evidence", "evidenceCollections", "evidenceToolRuns", "evidenceDetails", "diagnoses", "plans",
  "investigationJobs", "investigationCalls", "investigationReports", "externalSources",
]);

describe("detector data boundary (code inspection)", () => {
  it("inspects a non-trivial set of production files", () => {
    expect(production.length).toBeGreaterThan(20);
  });

  it("never imports simulator modules", () => {
    for (const p of production) {
      const src = readFileSync(p, "utf8");
      expect(src, relative(ROOT, p)).not.toMatch(/from\s+["']@\/simulator\//);
      expect(src, relative(ROOT, p)).not.toMatch(/import\(["']@\/simulator\//);
    }
  });

  it("never references scenario labels, injected parameters or latent simulator variables", () => {
    for (const p of production) {
      const src = readFileSync(p, "utf8");
      for (const token of FORBIDDEN_TOKENS) expect(src.includes(token), `${relative(ROOT, p)} references ${token}`).toBe(false);
    }
  });

  it("only touches canonical events, metric snapshots, product labels and its own collections", () => {
    for (const p of production) {
      const src = readFileSync(p, "utf8");
      for (const m of src.matchAll(/COLLECTIONS\.(\w+)/g)) expect(ALLOWED_COLLECTION_KEYS.has(m[1]), `${relative(ROOT, p)} uses COLLECTIONS.${m[1]}`).toBe(true);
      expect(src, relative(ROOT, p)).not.toMatch(/collection\(\s*["'`]/);
    }
  });

  it("reads simulated_products only through the label projection", () => {
    const monitor = readFileSync(join(ROOT, "src/intelligence/monitor.ts"), "utf8");
    expect(monitor).toMatch(/CATALOGUE_PROJECTION = \{ _id: 0, productId: 1, name: 1, category: 1 \}/);
    const uses = [...monitor.matchAll(/COLLECTIONS\.simulatedProducts\)\.find\([^)]*\{ projection: (\w+) \}/g)].map((m) => m[1]);
    expect(uses).toEqual(["CATALOGUE_PROJECTION"]);
    for (const p of production.filter((x) => !x.endsWith("monitor.ts"))) expect(readFileSync(p, "utf8")).not.toContain("simulatedProducts");
  });

  it("never mutates business state or calls partner adapters", () => {
    for (const p of production) {
      const src = readFileSync(p, "utf8");
      expect(src).not.toMatch(/from\s+["']@\/adapters/);
      expect(src).not.toMatch(/ingestBatch|ingestEvents|setDailyBudget|publishBanner|sendDelayNotice|tickRun|injectScenario/);
    }
  });

  it("the only intelligence module that imports the simulator is the isolated evaluation harness", () => {
    const harness = files(join(ROOT, "src/intelligence/evaluation"));
    expect(harness.length).toBeGreaterThan(0);
    for (const p of harness) expect(readFileSync(p, "utf8")).toMatch(/EVALUATION HARNESS ONLY/);
  });
});
