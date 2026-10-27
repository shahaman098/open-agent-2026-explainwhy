import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { writeFileSync, appendFileSync } from "node:fs";
import { detectTimeline, simulate } from "@/intelligence/evaluation/harness";
const OUT = join(mkdtempSync(join(tmpdir(), "normal-diagnostic-")), "probe7.txt");
it("late fp", () => {
  writeFileSync(OUT, "");
  for (const seed of [7, 1234]) {
    const t = simulate({ seed, healthyHours: 240 });
    const d = detectTimeline(t);
    for (const f of d.run.findings) for (const e of f.episodes) appendFileSync(OUT, `seed ${seed} ${f.signalId} W=${e.windowHours} onset=${e.onsetAt} conf=${e.confirmedAt} res=${e.resolvedAt} peak: actual=${e.peak.actual} exp=${e.peak.expected} num=${e.peak.currentNumerator}/${e.peak.currentDenominator} z=${e.peak.z} ${JSON.stringify(e.peak.details)} samples=${JSON.stringify(e.peak.baseline?.samples.map((s) => [s.startAt.slice(5, 13), s.numerator, s.denominator]))}\n`);
  }
});
