import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { writeFileSync, appendFileSync } from "node:fs";
import { harnessCatalogue, simulate } from "@/intelligence/evaluation/harness";
import { groupEvents } from "@/intelligence/signals/rows";
import { SignalSeries } from "@/intelligence/signals/series";
const OUT = join(mkdtempSync(join(tmpdir(), "normal-diagnostic-")), "probe5.txt");
it("trend", () => {
  writeFileSync(OUT, "");
  for (const seed of [42, 7, 1234]) {
    const t = simulate({ seed, healthyHours: 24 * 14 });
    const s = new SignalSeries(t.businessId, t.simulationRunId, t.startAt, t.endAt, groupEvents(t.events, { startAt: t.startAt, endAt: t.endAt }), harnessCatalogue());
    const days = Array.from({ length: 14 }, (_, d) => s.sum("global", "orders", d * 24, d * 24 + 24));
    const sess = Array.from({ length: 14 }, (_, d) => s.sum("global", "sessions", d * 24, d * 24 + 24));
    appendFileSync(OUT, `seed ${seed} orders/day: ${days.join(" ")}\n           sessions/day: ${sess.join(" ")}\n`);
  }
  const nr = simulate({ seed: 42, healthyHours: 72, scenario: "negative_reviews", severity: 0.8, scenarioHours: 240 });
  const s = new SignalSeries(nr.businessId, nr.simulationRunId, nr.startAt, nr.endAt, groupEvents(nr.events, { startAt: nr.startAt, endAt: nr.endAt }), harnessCatalogue());
  const q = Array.from({ length: 13 }, (_, d) => `${s.sum("product:nk_quest_7", "reviews", d * 24, d * 24 + 24)}/${s.sum("product:nk_quest_7", "lowReviews", d * 24, d * 24 + 24)}`);
  const o = Array.from({ length: 13 }, (_, d) => s.sum("product:nk_quest_7", "orders", d * 24, d * 24 + 24));
  appendFileSync(OUT, `negative_reviews s42 quest7 reviews/low per day: ${q.join(" ")}\n  quest7 orders/day: ${o.join(" ")}\n  all reviews/day: ${Array.from({ length: 13 }, (_, d) => s.sum("global", "reviews", d * 24, d * 24 + 24)).join(" ")}\n`);
});
