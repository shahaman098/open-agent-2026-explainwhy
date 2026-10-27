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
const OUT = join(mkdtempSync(join(tmpdir(), "normal-diagnostic-")), "probe8.txt");
it("promo", () => {
  writeFileSync(OUT, "");
  const t = simulate({ seed: 1234, healthyHours: 72, scenario: "promo_checkout_failure", severity: 0.8, scenarioHours: 96 });
  const s = new SignalSeries(t.businessId, t.simulationRunId, t.startAt, t.endAt, groupEvents(t.events, { startAt: t.startAt, endAt: t.endAt }), harnessCatalogue());
  appendFileSync(OUT, `failures/day: ${Array.from({ length: 7 }, (_, d) => s.sum("global", "checkoutFailures", d * 24, d * 24 + 24)).join(" ")} orders/day: ${Array.from({ length: 7 }, (_, d) => s.sum("global", "orders", d * 24, d * 24 + 24)).join(" ")}\n`);
  for (const W of [12, 24]) for (let k = 84; k <= 168; k += 6) {
    const def = SIGNALS_BY_ID.get("checkout_failure_rate")!;
    const ev = evaluatePoint(def, def.triggers[0], s, "global", W, k, k - W);
    appendFileSync(OUT, `W${W} k=${k} ok=${ev.ok} ${ev.skipReason ?? ""} actual=${ev.actual?.toFixed(3)} exp=${ev.expected?.toFixed(4)} num=${ev.currentNumerator}/${ev.currentDenominator} z=${ev.z} ${JSON.stringify(ev.details)} checks=${JSON.stringify(ev.checks)} base=${JSON.stringify(ev.baseline?.samples.map((x) => [x.numerator, x.denominator]))}\n`);
  }
});
