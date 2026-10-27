import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { writeFileSync, appendFileSync } from "node:fs";
import { detectTimeline, simulate } from "@/intelligence/evaluation/harness";
const OUT = join(mkdtempSync(join(tmpdir(), "normal-diagnostic-")), "probe4.txt");
const log = (s: string) => appendFileSync(OUT, s + "\n");
it("long", () => {
  writeFileSync(OUT, "");
  for (const [scenario, hours] of [["negative_reviews", 240], ["viral_demand", 192], ["delivery_delays", 240]] as const) {
    for (const seed of [42, 7]) {
      const t = simulate({ seed, healthyHours: 72, scenario, severity: 0.8, scenarioHours: hours });
      const d = detectTimeline(t);
      log(`\n${scenario} seed ${seed} (${hours}h): ${d.run.findings.length} findings`);
      for (const f of d.run.findings) log(`  ${f.signalId} ${f.segment} ${f.direction} onset ${f.onsetAt} active=${f.active} ${f.severity.level}/${f.severity.score} chg=${f.primary.peak.changePercent} num=${f.primary.peak.currentNumerator}/${f.primary.peak.currentDenominator}`);
      for (const i of d.incidents) log(`  INCIDENT ${i.title} [${i.polarity}] ${i.severity.level}/${i.severity.score} members=${i.findingKeys.length} themes=${i.themes.join(",")}`);
    }
  }
});
