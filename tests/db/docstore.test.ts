import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocClient, type DocDb, poolConfigFromUrl } from "@/lib/docstore/client";

describe("Postgres document store regression", () => {
  const schema = `docstore_test_${randomUUID().replaceAll("-", "")}`;
  let client: DocClient;
  let db: DocDb;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for database tests");
    client = new DocClient(poolConfigFromUrl(process.env.DATABASE_URL));
    await client.connect();
    db = client.db(schema);
  });
  afterAll(async () => {
    try { await db?.dropDatabase(); } finally { await client?.close(); }
  });

  it("upserts an explicit ID idempotently, including immutable memory snapshots", async () => {
    const col = db.collection("memories");
    const memory = { _id: "report_1", source: "investigation_1", createdAt: new Date("2026-10-01T00:00:00Z") };
    expect((await col.updateOne({ _id: memory._id }, { $setOnInsert: memory }, { upsert: true })).upsertedCount).toBe(1);
    expect((await col.updateOne({ _id: memory._id }, { $setOnInsert: memory }, { upsert: true })).upsertedCount).toBe(0);
    expect(await col.findOne({ _id: memory._id })).toEqual(memory);
    expect(await col.countDocuments()).toBe(1);
    await col.updateOne({ _id: memory._id }, { $set: { ...memory, source: "updated" } });
    expect((await col.findOne({ _id: memory._id }))?.source).toBe("updated");
    await expect(col.updateOne({ _id: memory._id }, { $set: { _id: "different" } })).rejects.toThrow("immutable");
    expect(await col.findOne({ _id: "different" })).toBeNull();
  });

  it("publishes linked records atomically and rolls both back on failure", async () => {
    const reports = db.collection("reports"), memories = db.collection("transaction_memories");
    // Create relations before opening the publication transaction.
    await reports.ready(); await memories.ready();
    const session = client.startSession();
    try {
      await expect(session.withTransaction(async () => {
        await reports.insertOne({ _id: "rolled_back" }, { session });
        await memories.updateOne({ _id: "rolled_back" }, { $setOnInsert: { reportId: "rolled_back" } }, { upsert: true, session });
        throw new Error("publication interrupted");
      })).rejects.toThrow("publication interrupted");
      expect(await reports.countDocuments()).toBe(0);
      expect(await memories.countDocuments()).toBe(0);
      await session.withTransaction(async () => {
        await reports.insertOne({ _id: "published" }, { session });
        await memories.updateOne({ _id: "published" }, { $setOnInsert: { reportId: "published" } }, { upsert: true, session });
      });
      expect(await reports.countDocuments()).toBe(1);
      expect(await memories.countDocuments()).toBe(1);
    } finally { await session.endSession(); }
  });

  it("enforces scoped unique indexes under concurrent starts", async () => {
    const col = db.collection("jobs");
    await col.createIndex({ businessId: 1, run: 1 }, { unique: true });
    const starts = await Promise.allSettled([1, 2, 3].map((i) => col.insertOne({ businessId: "demo", run: "one", attempt: i })));
    expect(starts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const result of starts) if (result.status === "rejected") expect(result.reason.code).toBe(11000);
    expect(await col.countDocuments()).toBe(1);
  });

  it("replays an insert after deletion without dropping later events", async () => {
    const col = db.collection("windows");
    const stream = col.watch([{ $match: { operationType: "insert" } }], { maxAwaitTimeMS: 1 });
    let token;
    try {
      expect(await stream.tryNext()).toBeNull();
      await col.insertOne({ _id: "anchor", value: 1 });
      const anchor = await stream.tryNext();
      expect(anchor?.fullDocument._id).toBe("anchor");
      token = anchor?._id;
    } finally { await stream.close(); }
    expect(token).toBeTruthy();
    await col.insertOne({ _id: "deleted", value: 2 });
    await col.deleteOne({ _id: "deleted" });
    await col.insertOne({ _id: "later", value: 3 });
    const resumed = col.watch([], { resumeAfter: token, maxAwaitTimeMS: 1 });
    try {
      expect((await resumed.tryNext())?.fullDocument._id).toBe("deleted");
      expect((await resumed.tryNext())?.fullDocument._id).toBe("later");
      expect(await resumed.tryNext()).toBeNull();
      expect((await db.listCollections().toArray()).some((c) => c.name.startsWith("_docstore"))).toBe(false);
    } finally { await resumed.close(); }
  });
});
