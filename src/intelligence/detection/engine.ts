import { DEFAULT_CONFIG, type DetectionConfig } from "@/intelligence/config";
import { HOUR_MS } from "@/intelligence/signals/rows";
import type { SignalSeries } from "@/intelligence/signals/series";
import { evaluatePoint, methodFor, persistenceFor, type Evaluation, type SignalDef, type Trigger } from "@/intelligence/detection/signal";
import { ALL_SIGNALS } from "@/intelligence/detection/rules";
import { assess, type SeverityAssessment } from "@/intelligence/detection/severity";
import type { CanonicalMetric, Direction, Polarity, RuleFamily, Theme } from "@/intelligence/types";

export interface Episode {
  key: string;
  signalId: string;
  segment: string;
  windowHours: number;
  triggerIndex: number;
  direction: Direction;
  polarity: Polarity;
  /** First evaluation boundary at which the trigger held (start of the consecutive run). */
  onsetAt: string;
  /** Boundary at which persistence was satisfied and the episode became a finding. */
  confirmedAt: string;
  /** Last boundary at which the trigger still held. */
  lastTriggeredAt: string;
  resolvedAt: string | null;
  /** Baseline windows for this episode end at or before this instant (frozen at onset). */
  baselineCutoff: string;
  latest: Evaluation;
  peak: Evaluation;
  severity: SeverityAssessment;
}

export interface FindingDraft {
  /** Stable natural key: signal | segment | direction | onset of the earliest episode. */
  key: string;
  signalId: string;
  label: string;
  family: RuleFamily;
  theme: Theme;
  canonicalMetric: CanonicalMetric | null;
  segment: string;
  direction: Direction;
  polarity: Polarity;
  onsetAt: string;
  confirmedAt: string;
  lastTriggeredAt: string;
  resolvedAt: string | null;
  active: boolean;
  episodes: Episode[];
  primary: Episode;
  severity: SeverityAssessment;
}

export interface SkippedCheck {
  signalId: string;
  windowHours: number;
  segments: number;
  reason: string;
}

export interface DetectionRun {
  businessId: string;
  simulationRunId: string;
  asOf: string;
  historyStart: string;
  replayFrom: string;
  findings: FindingDraft[];
  evaluatedKeys: number;
  evaluatedSignals: string[];
  skipped: SkippedCheck[];
  pendingSignals: number;
}

export interface DetectOptions {
  config?: DetectionConfig;
  signals?: readonly SignalDef[];
  /** Onsets of still-open findings persisted by earlier scans (keyed like Episode.key) for incidents older than the horizon. */
  priorOnsets?: ReadonlyMap<string, string>;
}

export function episodeKey(def: SignalDef, segment: string, W: number, trigger: Trigger): string {
  return `${def.id}|${segment}|w${W}|${trigger.direction}`;
}

function hoursBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / HOUR_MS;
}

/**
 * Deterministic forward replay of one signal key over [kStart, kEnd]. Each boundary is evaluated with only the data
 * available at that instant, so the result equals what hourly monitoring would have produced.
 *
 * - A trigger must hold for `persistenceFor()` consecutive hours before an episode is confirmed.
 * - The baseline cutoff freezes at the first triggering boundary, so the suspected incident never leaks into the
 *   baseline that judges it.
 * - An active episode resolves only after its strength stays below `clearRatio` for `clearPersistenceHours` (hysteresis).
 */
export function replayKey(def: SignalDef, triggerIndex: number, series: SignalSeries, segment: string, W: number, kStart: number, kEnd: number, config: DetectionConfig, priorOnset?: string): { episodes: Episode[]; final: Evaluation | null; pending: boolean } {
  const trigger = def.triggers[triggerIndex];
  const persistence = persistenceFor(def, W);
  const key = episodeKey(def, segment, W, trigger);
  const watchFreezes = methodFor(def, W) !== "pooled_history";
  const episodes: Episode[] = [];
  let final: Evaluation | null = null;
  let streak = 0; let candidateK = -1; let frozenK: number | null = null; let clearStreak = 0;
  let active: Omit<Episode, "severity"> | null = null;

  if (priorOnset) {
    const onsetK = series.boundary(priorOnset);
    if (onsetK < kStart) { frozenK = onsetK - W; candidateK = onsetK; streak = persistence; }
  }

  const close = (ep: Omit<Episode, "severity">, endAt: string): Episode => {
    const ev = ep.resolvedAt ? ep.peak : ep.latest;
    return { ...ep, severity: assess(def, triggerIndex, series, segment, W, series.boundary(ep.baselineCutoff), ev, Math.max(1, hoursBetween(ep.onsetAt, endAt)), config) };
  };

  for (let k = kStart; k <= kEnd; k++) {
    const cutoffK = frozenK ?? k - W;
    const ev = evaluatePoint(def, trigger, series, segment, W, k, cutoffK, config);
    if (k === kEnd) final = ev;
    if (!ev.ok) {
      if (!active && streak < persistence) { streak = 0; candidateK = -1; frozenK = null; }
      continue;
    }
    if (!active) {
      // Watch: a half-strength deviation freezes a windowed baseline (contamination guard for slow onsets). Pooled-
      // history baselines are diluted by days of history, and freezing them would only discard information.
      if (watchFreezes && ev.strength >= config.watchRatio && frozenK === null) frozenK = k - W;
      if (ev.triggered) {
        if (streak === 0) { candidateK = k; if (frozenK === null) frozenK = k - W; }
        streak++;
        if (streak >= persistence) {
          active = { key, signalId: def.id, segment, windowHours: W, triggerIndex, direction: trigger.direction, polarity: trigger.polarity,
            onsetAt: series.time(candidateK), confirmedAt: series.time(k), lastTriggeredAt: series.time(k), resolvedAt: null,
            baselineCutoff: series.time(frozenK ?? k - W), latest: ev, peak: ev };
          clearStreak = 0;
        }
      } else {
        streak = 0; candidateK = -1;
        if (!watchFreezes || ev.strength < config.watchRatio) frozenK = null;
      }
      continue;
    }
    active.latest = ev;
    if (ev.strength > active.peak.strength) active.peak = ev;
    if (ev.triggered) active.lastTriggeredAt = series.time(k);
    if (ev.cleared) {
      clearStreak++;
      if (clearStreak >= config.clearPersistenceHours) {
        active.resolvedAt = series.time(k);
        episodes.push(close(active, active.resolvedAt));
        active = null; streak = 0; candidateK = -1; frozenK = null; clearStreak = 0;
      }
    } else {
      clearStreak = 0;
    }
  }
  if (active) episodes.push(close(active, series.time(kEnd)));
  return { episodes, final, pending: !active && streak > 0 };
}

function segmentsFor(def: SignalDef, series: SignalSeries): string[] {
  const out: string[] = [];
  for (const kind of def.segmentKinds) {
    if (kind === "global") out.push("global");
    else out.push(...series.segments(kind));
  }
  return out;
}

/** Groups overlapping episodes of the same signal/segment/direction (different windows) into one finding. */
function cluster(episodes: Episode[], asOf: string, defs: ReadonlyMap<string, SignalDef>): FindingDraft[] {
  const groups = new Map<string, Episode[]>();
  for (const e of episodes) {
    const g = `${e.signalId}|${e.segment}|${e.direction}`;
    groups.set(g, [...(groups.get(g) ?? []), e]);
  }
  const findings: FindingDraft[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => Date.parse(a.onsetAt) - Date.parse(b.onsetAt));
    let current: Episode[] = [];
    let currentEnd = -Infinity;
    const flush = () => {
      if (current.length === 0) return;
      const def = defs.get(current[0].signalId)!;
      const primary = [...current].sort((a, b) => b.severity.score - a.severity.score || a.windowHours - b.windowHours)[0];
      const active = current.some((e) => e.resolvedAt === null);
      const onsetAt = current[0].onsetAt;
      findings.push({
        key: `${def.id}|${primary.segment}|${primary.direction}|${onsetAt}`, signalId: def.id, label: def.label, family: def.family, theme: def.theme,
        canonicalMetric: def.canonicalMetric ?? null, segment: primary.segment, direction: primary.direction, polarity: primary.polarity,
        onsetAt, confirmedAt: current.map((e) => e.confirmedAt).sort()[0], lastTriggeredAt: current.map((e) => e.lastTriggeredAt).sort().at(-1)!,
        resolvedAt: active ? null : current.map((e) => e.resolvedAt as string).sort().at(-1)!, active,
        episodes: current, primary, severity: primary.severity,
      });
      current = []; currentEnd = -Infinity;
    };
    for (const e of list) {
      const start = Date.parse(e.onsetAt);
      const end = Date.parse(e.resolvedAt ?? asOf);
      if (current.length > 0 && start > currentEnd) flush();
      current.push(e);
      currentEnd = Math.max(currentEnd, end);
    }
    flush();
  }
  return findings.sort((a, b) => b.severity.score - a.severity.score || a.key.localeCompare(b.key));
}

/**
 * Runs every rule family over the observation series and returns findings. Pure: no I/O, no simulator inputs.
 * The latest boundary of the series is the analysis time (`asOf`).
 */
export function detect(series: SignalSeries, options: DetectOptions = {}): DetectionRun {
  const config = options.config ?? DEFAULT_CONFIG;
  const defs = options.signals ?? ALL_SIGNALS;
  const kEnd = series.hours;
  const kStart = Math.max(1, kEnd - config.replayHorizonHours);
  const episodes: Episode[] = [];
  const skippedMap = new Map<string, SkippedCheck>();
  let evaluatedKeys = 0; let pending = 0;
  for (const def of defs) {
    for (const segment of segmentsFor(def, series)) {
      for (const W of def.windows) {
        def.triggers.forEach((trigger, ti) => {
          evaluatedKeys++;
          const r = replayKey(def, ti, series, segment, W, kStart, kEnd, config, options.priorOnsets?.get(episodeKey(def, segment, W, trigger)));
          episodes.push(...r.episodes);
          if (r.pending) pending++;
          if (r.final && !r.final.ok && ti === 0) {
            const reason = (r.final.skipReason ?? "not evaluable").replace(/[\d.]+/g, "#");
            const k = `${def.id}|${W}|${reason}`;
            const entry = skippedMap.get(k) ?? { signalId: def.id, windowHours: W, segments: 0, reason: r.final.skipReason ?? "not evaluable" };
            entry.segments++;
            skippedMap.set(k, entry);
          }
        });
      }
    }
  }
  const asOf = series.time(kEnd);
  return {
    businessId: series.businessId, simulationRunId: series.simulationRunId, asOf, historyStart: series.startAt, replayFrom: series.time(kStart),
    findings: cluster(episodes, asOf, new Map(defs.map((d) => [d.id, d]))), evaluatedKeys, evaluatedSignals: defs.map((d) => d.id),
    skipped: [...skippedMap.values()].sort((a, b) => a.signalId.localeCompare(b.signalId)), pendingSignals: pending,
  };
}
