import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { writeFileSync, appendFileSync } from "node:fs";
import { harnessCatalogue, simulate } from "@/intelligence/evaluation/harness";
import { groupEvents } from "@/intelligence/signals/rows";
import { SignalSeries, FIELDS } from "@/intelligence/signals/series";
const OUT = join(mkdtempSync(join(tmpdir(), "normal-diagnostic-")), "probe3.txt");
it("volumes", () => {
  writeFileSync(OUT, "");
  const t = simulate({ seed: 42, healthyHours: 24 * 7 });
  const s = new SignalSeries(t.businessId, t.simulationRunId, t.startAt, t.endAt, groupEvents(t.events, { startAt: t.startAt, endAt: t.endAt }), harnessCatalogue());
  for (let d = 0; d < 7; d++) {
    const row = Object.fromEntries(FIELDS.map((f) => [f, Math.round(s.sum("global", f, d * 24, d * 24 + 24))]));
    appendFileSync(OUT, `day ${d}: ${JSON.stringify(row)} overdue@end=${s.overdueOpen[d * 24 + 24]} backlog=${s.backlog[d * 24 + 24]}\n`);
  }
  for (const seg of s.segments("product")) appendFileSync(OUT, `${seg}: orders/7d=${s.sum(seg, "orders", 0, 168)} reviews=${s.sum(seg, "reviews", 0, 168)} low=${s.sum(seg, "lowReviews", 0, 168)} due=${s.sum(seg, "shipmentsDue", 0, 168)} late=${s.sum(seg, "shipmentsLate", 0, 168)}\n`);
  for (const seg of s.segments("campaign")) appendFileSync(OUT, `${seg}: sessions/d=${s.sum(seg, "sessions", 24, 168) / 6} orders/d=${s.sum(seg, "orders", 24, 168) / 6} attr/d=${s.sum(seg, "attributedOrders", 24, 168) / 6} impr/d=${s.sum(seg, "impressions", 24, 168) / 6}\n`);
});
