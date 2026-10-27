import type { SeverityLevel } from "@/intelligence/types";

/** Bumped whenever rule semantics or thresholds change; recorded on every canonical Anomaly. */
export const DETECTOR_VERSION = "normal-detector-1.1.0";

export interface DetectionConfig {
  /** Same-hour / trailing baseline windows considered (most recent first). */
  maxBaselineSamples: number;
  /** Fewer baseline samples than this yields an explicit insufficient-history result. */
  minBaselineSamples: number;
  /**
   * Variance inflation applied to Poisson noise for counts and money. Simulated daily orders range 22–46 around a
   * mean of ~36 (sd ≈ 7 vs √36 = 6), so pure Poisson noise would overstate significance.
   */
  countDispersion: number;
  /** How far back the deterministic replay walks to find episode onsets (hours). */
  replayHorizonHours: number;
  /** Pooled-history baselines (sparse signals such as reviews) look back at most this far (hours). */
  pooledHistoryMaxHours: number;
  /** Minimum pooled history before a pooled baseline is trusted (hours). */
  pooledHistoryMinHours: number;
  /** An active episode clears once its strength stays below this fraction of the trigger for `clearPersistenceHours`. */
  clearRatio: number;
  /**
   * Strength (fraction of the trigger) at which a signal is "under watch": its baseline freezes so a slow-onset change
   * cannot leak into the comparison windows before it crosses the full trigger.
   */
  watchRatio: number;
  clearPersistenceHours: number;
  /** A resolved incident whose signals re-trigger within this many hours is reopened instead of duplicated. */
  cooldownHours: number;
  /** Resolved episodes newer than this are still correlated so their incidents can be closed (hours). */
  resolvedRetentionHours: number;
  /** Episodes start/stop overlapping by at least this much to be correlated (hours). */
  correlationOverlapHours: number;
  severity: {
    weights: { magnitude: number; reliability: number; impact: number; persistence: number };
    /** Score boundaries (0-100) for the canonical severity levels. */
    levels: Array<{ min: number; level: SeverityLevel }>;
    /** Incident bonus per additional distinct supporting signal, and its cap. */
    breadthBonusPerSignal: number;
    breadthBonusCap: number;
    /** Fraction of baseline daily revenue treated as "maximum" impact. */
    impactScaleOfDailyRevenue: number;
    /** Hours of persistence that earn the full persistence component. */
    persistenceFullHours: number;
  };
  /** Incidents at or above this severity, with at least one canonical anomaly, open an Investigation. */
  investigationMinSeverity: SeverityLevel;
}

export const DEFAULT_CONFIG: DetectionConfig = {
  maxBaselineSamples: 7,
  minBaselineSamples: 3,
  countDispersion: 1.5,
  replayHorizonHours: 14 * 24,
  pooledHistoryMaxHours: 14 * 24,
  pooledHistoryMinHours: 48,
  clearRatio: 0.5,
  watchRatio: 0.5,
  clearPersistenceHours: 3,
  cooldownHours: 12,
  resolvedRetentionHours: 48,
  correlationOverlapHours: 1,
  severity: {
    weights: { magnitude: 0.3, reliability: 0.25, impact: 0.3, persistence: 0.15 },
    levels: [
      { min: 75, level: "critical" },
      { min: 55, level: "high" },
      { min: 35, level: "medium" },
      { min: 0, level: "low" },
    ],
    breadthBonusPerSignal: 5,
    breadthBonusCap: 15,
    impactScaleOfDailyRevenue: 0.25,
    persistenceFullHours: 24,
  },
  investigationMinSeverity: "medium",
};

const ORDER: Record<SeverityLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
export function severityRank(level: SeverityLevel): number {
  return ORDER[level];
}
export function levelForScore(score: number, config: DetectionConfig = DEFAULT_CONFIG): SeverityLevel {
  return config.severity.levels.find((l) => score >= l.min)?.level ?? "low";
}
