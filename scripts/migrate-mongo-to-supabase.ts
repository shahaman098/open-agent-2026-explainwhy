/**
 * One-off copy of a legacy MongoDB database into the Supabase Postgres store.
 * Re-runnable: documents whose _id (or unique key) already exists are skipped.
 *
 *   MONGODB_URI=mongodb://… npm run db:migrate-mongo -- --from explainwhy_dev [--to explainwhy_dev]
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { MongoClient } from "mongodb";
import { getDb, getDbName, getMongoClient } from "../src/lib/mongodb";
import { ensureIndexes } from "../src/lib/collections";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

/** BSON-only types become plain JSON values; ObjectIds keep their hex form. */
function plain(value: unknown): unknown {
  if (value === null || typeof value !== "object" || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(plain);
  const bson = (value as { _bsontype?: string })._bsontype;
  if (bson === "ObjectId") return (value as { toHexString(): string }).toHexString();
  if (bson === "Decimal128" || bson === "Long" || bson === "Int32" || bson === "Double") return Number(String(value));
  if (bson === "Binary") return Buffer.from((value as { buffer: Uint8Array }).buffer).toString("base64");
  if (bson === "Timestamp") return Number(String(value));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
}

async function main() {
  const { values } = parseArgs({ options: { from: { type: "string" }, to: { type: "string" }, batch: { type: "string", default: "1000" } } });
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Set MONGODB_URI to the MongoDB instance to copy from");
  const sourceName = values.from ?? getDbName();
  const target = await getDb(values.to ?? sourceName);
  await ensureIndexes(target);
  const source = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    const db = source.db(sourceName);
    const batchSize = Number(values.batch);
    for (const { name } of await db.listCollections({ type: "collection" }).toArray()) {
      const total = await db.collection(name).estimatedDocumentCount();
      let copied = 0, skipped = 0, batch: Record<string, unknown>[] = [];
      const flush = async () => {
        if (!batch.length) return;
        try {
          copied += (await target.collection(name).insertMany(batch, { ordered: false })).insertedCount;
        } catch (error) {
          const e = error as { writeErrors?: { code: number }[]; insertedCount?: number };
          if (!e.writeErrors?.every((w) => w.code === 11000)) throw error;
          copied += e.insertedCount ?? 0;
          skipped += e.writeErrors.length;
        }
        batch = [];
      };
      for await (const doc of db.collection(name).find().sort({ _id: 1 })) {
        batch.push(plain(doc) as Record<string, unknown>);
        if (batch.length >= batchSize) await flush();
      }
      await flush();
      console.log(`${name}: ${copied} copied, ${skipped} already present (source ${total})`);
    }
  } finally {
    await source.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exitCode = 1;
}).finally(async () => {
  if (globalThis._explainwhyMongoClientPromise) await (await getMongoClient()).close();
});
