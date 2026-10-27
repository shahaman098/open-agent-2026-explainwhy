/**
 * EVALUATION HARNESS ONLY — never imported by the production detection path.
 *
 * Runs the real Nike simulator engine in memory (no MongoDB), then feeds ONLY its canonical events to the real
 * detection core. Scenario labels and parameters are used here solely to inject incidents and to score results
 * afterwards; they are never passed to `detect()` or `correlate()`.
 */
import type { BusinessEventT } from "@normal/contracts";
import { NIKE_REFERENCE_CATALOGUE } from "@/reference/nike-catalogue";
import { createInitialWorld } from "@/simulator/bootstrap";
import { OPERATIONAL_ASSUMPTIONS } from "@/simulator/catalogue";
import { TickEngine } from "@/simulator/engine";
import { deriveScenarioParams, type ScenarioNameT } from "@/simulator/scenarios";
import { SCENARIO_TARGETS } from "@/simulator/runtime";
import { DEFAULT_CONFIG, type DetectionConfig } from "@/intelligence/config";
import { correlate, type IncidentDraft } from "@/intelligence/detection/correlation";
import { detect, type DetectionRun } from "@/intelligence/detection/engine";
import { groupEvents } from "@/intelligence/signals/rows";
import { SignalSeries } from "@/intelligence/signals/series";
import type { CatalogueLabel } from "@/intelligence/types";

export const HARNESS_RECEIVED_AT = "2026-10-24T00:00:00.000Z";

/** Product labels as the storefront exposes them (name + category only). */
export function harnessCatalogue(): Map<string, CatalogueLabel> {
  const refs = new Map(NIKE_REFERENCE_CATALOGUE.map((r) => [r.referenceProductId, r]));
  return new Map(OPERATIONAL_ASSUMPTIONS.map((a) => {
    const r = refs.get(a.referenceProductId)!;
    return [a.productId, { name: r.name, category: r.category }];
  }));
}

export interface SimulatedTimeline {
  businessId: string;
  simulationRunId: string;
  seed: number;
  events: BusinessEventT[];
  startAt: string;
  injectedAt: string | null;
  endAt: string;
  scenario: ScenarioNameT;
  severity: number;
}

export interface SimulateOptions {
  seed: number;
  healthyHours: number;
  scenario?: ScenarioNameT;
  severity?: number;
  scenarioHours?: number;
  simulationRunId?: string;
}

export function simulate(opts: SimulateOptions): SimulatedTimeline {
  const businessId = "nike_eval";
  const simulationRunId = opts.simulationRunId ?? `eval_${opts.scenario ?? "healthy"}_s${opts.seed}`;
  const { world, rng } = createInitialWorld({ businessId, simulationRunId, seed: opts.seed, catalogue: NIKE_REFERENCE_CATALOGUE, createdAt: HARNESS_RECEIVED_AT });
  const startAt = world.state.virtualTime;
  const events: BusinessEventT[] = [];
  const tick = () => { const o = new TickEngine(world, rng, HARNESS_RECEIVED_AT).run(); world.state.rng = rng.getState(); events.push(...o.events); };
  for (let i = 0; i < opts.healthyHours; i++) tick();
  let injectedAt: string | null = null;
  const scenario = opts.scenario ?? "healthy";
  if (opts.scenario && opts.scenario !== "healthy") {
    injectedAt = world.state.virtualTime;
    world.state.scenarioParams = deriveScenarioParams(opts.scenario, opts.severity ?? 0.8, SCENARIO_TARGETS);
  }
  for (let i = 0; i < (opts.scenarioHours ?? 0); i++) tick();
  return { businessId, simulationRunId, seed: opts.seed, events, startAt, injectedAt, endAt: world.state.virtualTime, scenario, severity: opts.severity ?? 0 };
}

export interface HarnessDetection {
  run: DetectionRun;
  incidents: IncidentDraft[];
}

/** Detection exactly as production runs it, but from in-memory events. `asOf` defaults to the timeline end. */
export function detectTimeline(t: SimulatedTimeline, asOf: string = t.endAt, config: DetectionConfig = DEFAULT_CONFIG): HarnessDetection {
  const catalogue = harnessCatalogue();
  const rows = groupEvents(t.events, { startAt: t.startAt, endAt: asOf });
  const series = new SignalSeries(t.businessId, t.simulationRunId, t.startAt, asOf, rows, catalogue);
  const run = detect(series, { config });
  return { run, incidents: correlate(run.findings, run.asOf, catalogue, config) };
}
