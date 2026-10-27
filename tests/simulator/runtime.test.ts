import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SimulatorRun, SimulatorTickResponse } from "@normal/contracts";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { loadState } from "@/simulator/persistence";
import { SimulatorError, getRunSummary, injectScenario, startRun, tickRun } from "@/simulator/runtime";
import { TEST_BUSINESS, eventsForRun, normaliseEvents, resetTestRun } from "../helpers";

const RUN_A = "t_rt_a";
const RUN_B = "t_rt_b";
const RUN_C = "t_rt_c";

describe("simulator runtime (MongoDB-backed)", () => {
  beforeAll(async () => { for (const r of [RUN_A, RUN_B, RUN_C]) await resetTestRun(r); });
  afterAll(async () => { for (const r of [RUN_A, RUN_B, RUN_C]) await resetTestRun(r); });

  it("starts a run that validates as a canonical SimulatorRun and refuses silent overwrite", async () => {
    const summary = await startRun({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, seed: 42, makeActive: true });
    expect(SimulatorRun.safeParse(summary.run).success).toBe(true);
    expect(summary.run.activeScenario).toBe("healthy");
    expect(summary.tickIndex).toBe(0);
    await expect(startRun({ businessId: TEST_BUSINESS, simulationRunId: RUN_A, seed: 42 })).rejects.toBeInstanceOf(SimulatorError);
    const db = await getDb();
    expect(await db.collection(COLLECTIONS.simulatedProducts).countDocuments({ businessId: TEST_BUSINESS, simulationRunId: RUN_A })).toBe(17);
    expect(await db.collection(COLLECTIONS.simulatedCampaigns).countDocuments({ businessId: TEST_BUSINESS, simulationRunId: RUN_A })).toBe(5);
  });

  it("ticks persist canonical events through ingestion, and idempotency keys replay the same response", async () => {
    const res = await tickRun({ simulationRunId: RUN_A, ticks: 24 }, { businessId: TEST_BUSINESS, idempotencyKey: "tick-key-1" });
    expect(SimulatorTickResponse.safeParse(res).success).toBe(true);
    expect(res.generatedEventsCount).toBeGreaterThan(500);
    expect(res.virtualTime).toBe("2026-10-02T00:00:00.000Z");
    const stored = await eventsForRun(RUN_A);
    expect(stored.length).toBe(res.generatedEventsCount);
    expect(new Set(stored.map((e) => e.eventId))).toEqual(new Set(res.generatedEventIds));

    const replay = await tickRun({ simulationRunId: RUN_A, ticks: 24 }, { businessId: TEST_BUSINESS, idempotencyKey: "tick-key-1" });
    expect(replay).toEqual(res);
    expect((await eventsForRun(RUN_A)).length).toBe(res.generatedEventsCount);
    const summary = await getRunSummary(TEST_BUSINESS, RUN_A);
    expect(summary.tickIndex).toBe(24);
    expect(summary.totals.events).toBe(res.generatedEventsCount);
  });

  it("concurrent ticks on one run are serialised by the lease lock (exactly one proceeds)", async () => {
    const results = await Promise.allSettled([
      tickRun({ simulationRunId: RUN_A, ticks: 2 }, { businessId: TEST_BUSINESS }),
      tickRun({ simulationRunId: RUN_A, ticks: 2 }, { businessId: TEST_BUSINESS }),
      tickRun({ simulationRunId: RUN_A, ticks: 2 }, { businessId: TEST_BUSINESS }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const locked = results.filter((r) => r.status === "rejected" && (r.reason as SimulatorError).code === "run_locked");
    expect(ok.length).toBe(1);
    expect(locked.length).toBe(2);
    const state = await loadState(await getDb(), TEST_BUSINESS, RUN_A);
    expect(state?.lock).toBeNull();
    expect(state?.tickIndex).toBe(26);
  });

  it("the same seed replayed in a second run reproduces identical persisted observations", async () => {
    await startRun({ businessId: TEST_BUSINESS, simulationRunId: RUN_B, seed: 42, makeActive: false });
    await tickRun({ simulationRunId: RUN_B, ticks: 24 }, { businessId: TEST_BUSINESS });
    await tickRun({ simulationRunId: RUN_B, ticks: 2 }, { businessId: TEST_BUSINESS });
    const a = normaliseEvents(await eventsForRun(RUN_A), RUN_A);
    const b = normaliseEvents(await eventsForRun(RUN_B), RUN_B);
    expect(a.length).toBe(b.length);
    expect(a).toEqual(b);
  });

  it("a run resumed from persisted state (restart) continues identically to an uninterrupted run", async () => {
    await startRun({ businessId: TEST_BUSINESS, simulationRunId: RUN_C, seed: 42, makeActive: false });
    // Twelve 1-tick calls each reload state from MongoDB, mimicking server restarts between requests.
    for (let i = 0; i < 12; i++) await tickRun({ simulationRunId: RUN_C, ticks: 1 }, { businessId: TEST_BUSINESS });
    await tickRun({ simulationRunId: RUN_C, ticks: 14 }, { businessId: TEST_BUSINESS });
    const c = normaliseEvents(await eventsForRun(RUN_C), RUN_C);
    const a = normaliseEvents(await eventsForRun(RUN_A), RUN_A);
    expect(c).toEqual(a);
  });

  it("inject validates the canonical request, records private ground truth, and never leaks it via the summary", async () => {
    await expect(injectScenario({ simulationRunId: RUN_A, scenario: "shipping_delays", severity: 0.5 }, TEST_BUSINESS)).rejects.toThrow();
    const summary = await injectScenario({ simulationRunId: RUN_A, scenario: "ad_fatigue", severity: 0.8 }, TEST_BUSINESS);
    expect(summary.run.activeScenario).toBe("ad_fatigue");
    expect(summary.run.scenarioSeverity).toBe(0.8);
    expect(JSON.stringify(summary)).not.toContain("ctrFatigueStrength");
    const db = await getDb();
    const truth = await db.collection(COLLECTIONS.simulatorGroundTruth).findOne({ simulationRunId: RUN_A });
    expect(truth?.scenario).toBe("ad_fatigue");
    expect(truth?.actualCauses).toEqual(["ad_fatigue"]);
  });

  it("rejects unknown runs and malformed tick requests", async () => {
    await expect(tickRun({ simulationRunId: "nope", ticks: 1 }, { businessId: TEST_BUSINESS })).rejects.toMatchObject({ code: "run_not_found" });
    await expect(tickRun({ simulationRunId: RUN_A, ticks: 61 }, { businessId: TEST_BUSINESS })).rejects.toThrow();
    await expect(tickRun({ simulationRunId: RUN_A, ticks: 0 }, { businessId: TEST_BUSINESS })).rejects.toThrow();
  });
});
