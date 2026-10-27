import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { appendFileSync, writeFileSync } from "node:fs";
const OUT = join(mkdtempSync(join(tmpdir(), "normal-diagnostic-")), "probe.txt");
const log = (s: string) => appendFileSync(OUT, s + "\n");
import { detectTimeline, simulate } from "@/intelligence/evaluation/harness";

it("probe", () => {
  writeFileSync(OUT, "");
  const t0 = Date.now();
  for (const seed of [42, 7, 1234]) {
    const healthy = simulate({ seed, healthyHours: 24 * 7 });
    const d = detectTimeline(healthy);
    log(`HEALTHY seed ${seed}: ${d.run.findings.length} findings, ${d.incidents.length} incidents, keys ${d.run.evaluatedKeys}, ${Date.now() - t0}ms`);
    for (const f of d.run.findings) log(`  FP ${f.signalId} ${f.segment} ${f.direction} onset ${f.onsetAt} active=${f.active} sev=${f.severity.level}/${f.severity.score} chg=${f.primary.peak.changePercent} z=${f.primary.peak.z} W=${f.primary.windowHours}`);
  }
  for (const scenario of ["ad_fatigue", "delivery_delays", "viral_demand", "promo_checkout_failure", "negative_reviews"] as const) {
    const t = simulate({ seed: 42, healthyHours: 72, scenario, severity: 0.8, scenarioHours: 96 });
    const d = detectTimeline(t);
    log(`\n${scenario}: ${d.run.findings.length} findings, ${d.incidents.length} incidents`);
    for (const f of d.run.findings.slice(0, 14)) log(`  ${f.signalId} ${f.segment} ${f.direction} onset ${f.onsetAt} conf ${f.confirmedAt} active=${f.active} ${f.severity.level}/${f.severity.score} chg=${f.primary.latest.changePercent} W=${f.primary.windowHours}`);
    for (const i of d.incidents) log(`  INCIDENT ${i.title} [${i.polarity}] ${i.severity.level}/${i.severity.score} members=${i.findingKeys.length}`);
  }
});
