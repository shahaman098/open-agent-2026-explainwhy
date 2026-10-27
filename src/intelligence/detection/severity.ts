import { DEFAULT_CONFIG, levelForScore, type DetectionConfig } from "@/intelligence/config";
import { clamp, round } from "@/intelligence/baselines/statistics";
import type { Evaluation, ImpactContext, SignalDef } from "@/intelligence/detection/signal";
import { dailyBefore } from "@/intelligence/detection/rules/common";
import type { SignalSeries } from "@/intelligence/signals/series";
import type { SeverityLevel } from "@/intelligence/types";

export interface SeverityAssessment {
  score: number;
  level: SeverityLevel;
  components: { magnitude: number; reliability: number; impact: number; persistence: number };
  impactPerDayMinor: number;
  /** Baseline daily revenue the impact was normalised against. */
  dailyRevenueMinor: number;
  explanation: string;
}

/** Baseline daily revenue of the segment a finding concerns, measured over the 72h before its baseline cutoff. */
export function segmentDailyRevenue(series: SignalSeries, def: SignalDef, segment: string, cutoffK: number): number {
  const total = dailyBefore(series, "global", "revenueMinor", cutoffK);
  if (segment === "global") return def.theme === "advertising" ? dailyBefore(series, "global", "paidRevenueMinor", cutoffK) : total;
  if (segment.startsWith("campaign:") || segment.startsWith("product:") || segment.startsWith("category:")) return dailyBefore(series, segment, "revenueMinor", cutoffK);
  if (segment.startsWith("channel:")) {
    const all = dailyBefore(series, "global", "sessions", cutoffK);
    return all > 0 ? (total * dailyBefore(series, segment, "sessions", cutoffK)) / all : 0;
  }
  return total;
}

export function impactContext(series: SignalSeries, def: SignalDef, segment: string, W: number, cutoffK: number, evaluation: Evaluation): ImpactContext {
  const dailyRevenue = dailyBefore(series, "global", "revenueMinor", cutoffK);
  const dailyOrders = dailyBefore(series, "global", "orders", cutoffK);
  return {
    series, segment, windowHours: W, cutoffK, evaluation, dailyRevenue,
    aov: dailyOrders > 0 ? dailyRevenue / dailyOrders : 0,
    segmentDailyRevenue: segmentDailyRevenue(series, def, segment, cutoffK),
  };
}

/**
 * Transparent 0-100 score:
 *   magnitude   = how far past its relative threshold the change is (0 at threshold, 1 at 4× threshold)
 *   reliability = |z| against twice the z threshold, discounted for few baseline samples n/(n+2)
 *   impact      = estimated revenue at stake per day ÷ (25% of baseline daily revenue)
 *   persistence = hours active ÷ 24
 * score = 100 × Σ weight × component; levels follow config.severity.levels.
 */
export function assess(def: SignalDef, triggerIndex: number, series: SignalSeries, segment: string, W: number, cutoffK: number, evaluation: Evaluation, activeHours: number, config: DetectionConfig = DEFAULT_CONFIG): SeverityAssessment {
  const trigger = def.triggers[triggerIndex];
  const relRatio = evaluation.changePercent !== null && def.kind !== "custom"
    ? Math.abs(evaluation.changePercent) / (trigger.minRelChange * 100)
    : evaluation.strength;
  const magnitude = clamp((relRatio - 1) / 3, 0, 1);
  let reliability: number;
  if (def.kind === "custom") {
    reliability = clamp(Number((evaluation.details?.reliability as number | undefined) ?? 0.6), 0, 1);
  } else {
    const n = evaluation.baseline?.method === "pooled_history"
      ? Math.min(7, Math.round((Date.parse(evaluation.baseline.samples[0]?.endAt ?? "") - Date.parse(evaluation.baseline.samples[0]?.startAt ?? "")) / 86_400_000) || 1)
      : evaluation.baseline?.n ?? 0;
    reliability = clamp(Math.abs(evaluation.z ?? 0) / (2 * trigger.minZ), 0, 1) * (n / (n + 2));
  }
  const ctx = impactContext(series, def, segment, W, cutoffK, evaluation);
  const impactPerDay = Math.max(0, def.impactPerDay(ctx));
  const impact = ctx.dailyRevenue > 0 ? clamp(impactPerDay / (config.severity.impactScaleOfDailyRevenue * ctx.dailyRevenue), 0, 1) : 0;
  const persistence = clamp(activeHours / config.severity.persistenceFullHours, 0, 1);
  const w = config.severity.weights;
  const score = round(100 * (w.magnitude * magnitude + w.reliability * reliability + w.impact * impact + w.persistence * persistence), 1);
  const components = { magnitude: round(magnitude, 3), reliability: round(reliability, 3), impact: round(impact, 3), persistence: round(persistence, 3) };
  return {
    score, level: levelForScore(score, config), components, impactPerDayMinor: Math.round(impactPerDay), dailyRevenueMinor: Math.round(ctx.dailyRevenue),
    explanation: `magnitude ${components.magnitude} × ${w.magnitude} + reliability ${components.reliability} × ${w.reliability} + impact ${components.impact} × ${w.impact} + persistence ${components.persistence} × ${w.persistence}`,
  };
}
