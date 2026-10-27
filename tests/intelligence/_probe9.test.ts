import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { writeFileSync, appendFileSync } from "node:fs";
import { harnessCatalogue, simulate } from "@/intelligence/evaluation/harness";
import { groupEvents } from "@/intelligence/signals/rows";
import { SignalSeries } from "@/intelligence/signals/series";
import { SIGNALS_BY_ID } from "@/intelligence/detection/rules";
import { evaluatePoint } from "@/intelligence/detection/signal";
import { replayKey } from "@/intelligence/detection/engine";
import { DEFAULT_CONFIG } from "@/intelligence/config";
const OUT = join(mkdtempSync(join(tmpdir(), "normal-diagnostic-")), "probe9.txt");
it("nr7", () => {
  writeFileSync(OUT, "");
  const t = simulate({ seed: 7, healthyHours: 72, scenario: "negative_reviews", severity: 0.8, scenarioHours: 240 });
  const s = new SignalSeries(t.businessId, t.simulationRunId, t.startAt, t.endAt, groupEvents(t.events, { startAt: t.startAt, endAt: t.endAt }), harnessCatalogue());
  const def = SIGNALS_BY_ID.get("product_low_rating_rate")!;
  appendFileSync(OUT, `quest reviews/low per day: ${Array.from({ length: 13 }, (_, d) => `${s.sum("product:nk_quest_7", "reviews", d * 24, d * 24 + 24)}/${s.sum("product:nk_quest_7", "lowReviews", d * 24, d * 24 + 24)}`).join(" ")}\n`);
  for (let k = 200; k <= 312; k += 4) {
    const ev = evaluatePoint(def, def.triggers[0], s, "product:nk_quest_7", 72, k, k - 72);
    appendFileSync(OUT, `k=${k} ok=${ev.ok} ${ev.skipReason ?? ""} num=${ev.currentNumerator}/${ev.currentDenominator} exp=${ev.expected?.toFixed(4)} z=${ev.z} str=${ev.strength} trig=${ev.triggered} checks=${JSON.stringify(ev.checks)} ${JSON.stringify(ev.details)} base=${JSON.stringify(ev.baseline?.samples.map((x) => [x.startAt.slice(5, 13), x.numerator, x.denominator]))}\n`);
  }
  const r = replayKey(def, 0, s, "product:nk_quest_7", 72, 1, s.hours, DEFAULT_CONFIG);
  appendFileSync(OUT, `replay episodes=${r.episodes.length} pending=${r.pending}\n`);
});
