import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DETECTOR_VERSION } from "@/intelligence/config";
import {
  DEV_SEEDS, HELD_OUT_ROUND_1, HELD_OUT_SEEDS, SCENARIO_HOURS, deliveryDelayWithHistory, negativeReviewEvidence, scoreHealthy, scoreScenario,
  type HealthyScore, type ScenarioScore,
} from "@/intelligence/evaluation/evaluate";

/**
 * Milestone 5 — scenario-based evaluation with the real simulator engine (in memory) and the real detection core.
 * Scenario labels are used only to inject incidents and to score results afterwards; detection never sees them.
 * Seeds: DEV (used for tuning), HELD_OUT_ROUND_1 (exposed false positives → methodology fix; no longer blind),
 * HELD_OUT_SEEDS (fresh blind round evaluated after the methodology was frozen).
 */
const RECOVERY_TUNING_SEEDS = [17011, 28081];
const RECOVERY_HELD_OUT_SEEDS = [61121, 73129];
const ALL = [...DEV_SEEDS, ...HELD_OUT_SEEDS, ...HELD_OUT_ROUND_1, ...RECOVERY_TUNING_SEEDS, ...RECOVERY_HELD_OUT_SEEDS];
const SCENARIOS = ["ad_fatigue", "delivery_delays", "viral_demand", "promo_checkout_failure", "negative_reviews"] as const;
const group = (seed: number) => (DEV_SEEDS.includes(seed) ? "dev" : HELD_OUT_SEEDS.includes(seed) ? "held_out_blind" : RECOVERY_HELD_OUT_SEEDS.includes(seed) ? "recovery_held_out" : RECOVERY_TUNING_SEEDS.includes(seed) ? "recovery_tuning" : "held_out_round_1");

describe("scenario evaluation (Milestone 5)", () => {
  const healthy: HealthyScore[] = ALL.map((seed) => scoreHealthy(seed, 24 * 10));
  const scores = new Map<string, ScenarioScore[]>(SCENARIOS.map((s) => [s, ALL.map((seed) => scoreScenario(s, seed))]));
  const evidence = new Map(ALL.map((seed) => [seed, negativeReviewEvidence(seed)]));
  const history = [42, 11, 808].map((seed) => ({ seed, with72h: deliveryDelayWithHistory(seed, 72), with168h: deliveryDelayWithHistory(seed, 168) }));

  it("healthy operation: no investigation-worthy false positives on dev or blind held-out seeds; ≤1 per 150 run-days overall", () => {
    for (const h of healthy.filter((x) => group(x.seed) !== "held_out_round_1")) expect(h.investigationWorthyIncidents, `seed ${h.seed}`).toBe(0);
    expect(healthy.reduce((a, h) => a + h.investigationWorthyIncidents, 0)).toBeLessThanOrEqual(1);
    expect(healthy.reduce((a, h) => a + h.findings.length, 0)).toBeLessThanOrEqual(3);
  });

  it("advertising fatigue is detected in every seed within 24 virtual hours and opens an investigation", () => {
    for (const s of scores.get("ad_fatigue")!) {
      expect(s.detected, `seed ${s.seed}`).toBe(true);
      expect(s.detectionDelayHours!).toBeLessThanOrEqual(24);
      expect(s.investigationWorthy).toBe(true);
      expect(s.primaryIncidentTitle).toMatch(/Advertising performance deterioration/);
      expect(s.offTargetFindings).toEqual([]);
    }
  });

  it("delivery delays are detected in every seed once parcels become overdue; latency is bounded by baseline history", () => {
    for (const s of scores.get("delivery_delays")!) {
      expect(s.detected, `seed ${s.seed}`).toBe(true);
      expect(s.detectionDelayHours!).toBeGreaterThanOrEqual(48); // nothing can be overdue before the first promise passes
      expect(s.detectionDelayHours!).toBeLessThanOrEqual(120);
      expect(s.investigationWorthy).toBe(true);
    }
    for (const h of history) expect(h.with168h!, `seed ${h.seed}`).toBeLessThan(h.with72h!);
    for (const h of history) expect(h.with168h!).toBeLessThanOrEqual(72);
  });

  it("viral demand is detected in every seed within 24h, with the resulting stock risk", () => {
    for (const s of scores.get("viral_demand")!) {
      expect(s.detected, `seed ${s.seed}`).toBe(true);
      expect(s.detectionDelayHours!).toBeLessThanOrEqual(24);
      expect(s.inventoryRiskDetected).toBe(true);
      expect(s.investigationWorthy).toBe(true);
    }
  });

  it("promo checkout failure is detected in every seed from checkout-failure metrics", () => {
    for (const s of scores.get("promo_checkout_failure")!) {
      expect(s.detected, `seed ${s.seed}`).toBe(true);
      expect(s.firstSignal).toMatch(/^(checkout|coupon)_failure_rate@global$/);
      expect(s.detectionDelayHours!).toBeLessThanOrEqual(48);
      expect(s.primaryIncidentTitle).toMatch(/Checkout and conversion deterioration/);
    }
  });

  it("negative reviews are detected whenever the evidence exists (≥5 low reviews for the product within 72h), never as another theme", () => {
    for (const s of scores.get("negative_reviews")!) {
      const ev = evidence.get(s.seed)!;
      if (ev.maxLowIn72h >= 5) expect(s.detected, `seed ${s.seed} had ${ev.maxLowIn72h} low reviews in 72h`).toBe(true);
      if (s.detected) expect(s.firstSignal).toMatch(/low_rating_rate@(product|category):/);
      expect(s.offTargetFindings).toEqual([]);
    }
  });

  it("no scenario run produces findings before the incident is injected", () => {
    for (const list of scores.values()) for (const s of list) expect(s.preInjectionFindings, `${s.scenario} seed ${s.seed}`).toBe(0);
  });

  it("writes the evaluation report when requested", () => {
    if (process.env.WRITE_DETECTION_REPORT !== "1") return;
    mkdirSync("docs/evaluation", { recursive: true });
    writeFileSync("docs/evaluation/detection-evaluation.json", JSON.stringify({
      detectorVersion: DETECTOR_VERSION, generatedBy: "tests/intelligence/evaluation.test.ts", seeds: { dev: DEV_SEEDS, heldOutBlind: HELD_OUT_SEEDS, heldOutRound1: HELD_OUT_ROUND_1, recoveryTuning: RECOVERY_TUNING_SEEDS, recoveryHeldOut: RECOVERY_HELD_OUT_SEEDS },
      setup: { healthyHoursBeforeInjection: 72, severity: 0.8, scenarioHours: SCENARIO_HOURS, healthyRunHours: 240 },
      healthy: healthy.map((h) => ({ ...h, group: group(h.seed) })),
      scenarios: Object.fromEntries([...scores].map(([k, v]) => [k, v.map((s) => ({ ...s, group: group(s.seed) }))])),
      negativeReviewEvidence: Object.fromEntries(evidence), deliveryDelayByHistory: history,
    }, null, 2));
  });
});
