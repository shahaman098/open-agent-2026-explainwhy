import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { writeFileSync, appendFileSync } from "node:fs";
import { harnessCatalogue, simulate } from "@/intelligence/evaluation/harness";
import { groupEvents } from "@/intelligence/signals/rows";
import { SignalSeries, type Field } from "@/intelligence/signals/series";
const OUT = join(mkdtempSync(join(tmpdir(), "normal-diagnostic-")), "probe12.txt");
it("dispersion (dev seeds only)", () => {
  writeFileSync(OUT, "");
  const acc = new Map<string, number[]>();
  for (const seed of [42, 7, 1234]) {
    const t = simulate({ seed, healthyHours: 24 * 14 });
    const s = new SignalSeries(t.businessId, t.simulationRunId, t.startAt, t.endAt, groupEvents(t.events, { startAt: t.startAt, endAt: t.endAt }), harnessCatalogue());
    const series: Array<[string, string, Field]> = [
      ["orders", "global", "orders"], ["paidOrders", "global", "paidOrders"], ["sessions", "global", "sessions"], ["paidSessions", "global", "paidSessions"],
      ["clicks", "global", "clicks"], ["attributedOrders", "global", "attributedOrders"], ["shipmentsLate", "global", "shipmentsLate"], ["reviews", "global", "reviews"],
      ["mentions", "global", "mentions"], ["checkoutFailures", "global", "checkoutFailures"],
      ...s.segments("campaign").map((c) => [`campaignOrders`, c, "orders"] as [string, string, Field]),
      ...s.segments("product").map((p) => [`productOrders`, p, "orders"] as [string, string, Field]),
      ...s.segments("channel").map((p) => [`channelSessions`, p, "sessions"] as [string, string, Field]),
    ];
    for (const [name, seg, field] of series) {
      const days = Array.from({ length: 11 }, (_, d) => s.sum(seg, field, (d + 3) * 24, (d + 4) * 24));
      const mean = days.reduce((a, b) => a + b, 0) / days.length;
      if (mean < 1) continue;
      const v = days.reduce((a, b) => a + (b - mean) ** 2, 0) / (days.length - 1);
      acc.set(name, [...(acc.get(name) ?? []), v / mean]);
    }
    // revenue: compound-Poisson factor E[X^2]/E[X]^2 from per-order values
    const orders = t.events.filter((e) => e.type === "order.completed").map((e) => (e.type === "order.completed" ? e.payload.netRevenueMinor : 0));
    const m1 = orders.reduce((a, b) => a + b, 0) / orders.length; const m2 = orders.reduce((a, b) => a + b * b, 0) / orders.length;
    acc.set("revenueCompoundFactor", [...(acc.get("revenueCompoundFactor") ?? []), m2 / (m1 * m1)]);
    const daysRev = Array.from({ length: 11 }, (_, d) => s.sum("global", "revenueMinor", (d + 3) * 24, (d + 4) * 24));
    const daysOrd = Array.from({ length: 11 }, (_, d) => s.sum("global", "orders", (d + 3) * 24, (d + 4) * 24));
    const mr = daysRev.reduce((a, b) => a + b, 0) / 11; const vr = daysRev.reduce((a, b) => a + (b - mr) ** 2, 0) / 10;
    const mo = daysOrd.reduce((a, b) => a + b, 0) / 11;
    acc.set("revenueVarOverPoissonMean", [...(acc.get("revenueVarOverPoissonMean") ?? []), vr / (mo * (mr / mo) ** 2)]);
  }
  for (const [k, v] of acc) appendFileSync(OUT, `${k}: median=${[...v].sort((a, b) => a - b)[Math.floor(v.length / 2)].toFixed(2)} max=${Math.max(...v).toFixed(2)} n=${v.length}\n`);
});
