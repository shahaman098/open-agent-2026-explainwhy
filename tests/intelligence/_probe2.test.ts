import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { writeFileSync, appendFileSync } from "node:fs";
import { detectTimeline, harnessCatalogue, simulate } from "@/intelligence/evaluation/harness";
import { groupEvents } from "@/intelligence/signals/rows";
import { SignalSeries } from "@/intelligence/signals/series";
import { SIGNALS_BY_ID } from "@/intelligence/detection/rules";
import { evaluatePoint } from "@/intelligence/detection/signal";
const OUT = join(mkdtempSync(join(tmpdir(), "normal-diagnostic-")), "probe2.txt");
const log = (s: string) => appendFileSync(OUT, s + "\n");
it("probe2", () => {
  writeFileSync(OUT, "");
  const af = simulate({ seed: 42, healthyHours: 72, scenario: "ad_fatigue", severity: 0.8, scenarioHours: 96 });
  const d = detectTimeline(af);
  for (const i of d.incidents.filter((x) => x.primaryTheme === "fulfilment")) {
    log(`AF delivery incident: ${i.title} keys=${i.findingKeys.join(" ; ")}`);
    for (const k of i.findingKeys) { const f = d.run.findings.find((x) => x.key === k)!; log(`   ${f.signalId} peak chg=${f.primary.peak.changePercent} z=${f.primary.peak.z} actual=${f.primary.peak.actual} exp=${f.primary.peak.expected} num=${f.primary.peak.currentNumerator} den=${f.primary.peak.currentDenominator} W=${f.primary.windowHours} n=${f.primary.peak.baseline?.n} samples=${JSON.stringify(f.primary.peak.baseline?.samples.map((s) => [s.numerator, s.denominator]))}`); }
  }
  const pr = simulate({ seed: 42, healthyHours: 72, scenario: "promo_checkout_failure", severity: 0.8, scenarioHours: 96 });
  const rows = groupEvents(pr.events, { startAt: pr.startAt, endAt: pr.endAt });
  const fails = rows.checkoutFailures.reduce((m, r) => { m[r.failureCode] = (m[r.failureCode] ?? 0) + r.n; return m; }, {} as Record<string, number>);
  log(`PROMO failure codes: ${JSON.stringify(fails)} orders=${rows.orders.reduce((a, r) => a + r.n, 0)}`);
  const s = new SignalSeries(pr.businessId, pr.simulationRunId, pr.startAt, pr.endAt, rows, harnessCatalogue());
  for (const id of ["coupon_failure_rate", "checkout_failure_rate"]) {
    const def = SIGNALS_BY_ID.get(id)!;
    for (const k of [80, 100, 140, 168]) {
      const ev = evaluatePoint(def, def.triggers[0], s, "global", 6, k, k - 6);
      log(`  ${id} k=${k} ok=${ev.ok} skip=${ev.skipReason} actual=${ev.actual} exp=${ev.expected} z=${ev.z} chg=${ev.changePercent} checks=${JSON.stringify(ev.checks)} num=${ev.currentNumerator} den=${ev.currentDenominator}`);
    }
  }
});
