import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IngestResult } from "@normal/contracts";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { ingestBatch } from "@/ingestion/service";

const RUN = "t_ingest";
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "packages/contracts/examples/order-event.json"), "utf8"));
const base = { ...fixture, businessId: "nike_test", simulationRunId: RUN };
const withIds = (n: number, extra: Record<string, unknown> = {}) => ({
  ...base, eventId: `evt_ing_${n}`, provenance: { ...base.provenance, sourceRecordId: `ing-${n}` }, ...extra,
});

describe("canonical ingestion service", () => {
  const cleanup = async () => { const db = await getDb(); await db.collection(COLLECTIONS.businessEvents).deleteMany({ businessId: "nike_test", simulationRunId: RUN }); };
  beforeAll(cleanup);
  afterAll(cleanup);

  it("accepts valid events once and reports duplicates on replay", async () => {
    const batch = { schemaVersion: 1, events: [withIds(1), withIds(2)] };
    const first = await ingestBatch(batch, { businessId: "nike_test" });
    expect(IngestResult.safeParse(first.result).success).toBe(true);
    expect(first.result).toMatchObject({ accepted: 2, duplicates: 0, rejected: 0 });
    const second = await ingestBatch(batch, { businessId: "nike_test" });
    expect(second.result).toMatchObject({ accepted: 0, duplicates: 2, rejected: 0, eventIds: [] });
  });

  it("counts intra-batch duplicates and partial overlaps correctly", async () => {
    const res = await ingestBatch({ schemaVersion: 1, events: [withIds(2), withIds(3), withIds(3)] }, { businessId: "nike_test" });
    expect(res.result).toMatchObject({ accepted: 1, duplicates: 2, rejected: 0, eventIds: ["evt_ing_3"] });
  });

  it("rejects invalid events individually with safe messages while accepting the rest", async () => {
    const bad1 = { ...withIds(4), type: "session.started" };
    const bad2 = { ...withIds(5), payload: { ...base.payload, netRevenueMinor: 1 } };
    const bad3 = { ...withIds(6), extraField: true };
    const res = await ingestBatch({ schemaVersion: 1, events: [bad1, withIds(7), bad2, bad3] }, { businessId: "nike_test" });
    expect(res.result).toMatchObject({ accepted: 1, duplicates: 0, rejected: 3 });
    expect(res.rejections.map((r) => r.index).sort()).toEqual([0, 2, 3]);
    expect(res.rejections[1].reason).toContain("Net revenue");
  });

  it("enforces tenant scoping and rejects malformed envelopes", async () => {
    const res = await ingestBatch({ schemaVersion: 1, events: [withIds(8)] }, { businessId: "someone_else" });
    expect(res.result.rejected).toBe(1);
    expect(res.rejections[0].reason).toContain("outside the authorised scope");
    const bad = await ingestBatch({ schemaVersion: 2, events: [] });
    expect(bad.result.accepted).toBe(0);
    expect(bad.rejections[0].reason).toContain("invalid batch");
    const empty = await ingestBatch({ schemaVersion: 1, events: [] });
    expect(empty.rejections[0].reason).toContain("invalid batch");
  });

  it("concurrent inserts of the same event are safe: exactly one accepted", async () => {
    const batch = { schemaVersion: 1, events: [withIds(9)] };
    const results = await Promise.all([1, 2, 3, 4].map(() => ingestBatch(batch, { businessId: "nike_test" })));
    expect(results.reduce((a, r) => a + r.result.accepted, 0)).toBe(1);
    expect(results.reduce((a, r) => a + r.result.duplicates, 0)).toBe(3);
    const db = await getDb();
    expect(await db.collection(COLLECTIONS.businessEvents).countDocuments({ businessId: "nike_test", eventId: "evt_ing_9" })).toBe(1);
  });

  it("stored events are immutable canonical documents (no extra fields)", async () => {
    const db = await getDb();
    const doc = await db.collection(COLLECTIONS.businessEvents).findOne({ businessId: "nike_test", eventId: "evt_ing_1" }, { projection: { _id: 0 } });
    expect(Object.keys(doc ?? {}).sort()).toEqual(["businessId", "eventId", "occurredAt", "payload", "provenance", "receivedAt", "schemaVersion", "simulationRunId", "source", "type"]);
  });
});
