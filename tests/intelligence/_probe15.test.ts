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
const OUT = join(mkdtempSync(join(tmpdir(), "normal-diagnostic-")), "probe15.txt");
it("nr99", () => {
  writeFileSync(OUT, "");
  const t = simulate({ seed: 99, healthyHours: 72, scenario: "negative_reviews", severity: 0.8, scenarioHours: 336 });
  const s = new SignalSeries(t.businessId, t.simulationRunId, t.startAt, t.endAt, groupEvents(t.events, { startAt: t.startAt, endAt: t.endAt }), harnessCatalogue());
  appendFileSync(OUT, `quest reviews/low per day: ${Array.from({ length: 17 }, (_, d) => `${s.sum("product:nk_quest_7", "reviews", d * 24, d * 24 + 24)}/${s.sum("product:nk_quest_7", "lowReviews", d * 24, d * 24 + 24)}`).join(" ")}\nall reviews/low per day: ${Array.from({ length: 17 }, (_, d) => `${s.sum("global", "reviews", d * 24, d * 24 + 24)}/${s.sum("global", "lowReviews", d * 24, d * 24 + 24)}`).join(" ")}\n`);
  const def = SIGNALS_BY_ID.get("product_low_rating_rate")!;
  for (let k = 150; k <= 408; k += 6) {
    const ev = evaluatePoint(def, def.triggers[0], s, "product:nk_quest_7", 72, k, k - 72);
    if (!ev.ok && !ev.currentDenominator) continue;
    appendFileSync(OUT, `k=${k} ok=${ev.ok} ${ev.skipReason ?? ""} num=${ev.currentNumerator}/${ev.currentDenominator} exp=${ev.expected?.toFixed(3)} z=${ev.z} zReq=${(ev.details as { zRequired?: number })?.zRequired} rel=${ev.changePercent} trig=${ev.triggered} checks=${JSON.stringify(ev.checks)} base=${JSON.stringify(ev.baseline?.samples.map((x) => [x.numerator, x.denominator]))}\n`);
  }
});
