import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { writeFileSync, appendFileSync } from "node:fs";
import { getDb } from "@/lib/mongodb";
import { injectScenario, startRun, tickRun } from "@/simulator/runtime";
import { runMonitor } from "@/intelligence/monitor";
import { loadGroupedRows, loadHorizon } from "@/intelligence/signals/load";
import { groupEvents } from "@/intelligence/signals/rows";
import { TEST_BUSINESS, eventsForRun, resetTestRun } from "../helpers";
const OUT = join(mkdtempSync(join(tmpdir(), "normal-diagnostic-")), "smoke.txt");
const RUN = "t_det_smoke";
it("smoke", async () => {
  writeFileSync(OUT, "");
  await resetTestRun(RUN);
  await startRun({ businessId: TEST_BUSINESS, simulationRunId: RUN, seed: 42, makeActive: false });
  for (let i = 0; i < 2; i++) await tickRun({ simulationRunId: RUN, ticks: 36 }, { businessId: TEST_BUSINESS });
  await injectScenario({ simulationRunId: RUN, scenario: "ad_fatigue", severity: 0.8 }, TEST_BUSINESS);
  await tickRun({ simulationRunId: RUN, ticks: 24 }, { businessId: TEST_BUSINESS });
  const db = await getDb();
  const horizon = await loadHorizon(db, TEST_BUSINESS, RUN);
  appendFileSync(OUT, `horizon ${JSON.stringify(horizon)}\n`);
  const t0 = Date.now();
  const mongoRows = await loadGroupedRows(db, TEST_BUSINESS, RUN, horizon!.historyStart, horizon!.watermark);
  appendFileSync(OUT, `loadGroupedRows ${Date.now() - t0}ms\n`);
  const memRows = groupEvents(await eventsForRun(RUN), { startAt: horizon!.historyStart, endAt: horizon!.watermark });
  const norm = (rows: unknown[]) => JSON.stringify([...rows].map((r) => JSON.stringify(r, Object.keys(r as object).sort())).sort());
  for (const k of Object.keys(memRows) as Array<keyof typeof memRows>) {
    const a = k === "shipments" ? (memRows[k] as Array<{ productIds: string[] }>).map((r) => ({ ...r, productIds: [...r.productIds].sort() })) : memRows[k];
    const b = k === "shipments" ? (mongoRows[k] as Array<{ productIds: string[] }>).map((r) => ({ ...r, productIds: [...r.productIds].sort() })) : mongoRows[k];
    appendFileSync(OUT, `rows ${k}: mem=${memRows[k].length} mongo=${mongoRows[k].length} equal=${norm(a) === norm(b)}\n`);
  }
  const s1 = await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN });
  appendFileSync(OUT, `scan1 ${s1.durationMs}ms findings=${JSON.stringify(s1.findings)} persisted=${JSON.stringify(s1.persisted)}\n incidents=${JSON.stringify(s1.incidents)}\n skipped=${s1.skippedChecks.length}\n`);
  const s2 = await runMonitor({ businessId: TEST_BUSINESS, simulationRunId: RUN });
  appendFileSync(OUT, `scan2 ${s2.durationMs}ms repeat=${s2.repeatScan} persisted=${JSON.stringify(s2.persisted)}\n`);
}, 600_000);
