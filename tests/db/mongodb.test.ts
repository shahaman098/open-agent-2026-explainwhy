import { describe, expect, it } from "vitest";
import { getDb, getDbName } from "@/lib/mongodb";
import { POST as dbTestRoute } from "@/app/api/dev/db-test/route";

describe("MongoDB foundation (existing getDb) stays functional", () => {
  it("round-trips a document through the connection_tests collection", async () => {
    const db = await getDb();
    expect(db.databaseName).toBe(getDbName());
    const col = db.collection<{ source: string; createdAt: Date }>("connection_tests");
    const { insertedId } = await col.insertOne({ source: "vitest/mongodb.test", createdAt: new Date() });
    const stored = await col.findOne({ _id: insertedId });
    expect(stored?.source).toBe("vitest/mongodb.test");
    await col.deleteOne({ _id: insertedId });
  });

  it("dev-only db-test route is hidden when NODE_ENV is not development", async () => {
    expect(process.env.NODE_ENV).not.toBe("development");
    const res = await dbTestRoute();
    expect(res.status).toBe(404);
  });
});
