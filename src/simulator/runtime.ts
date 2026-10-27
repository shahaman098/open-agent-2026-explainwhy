import "server-only";

import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import {
  InjectScenarioRequest, ScenarioGroundTruth, SimulatorRun, SimulatorTickRequest, SimulatorTickResponse,
} from "@normal/contracts";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { getDb, describeDbError } from "@/lib/mongodb";
import { publishCommittedWindows } from "@/simulator/monitoring";
import { getReferenceCatalogue } from "@/reference/service";
import { createInitialWorld } from "@/simulator/bootstrap";
import { DEFAULT_BUSINESS_ID, DEFAULT_BUSINESS_NAME, DEFAULT_MINUTES_PER_TICK, DEFAULT_VIRTUAL_START } from "@/simulator/config";
import { TickEngine } from "@/simulator/engine";
import {
  StockConflictError, deleteRun, loadState, loadWorld, persistInitialWorld, persistTickOutputs,
} from "@/simulator/persistence";
import { Rng } from "@/simulator/rng";
import { SCENARIO_ROOT_CAUSES, deriveScenarioParams } from "@/simulator/scenarios";
import type { SimulatorStateDoc, TickOutput, TickReceipt } from "@/simulator/state";

export type SimulatorRunT = z.infer<typeof SimulatorRun>;
export type SimulatorTickResponseT = z.infer<typeof SimulatorTickResponse>;

/** Supplementary request for creating/resetting a run; the canonical schemas are untouched. */
export const StartSimulatorRequest = z.object({
  businessId: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/).default(DEFAULT_BUSINESS_ID),
  simulationRunId: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/).optional(),
  seed: z.number().int().min(0).max(2_147_483_647).default(42),
  virtualStartAt: z.string().datetime({ offset: true }).default(DEFAULT_VIRTUAL_START),
  minutesPerTick: z.number().int().positive().max(1440).default(DEFAULT_MINUTES_PER_TICK),
  /** When true, an existing run with the same ID is wiped and recreated. */
  reset: z.boolean().default(false),
  makeActive: z.boolean().default(true),
}).strict();
export type StartSimulatorRequestT = z.infer<typeof StartSimulatorRequest>;

/** Default scenario targets. Fixed so the same seed + scenario always hits the same product. */
export const SCENARIO_TARGETS = { viralProductId: "nk_dunk_low_retro", qualityIssueProductId: "nk_quest_7" } as const;

export class SimulatorError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "SimulatorError";
  }
}

const LOCK_LEASE_MS = 90_000;
const PERSIST_CHUNK_TICKS = 12;
const MAX_RECEIPTS = 25;

export function toSimulatorRun(state: SimulatorStateDoc): SimulatorRunT {
  return SimulatorRun.parse({
    schemaVersion: 1, businessId: state.businessId, simulationRunId: state.simulationRunId, seed: state.seed,
    status: state.status, virtualTime: state.virtualTime, minutesPerTick: state.minutesPerTick,
    activeScenario: state.activeScenario, scenarioSeverity: state.scenarioSeverity,
    createdAt: state.createdAt, updatedAt: state.updatedAt,
  });
}

export interface RunSummary {
  run: SimulatorRunT;
  tickIndex: number;
  virtualStartAt: string;
  totals: SimulatorStateDoc["totals"];
  locked: boolean;
  scenarioInjectedAt: string | null;
  isActiveRun: boolean;
}

export async function getActiveRunId(businessId: string, db?: Db): Promise<string | null> {
  const d = db ?? (await getDb());
  const doc = await d.collection<{ businessId: string; activeSimulationRunId?: string }>(COLLECTIONS.businesses).findOne({ businessId });
  return doc?.activeSimulationRunId ?? null;
}

export async function startRun(input: unknown, db?: Db): Promise<RunSummary> {
  const req = StartSimulatorRequest.parse(input);
  const d = db ?? (await getDb());
  await ensureIndexes(d);
  const simulationRunId = req.simulationRunId ?? `run_nike_s${req.seed}`;
  const existing = await loadState(d, req.businessId, simulationRunId);
  if (existing && !req.reset) {
    throw new SimulatorError(`Run ${simulationRunId} already exists; pass reset:true to recreate it`, "run_exists", 409);
  }
  if (existing) await deleteRun(d, req.businessId, simulationRunId);

  const now = new Date().toISOString();
  const { products: catalogue } = await getReferenceCatalogue(d);
  const { world } = createInitialWorld({
    businessId: req.businessId, simulationRunId, seed: req.seed, catalogue,
    virtualStartAt: req.virtualStartAt, minutesPerTick: req.minutesPerTick, createdAt: now,
  });
  await persistInitialWorld(d, world);
  await d.collection(COLLECTIONS.simulatorGroundTruth).replaceOne(
    { simulationRunId },
    ScenarioGroundTruth.parse({ simulationRunId, scenario: "healthy", actualCauses: ["unknown"], hiddenFaultParameters: { ...world.state.scenarioParams, severity: 0 } }),
    { upsert: true },
  );
  await d.collection(COLLECTIONS.businesses).updateOne(
    { businessId: req.businessId },
    {
      $setOnInsert: {
        schemaVersion: 1, businessId: req.businessId, name: req.businessId === DEFAULT_BUSINESS_ID ? DEFAULT_BUSINESS_NAME : `${req.businessId} (simulated)`,
        currency: "GBP", timezone: "Europe/London", industry: "Sportswear retail (unaffiliated simulation)", createdAt: now,
      },
      ...(req.makeActive ? { $set: { activeSimulationRunId: simulationRunId } } : {}),
    },
    { upsert: true },
  );
  return summarise(world.state, req.makeActive);
}

function summarise(state: SimulatorStateDoc, isActiveRun: boolean): RunSummary {
  return {
    run: toSimulatorRun(state), tickIndex: state.tickIndex, virtualStartAt: state.virtualStartAt, totals: state.totals,
    locked: Boolean(state.lock && state.lock.expiresAt > new Date().toISOString()), scenarioInjectedAt: state.scenarioInjectedAt, isActiveRun,
  };
}

export async function getRunSummary(businessId: string, simulationRunId: string | null, db?: Db): Promise<RunSummary> {
  const d = db ?? (await getDb());
  const runId = simulationRunId ?? (await getActiveRunId(businessId, d));
  if (!runId) throw new SimulatorError("No active simulation run for this business", "no_active_run", 404);
  const state = await loadState(d, businessId, runId);
  if (!state) throw new SimulatorError(`Run ${runId} not found`, "run_not_found", 404);
  const active = await getActiveRunId(businessId, d);
  return summarise(state, active === runId);
}

/** Acquires the per-run lease lock; returns the token or null if another operation holds it. */
async function acquireLock(d: Db, businessId: string, simulationRunId: string): Promise<string | null> {
  const token = randomUUID();
  const now = new Date();
  const res = await d.collection<SimulatorStateDoc>(COLLECTIONS.simulatorState).updateOne(
    { businessId, simulationRunId, $or: [{ lock: null }, { "lock.expiresAt": { $lt: now.toISOString() } }] },
    { $set: { lock: { token, expiresAt: new Date(now.getTime() + LOCK_LEASE_MS).toISOString() } } },
  );
  return res.matchedCount === 1 ? token : null;
}

async function releaseLock(d: Db, businessId: string, simulationRunId: string, token: string): Promise<void> {
  await d.collection<SimulatorStateDoc>(COLLECTIONS.simulatorState).updateOne(
    { businessId, simulationRunId, "lock.token": token }, { $set: { lock: null } },
  );
}

export async function withRunLock<T>(d: Db, businessId: string, simulationRunId: string, fn: () => Promise<T>): Promise<T> {
  const token = await acquireLock(d, businessId, simulationRunId);
  if (!token) throw new SimulatorError("Another simulator operation is in progress for this run", "run_locked", 409);
  try {
    return await fn();
  } finally {
    await releaseLock(d, businessId, simulationRunId, token);
  }
}

export interface TickOptions {
  businessId: string;
  idempotencyKey?: string;
  db?: Db;
  /** Hook for analytics: called with the windows of all persisted ticks; returns snapshot IDs. */
  afterPersist?: (state: SimulatorStateDoc, windows: Array<{ startAt: string; endAt: string }>, db: Db) => Promise<string[]>;
}

/**
 * Advances a run. Serialised per run by a lease lock, replay-safe via an
 * optional idempotency key, and retry-safe because every generated ID is
 * deterministic (re-ingesting the same tick yields duplicates, not double counts).
 */
export async function tickRun(input: unknown, options: TickOptions): Promise<SimulatorTickResponseT> {
  const req = SimulatorTickRequest.parse(input);
  const d = options.db ?? (await getDb());
  const { businessId } = options;
  const exists = await loadState(d, businessId, req.simulationRunId);
  if (!exists) throw new SimulatorError(`Run ${req.simulationRunId} not found`, "run_not_found", 404);

  const result = await withRunLock(d, businessId, req.simulationRunId, async () => {
    const state = (await loadState(d, businessId, req.simulationRunId))!;
    if (options.idempotencyKey) {
      const receipt = state.recentTickReceipts.find((r) => r.key === options.idempotencyKey);
      if (receipt) return SimulatorTickResponse.parse(receipt.response);
    }
    if (state.status === "completed") throw new SimulatorError("Run is completed", "run_completed", 409);

    const receivedAt = new Date().toISOString();
    const allEventIds: string[] = [];
    const windows: Array<{ startAt: string; endAt: string }> = [];
    let remaining = req.ticks;
    let world = await loadWorld(d, state);
    while (remaining > 0) {
      const chunk = Math.min(PERSIST_CHUNK_TICKS, remaining);
      let attempt = 0;
      for (;;) {
        const rng = Rng.fromState(world.state.rng);
        const snapshotRng = rng.getState();
        const outputs: TickOutput[] = [];
        for (let i = 0; i < chunk; i++) {
          outputs.push(new TickEngine(world, rng, receivedAt).run());
          world.state.rng = rng.getState();
        }
        try {
          await persistTickOutputs(d, world, outputs, receivedAt);
          for (const o of outputs) {
            allEventIds.push(...o.events.map((e) => e.eventId));
            windows.push({ startAt: o.windowStart, endAt: o.windowEnd });
          }
          break;
        } catch (error) {
          if (!(error instanceof StockConflictError) || attempt++ >= 3) throw error;
          // A concurrent storefront purchase changed stock: reload and regenerate this chunk.
          const fresh = (await loadState(d, businessId, req.simulationRunId))!;
          fresh.rng = snapshotRng;
          world = await loadWorld(d, fresh);
        }
      }
      remaining -= chunk;
    }

    const metricSnapshotIds = options.afterPersist ? await options.afterPersist(world.state, windows, d) : [];
    const response = SimulatorTickResponse.parse({
      simulationRunId: req.simulationRunId, virtualTime: world.state.virtualTime,
      generatedEventIds: allEventIds, generatedEventsCount: allEventIds.length, metricSnapshotIds,
    });
    if (options.idempotencyKey) {
      const receipt: TickReceipt = { key: options.idempotencyKey, response, recordedAt: receivedAt };
      await d.collection<SimulatorStateDoc>(COLLECTIONS.simulatorState).updateOne(
        { businessId, simulationRunId: req.simulationRunId },
        { $push: { recentTickReceipts: { $each: [receipt], $slice: -MAX_RECEIPTS } } },
      );
    }
    return response;
  });
  // The world and receipt are already durable and the inventory/run lock is released.
  // A publication failure never turns a successful purchase/tick into a failed request;
  // the durable clock and frozen publication range let the worker recover it.
  try { await publishCommittedWindows(d, businessId, req.simulationRunId); }
  catch (error) { console.error("[monitor-publication]", describeDbError(error)); }
  return result;
}

/** Activates a canonical scenario by swapping the PRIVATE mechanistic parameters. */
export async function injectScenario(input: unknown, businessId: string, db?: Db): Promise<RunSummary> {
  const req = InjectScenarioRequest.parse(input);
  const d = db ?? (await getDb());
  const state = await loadState(d, businessId, req.simulationRunId);
  if (!state) throw new SimulatorError(`Run ${req.simulationRunId} not found`, "run_not_found", 404);
  return withRunLock(d, businessId, req.simulationRunId, async () => {
    const params = deriveScenarioParams(req.scenario, req.severity, SCENARIO_TARGETS);
    const now = new Date().toISOString();
    await d.collection<SimulatorStateDoc>(COLLECTIONS.simulatorState).updateOne(
      { businessId, simulationRunId: req.simulationRunId },
      { $set: { activeScenario: req.scenario, scenarioSeverity: req.severity, scenarioParams: params, scenarioInjectedAt: state.virtualTime, updatedAt: now } },
    );
    await d.collection(COLLECTIONS.simulatorGroundTruth).replaceOne(
      { simulationRunId: req.simulationRunId },
      ScenarioGroundTruth.parse({
        simulationRunId: req.simulationRunId, scenario: req.scenario, actualCauses: SCENARIO_ROOT_CAUSES[req.scenario],
        hiddenFaultParameters: { ...params, severity: req.severity, injectedAtVirtualTime: state.virtualTime, targets: SCENARIO_TARGETS },
      }),
      { upsert: true },
    );
    const updated = (await loadState(d, businessId, req.simulationRunId))!;
    return summarise(updated, (await getActiveRunId(businessId, d)) === req.simulationRunId);
  });
}
