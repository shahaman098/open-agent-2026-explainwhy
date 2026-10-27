import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { writeFileSync, appendFileSync } from "node:fs";
import { DEV_SEEDS, EXPECTED_THEMES, scoreHealthy, scoreScenario } from "@/intelligence/evaluation/evaluate";
const OUT = join(mkdtempSync(join(tmpdir(), "normal-diagnostic-")), "probe6.txt");
const log = (s: string) => appendFileSync(OUT, s + "\n");
it("dev evaluation", () => {
  writeFileSync(OUT, "");
  for (const seed of DEV_SEEDS) { const h = scoreHealthy(seed, 24 * 10); log(`HEALTHY ${seed} 10d: findings=${JSON.stringify(h.findings)} incidents=${h.incidents} worthy=${h.investigationWorthyIncidents}`); }
  for (const scenario of Object.keys(EXPECTED_THEMES) as Array<keyof typeof EXPECTED_THEMES>) {
    for (const seed of DEV_SEEDS) {
      const s = scoreScenario(scenario, seed);
      log(`${scenario} ${seed}: detected=${s.detected} delay=${s.detectionDelayHours}h first=${s.firstSignal} worthy=${s.investigationWorthy} title="${s.primaryIncidentTitle}" pre=${s.preInjectionFindings} off=${JSON.stringify(s.offTargetFindings)} inv=${s.inventoryRiskDetected} f=${s.totalFindings} i=${s.totalIncidents}`);
    }
  }
});
