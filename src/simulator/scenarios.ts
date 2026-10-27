import type { z } from "zod";
import type { ScenarioName } from "@normal/contracts";

export type ScenarioNameT = z.infer<typeof ScenarioName>;

/**
 * PRIVATE mechanistic parameters derived from (scenario, severity).
 * They change behaviour (hazards, probabilities, multipliers), never outputs.
 * Stored only in simulator_state / simulator_ground_truth; never exposed to
 * events, metrics, evidence or any AI-facing API.
 */
export interface ScenarioParams {
  /** Shrinks the effective ad audience so the same impressions produce higher frequency. */
  adAudienceShrink: number;
  /** Strength of CTR decay once frequency exceeds the comfort threshold. */
  ctrFatigueStrength: number;
  /** Multiplier on the conversion probability of paid sessions. */
  paidConversionMultiplier: number;
  /** Probability a dispatched parcel misses its promise. */
  deliveryDelayHazard: number;
  /** Multiplier on delay duration. */
  deliveryDelayScale: number;
  /** Probability a parcel is lost. */
  deliveryLostHazard: number;
  /** Organic/social traffic multiplier. */
  organicTrafficMultiplier: number;
  /** Product receiving viral attention (if any) and its interest boost. */
  viralProductId: string | null;
  viralInterestBoost: number;
  /** Expected synthetic social mentions per virtual hour. */
  socialMentionRatePerHour: number;
  /** Product with a quality problem (if any) and the satisfaction penalty. */
  qualityIssueProductId: string | null;
  qualityPenalty: number;
  /** Share of checkouts that try a coupon, and the probability the coupon path fails. */
  couponUsageRate: number;
  couponFailureRate: number;
  couponCode: string;
}

export const HEALTHY_PARAMS: ScenarioParams = {
  adAudienceShrink: 0, ctrFatigueStrength: 0.35, paidConversionMultiplier: 1,
  deliveryDelayHazard: 0.06, deliveryDelayScale: 1, deliveryLostHazard: 0.004,
  organicTrafficMultiplier: 1, viralProductId: null, viralInterestBoost: 0,
  socialMentionRatePerHour: 0.15, qualityIssueProductId: null, qualityPenalty: 0,
  couponUsageRate: 0.12, couponFailureRate: 0.04, couponCode: "AUTUMN15",
};

export interface ScenarioTargets {
  viralProductId: string;
  qualityIssueProductId: string;
}

export function deriveScenarioParams(scenario: ScenarioNameT, severity: number, targets: ScenarioTargets): ScenarioParams {
  const s = Math.min(1, Math.max(0, severity));
  const p: ScenarioParams = { ...HEALTHY_PARAMS };
  switch (scenario) {
    case "healthy":
      break;
    case "ad_fatigue":
      p.adAudienceShrink = 0.75 * s;
      p.ctrFatigueStrength = 0.35 + 1.4 * s;
      p.paidConversionMultiplier = 1 - 0.35 * s;
      break;
    case "delivery_delays":
      p.deliveryDelayHazard = 0.06 + 0.6 * s;
      p.deliveryDelayScale = 1 + 2 * s;
      p.deliveryLostHazard = 0.004 + 0.03 * s;
      break;
    case "viral_demand":
      p.organicTrafficMultiplier = 1 + 2.5 * s;
      p.viralProductId = targets.viralProductId;
      p.viralInterestBoost = 8 * s;
      p.socialMentionRatePerHour = 0.15 + 4 * s;
      break;
    case "negative_reviews":
      p.qualityIssueProductId = targets.qualityIssueProductId;
      p.qualityPenalty = 0.55 * s;
      break;
    case "promo_checkout_failure":
      p.couponUsageRate = 0.12 + 0.3 * s;
      p.couponFailureRate = 0.02 + 0.9 * s;
      break;
  }
  return p;
}

/** Root causes recorded in the private ground-truth record for each scenario. */
export const SCENARIO_ROOT_CAUSES: Record<ScenarioNameT, Array<
  "ad_fatigue" | "delivery_delays" | "product_quality" | "negative_sentiment" | "checkout_failure" | "discount_failure" | "viral_demand" | "stockout" | "unknown"
>> = {
  healthy: ["unknown"],
  ad_fatigue: ["ad_fatigue"],
  delivery_delays: ["delivery_delays"],
  viral_demand: ["viral_demand", "stockout"],
  negative_reviews: ["product_quality", "negative_sentiment"],
  promo_checkout_failure: ["discount_failure", "checkout_failure"],
};
