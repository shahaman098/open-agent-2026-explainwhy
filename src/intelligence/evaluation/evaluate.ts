/**
 * EVALUATION HARNESS ONLY. Scores detector output against the injected scenario AFTER detection has run.
 * The mapping below is an evaluation rubric ("which observable themes should an analyst expect to see?"), never a
 * detector input.
 */
import type { ScenarioNameT } from "@/simulator/scenarios";
import { DEFAULT_CONFIG, severityRank, type DetectionConfig } from "@/intelligence/config";
import { detectTimeline, simulate } from "@/intelligence/evaluation/harness";
import type { Theme } from "@/intelligence/types";

export const EXPECTED_THEMES: Record<Exclude<ScenarioNameT, "healthy">, Theme[]> = {
  ad_fatigue: ["advertising"],
  delivery_delays: ["fulfilment"],
  viral_demand: ["demand", "traffic"],
  promo_checkout_failure: ["conversion"],
  negative_reviews: ["reputation"],
};

/** Hours of post-injection simulation per scenario (reviews and deliveries lag by days). */
export const SCENARIO_HOURS: Record<Exclude<ScenarioNameT, "healthy">, number> = {
  ad_fatigue: 96, delivery_delays: 168, viral_demand: 168, promo_checkout_failure: 96, negative_reviews: 336,
};

export interface ScenarioScore {
  scenario: ScenarioNameT;
  seed: number;
  detected: boolean;
  /** Virtual hours from injection to the first confirmed finding of an expected theme. */
  detectionDelayHours: number | null;
  firstSignal: string | null;
  investigationWorthy: boolean;
  primaryIncidentTitle: string | null;
  preInjectionFindings: number;
  offTargetFindings: string[];
  inventoryRiskDetected: boolean;
  totalFindings: number;
  totalIncidents: number;
}

export interface HealthyScore {
  seed: number;
  hours: number;
  findings: string[];
  incidents: number;
  investigationWorthyIncidents: number;
}

const worthy = (i: { severity: { level: "low" | "medium" | "high" | "critical" } }, hasCanonical: boolean, config: DetectionConfig) =>
  hasCanonical && severityRank(i.severity.level) >= severityRank(config.investigationMinSeverity);

export function scoreHealthy(seed: number, hours = 24 * 7, config: DetectionConfig = DEFAULT_CONFIG): HealthyScore {
  const t = simulate({ seed, healthyHours: hours });
  const d = detectTimeline(t, t.endAt, config);
  const canon = new Set(d.run.findings.filter((f) => f.canonicalMetric).map((f) => f.key));
  return {
    seed, hours, findings: d.run.findings.map((f) => `${f.signalId}@${f.segment}:${f.direction}:${f.severity.level}`), incidents: d.incidents.length,
    investigationWorthyIncidents: d.incidents.filter((i) => worthy(i, i.findingKeys.some((k) => canon.has(k)), config)).length,
  };
}

export function scoreScenario(scenario: Exclude<ScenarioNameT, "healthy">, seed: number, config: DetectionConfig = DEFAULT_CONFIG, severity = 0.8): ScenarioScore {
  const t = simulate({ seed, healthyHours: 72, scenario, severity, scenarioHours: SCENARIO_HOURS[scenario] });
  const d = detectTimeline(t, t.endAt, config);
  const injected = Date.parse(t.injectedAt!);
  const expected = new Set<Theme>(EXPECTED_THEMES[scenario]);
  const onTarget = d.run.findings.filter((f) => expected.has(f.theme) && Date.parse(f.onsetAt) >= injected);
  const first = [...onTarget].sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt))[0];
  const canon = new Set(d.run.findings.filter((f) => f.canonicalMetric).map((f) => f.key));
  const primary = d.incidents.find((i) => expected.has(i.primaryTheme) || i.themes.some((th) => expected.has(th)));
  const allowedCompanions = new Set<Theme>(["sales", "traffic", ...expected]);
  if (scenario === "viral_demand") { allowedCompanions.add("inventory"); allowedCompanions.add("conversion"); }
  if (scenario === "delivery_delays") allowedCompanions.add("reputation");
  if (scenario === "ad_fatigue" || scenario === "promo_checkout_failure") { allowedCompanions.add("conversion"); allowedCompanions.add("advertising"); }
  return {
    scenario, seed, detected: Boolean(first),
    detectionDelayHours: first ? (Date.parse(first.confirmedAt) - injected) / 3_600_000 : null,
    firstSignal: first ? `${first.signalId}@${first.segment}` : null,
    investigationWorthy: Boolean(primary && worthy(primary, primary.findingKeys.some((k) => canon.has(k)), config)),
    primaryIncidentTitle: primary?.title ?? null,
    preInjectionFindings: d.run.findings.filter((f) => Date.parse(f.onsetAt) < injected).length,
    offTargetFindings: d.run.findings.filter((f) => Date.parse(f.onsetAt) >= injected && !allowedCompanions.has(f.theme)).map((f) => `${f.signalId}@${f.segment}`),
    inventoryRiskDetected: d.run.findings.some((f) => f.theme === "inventory"),
    totalFindings: d.run.findings.length, totalIncidents: d.incidents.length,
  };
}

/** Seeds used to tune thresholds and methodology. */
export const DEV_SEEDS = [42, 7, 1234];
/** First held-out round. Its false positives drove a methodology fix, so these seeds are no longer blind. */
export const HELD_OUT_ROUND_1 = [99, 2024, 31337, 555];
/** Fresh held-out round evaluated only after the methodology was frozen. */
export const HELD_OUT_SEEDS = [11, 808, 4242, 9001];

/**
 * Evidence available to ANY detector for the negative-reviews scenario: the most low (1–2★) reviews the targeted
 * product received inside a single 72h window after injection. Scoring only — uses the injected target.
 */
export function negativeReviewEvidence(seed: number, hours = SCENARIO_HOURS.negative_reviews): { maxLowIn72h: number; totalLow: number } {
  const t = simulate({ seed, healthyHours: 72, scenario: "negative_reviews", severity: 0.8, scenarioHours: hours });
  const target = "nk_quest_7";
  const lows = t.events.filter((e) => e.type === "review.created" && e.payload.productId === target && e.payload.rating <= 2).map((e) => Date.parse(e.occurredAt)).sort((a, b) => a - b);
  let best = 0;
  for (let i = 0; i < lows.length; i++) {
    let j = i;
    while (j + 1 < lows.length && lows[j + 1] - lows[i] < 72 * 3_600_000) j++;
    best = Math.max(best, j - i + 1);
  }
  return { maxLowIn72h: best, totalLow: lows.length };
}

/** Delivery-delay detection with a longer healthy history, to separate history warm-up from detector latency. */
export function deliveryDelayWithHistory(seed: number, healthyHours: number): number | null {
  const t = simulate({ seed, healthyHours, scenario: "delivery_delays", severity: 0.8, scenarioHours: 168, simulationRunId: `eval_dd_h${healthyHours}_s${seed}` });
  const d = detectTimeline(t);
  const injected = Date.parse(t.injectedAt!);
  const first = d.run.findings.filter((f) => f.theme === "fulfilment" && Date.parse(f.onsetAt) >= injected).sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt))[0];
  return first ? (Date.parse(first.confirmedAt) - injected) / 3_600_000 : null;
}
