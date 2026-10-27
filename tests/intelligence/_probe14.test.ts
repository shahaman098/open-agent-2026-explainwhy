import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { writeFileSync, appendFileSync } from "node:fs";
import { DEV_SEEDS, HELD_OUT_ROUND_1, HELD_OUT_SEEDS, deliveryDelayWithHistory, negativeReviewEvidence, scoreScenario } from "@/intelligence/evaluation/evaluate";
const OUT = join(mkdtempSync(join(tmpdir(), "normal-diagnostic-")), "probe14.txt");
it("evidence", () => {
  writeFileSync(OUT, "");
  for (const seed of [...DEV_SEEDS, ...HELD_OUT_SEEDS, ...HELD_OUT_ROUND_1]) {
    const ev = negativeReviewEvidence(seed);
    const s = scoreScenario("negative_reviews", seed);
    appendFileSync(OUT, `NR ${seed}: maxLowIn72h=${ev.maxLowIn72h} totalLow=${ev.totalLow} detected=${s.detected} delay=${s.detectionDelayHours} first=${s.firstSignal} off=${JSON.stringify(s.offTargetFindings)}\n`);
  }
  for (const seed of [42, 11, 808]) appendFileSync(OUT, `DD ${seed}: 72h history delay=${deliveryDelayWithHistory(seed, 72)} | 168h history delay=${deliveryDelayWithHistory(seed, 168)}\n`);
});
