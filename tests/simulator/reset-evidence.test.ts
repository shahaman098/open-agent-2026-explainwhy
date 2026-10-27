import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { deleteRun } from "@/simulator/persistence";

it("run cleanup removes Stage 4 evidence and traces only in the requested business and run", async () => {
  const db = await getDb();
  const run = `t_evidence_cleanup_${randomUUID().replaceAll("-", "")}`;
  const scopes = [
    { businessId: "nike_test", simulationRunId: run },
    { businessId: "nike_test", simulationRunId: `${run}_other` },
    { businessId: "nike_test_other", simulationRunId: run },
  ];
  const collections = [COLLECTIONS.evidence, COLLECTIONS.evidenceDetails, COLLECTIONS.evidenceCollections, COLLECTIONS.evidenceToolRuns];
  try {
    for (const name of collections) {
      await db.collection(name).insertMany(scopes.map((scope, i) => ({
        ...scope, evidenceId: `${run}_${i}`, collectionId: `${run}_${i}`, toolRunId: `${run}_${i}`,
      })));
    }
    await deleteRun(db, scopes[0]!.businessId, run);
    for (const name of collections) {
      expect(await db.collection(name).countDocuments(scopes[0]!)).toBe(0);
      expect(await db.collection(name).countDocuments(scopes[1]!)).toBe(1);
      expect(await db.collection(name).countDocuments(scopes[2]!)).toBe(1);
    }
  } finally {
    for (const name of collections) await db.collection(name).deleteMany({ $or: scopes });
  }
});
