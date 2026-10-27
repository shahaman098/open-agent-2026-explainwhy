import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { writeFileSync, appendFileSync } from "node:fs";
import { detectTimeline, harnessCatalogue, simulate } from "@/intelligence/evaluation/harness";
import { groupEvents } from "@/intelligence/signals/rows";
import { SignalSeries } from "@/intelligence/signals/series";
const OUT = join(mkdtempSync(join(tmpdir(), "normal-diagnostic-")), "probe13.txt");
it("r1 fps", () => {
  writeFileSync(OUT, "");
  for (const seed of [2024, 31337]) {
    const t = simulate({ seed, healthyHours: 240 });
    const d = detectTimeline(t);
    const s = new SignalSeries(t.businessId, t.simulationRunId, t.startAt, t.endAt, groupEvents(t.events, { startAt: t.startAt, endAt: t.endAt }), harnessCatalogue());
    appendFileSync(OUT, `seed ${seed} daily orders: ${Array.from({ length: 10 }, (_, i) => s.sum("global", "orders", i * 24, i * 24 + 24)).join(" ")}\n  daily attributed: ${Array.from({ length: 10 }, (_, i) => s.sum("global", "attributedOrders", i * 24, i * 24 + 24)).join(" ")}\n  daily revenue £: ${Array.from({ length: 10 }, (_, i) => Math.round(s.sum("global", "revenueMinor", i * 24, i * 24 + 24) / 100)).join(" ")}\n`);
    for (const f of d.run.findings) { const e = f.primary.peak; appendFileSync(OUT, `  ${f.signalId} W${f.primary.windowHours} onset ${f.onsetAt} res ${f.resolvedAt} actual=${e.actual} exp=${e.expected} chg=${e.changePercent} z=${e.z} ${JSON.stringify(e.details)} samples=${JSON.stringify(e.baseline?.samples.map((x) => Math.round(x.value ?? 0)))}\n`); }
  }
});
