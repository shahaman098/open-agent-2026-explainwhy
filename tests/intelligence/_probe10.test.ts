import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { writeFileSync, appendFileSync } from "node:fs";
import { Anomaly } from "@normal/contracts";
import { getDb } from "@/lib/mongodb";
import { COLLECTIONS } from "@/lib/collections";
import { computeSnapshots } from "@/analytics/metrics";
import type { FindingDoc } from "@/intelligence/detection/persistence";
import { TEST_BUSINESS } from "../helpers";
const OUT = join(mkdtempSync(join(tmpdir(), "normal-diagnostic-")), "probe10.txt");
it("diag", async () => {
  writeFileSync(OUT, "");
  const db = await getDb();
  const RUN = "t_det_smoke";
  for (const f of await db.collection<FindingDoc>(COLLECTIONS.detectionFindings).find({ businessId: TEST_BUSINESS, simulationRunId: RUN }).toArray()) {
    const n = await db.collection(COLLECTIONS.businessEvents).countDocuments(f.evidence.eventQuery.filter);
    appendFileSync(OUT, `${f.signalId} ${f.segmentKey} anomaly=${f.anomalyId ? f.canonicalMetric : "-"} eventQuery=${n} actual=${f.evaluation.actual} expected=${f.evaluation.expected} est=${f.evaluation.baseline?.estimator}\n`);
  }
  // ad window alignment
  const [snap] = await computeSnapshots({ businessId: TEST_BUSINESS, simulationRunId: RUN, startAt: "2026-10-02T10:00:00.000Z", endAt: "2026-10-02T11:00:00.000Z", bucket: "window", dimension: {}, virtualTime: "2026-10-05T00:00:00.000Z" });
  const ads = await db.collection(COLLECTIONS.businessEvents).find({ businessId: TEST_BUSINESS, simulationRunId: RUN, type: "ad.metrics_observed", "payload.window.startAt": "2026-10-02T10:00:00.000Z" }).toArray();
  const adsPrev = await db.collection(COLLECTIONS.businessEvents).find({ businessId: TEST_BUSINESS, simulationRunId: RUN, type: "ad.metrics_observed", "payload.window.startAt": "2026-10-02T09:00:00.000Z" }).toArray();
  const sum = (xs: Array<Record<string, unknown>>) => xs.reduce((a, e) => a + ((e.payload as { impressions: number }).impressions), 0);
  appendFileSync(OUT, `snapshot [10,11) impressions=${snap.counters.impressions}; ad window [10,11)=${sum(ads)}; ad window [09,10)=${sum(adsPrev)}; occurredAt of [10,11) events=${ads[0]?.occurredAt}\n`);
  void Anomaly;
});
