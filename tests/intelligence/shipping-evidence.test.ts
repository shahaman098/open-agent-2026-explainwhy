import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { getDb } from "@/lib/mongodb";
import { COLLECTIONS } from "@/lib/collections";
import { shippingAnalysis } from "@/intelligence/evidence/tools/shipping";

it("shipping backlog respects the cutoff, deduplicates orders and counts beyond its bounded sample", async () => {
  const db = await getDb();
  const scope = { businessId: "nike_test", simulationRunId: `t_shipping_evidence_${randomUUID().replaceAll("-", "")}` };
  const t = (h: number) => new Date(Date.parse("2026-10-01T00:00:00Z") + h * 3_600_000).toISOString();
  const rows = [
    ["one", "shipped", 1], ["one", "shipped", 2], ["one", "delivered", 30],
    ["two", "shipped", 1], ["done", "shipped", 1], ["done", "delivered", 10],
    ["future", "shipped", 30],
  ] as const;
  try {
    await db.collection(COLLECTIONS.businessEvents).insertMany(rows.map(([orderId, status, hour], i) => ({
      ...scope, eventId: `${scope.simulationRunId}_${i}`, type: "delivery.status_changed", occurredAt: t(hour),
      provenance: { connectorId: scope.simulationRunId, sourceRecordId: String(i) },
      payload: { orderId, status, promisedAt: t(5) },
    })));
    const result = await shippingAnalysis.run({ db, ...scope, investigationId: "inv_shipping_test", cutoff: t(24), catalogue: new Map() },
      { ...scope, window: { startAt: t(0), endAt: t(24) }, limit: 1 });
    expect(result.evidence).toHaveLength(1);
    const evidence = result.evidence[0]!;
    expect(evidence.measurements.find((m) => m.metric === "open_backlog_past_promise")?.value).toBe(2);
    expect(evidence.detail.backlogPastPromise).toHaveLength(1);
    expect(evidence.observation).toContain("2 shipped order(s)");
  } finally { await db.collection(COLLECTIONS.businessEvents).deleteMany(scope); }
});
