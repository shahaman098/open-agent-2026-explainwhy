import "server-only";

import type { Db } from "mongodb";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { describeDbError, getDb } from "@/lib/mongodb";
import { NIKE_REFERENCE_CATALOGUE } from "@/reference/nike-catalogue";
import { NIKE_Q1_FY27_RESULTS } from "@/reference/nike-financials";
import { ReferenceFinancials, ReferenceProduct, type ReferenceFinancialsT, type ReferenceProductT } from "@/reference/schemas";

export interface ReferenceCatalogueResult {
  products: ReferenceProductT[];
  /** "mongodb" when read from the persisted collection, "cache" when the bundled fallback was used. */
  servedFrom: "mongodb" | "cache";
}

/** Upserts the cached public catalogue and financials into MongoDB. Idempotent. */
export async function seedReferenceData(dbOverride?: Db): Promise<{ products: number; financials: number }> {
  const db = dbOverride ?? (await getDb());
  await ensureIndexes(db);
  const products = db.collection(COLLECTIONS.referenceProducts);
  await products.bulkWrite(
    NIKE_REFERENCE_CATALOGUE.map((p) => ({
      updateOne: { filter: { referenceProductId: p.referenceProductId }, update: { $set: p }, upsert: true },
    })),
    { ordered: false },
  );
  await db.collection(COLLECTIONS.referenceFinancials).updateOne(
    { referenceId: NIKE_Q1_FY27_RESULTS.referenceId },
    { $set: NIKE_Q1_FY27_RESULTS },
    { upsert: true },
  );
  return { products: NIKE_REFERENCE_CATALOGUE.length, financials: 1 };
}

/**
 * Returns the public reference catalogue. Prefers MongoDB; falls back to the
 * bundled verified cache when the database is empty or unreachable so the
 * simulator can always run.
 */
export async function getReferenceCatalogue(dbOverride?: Db): Promise<ReferenceCatalogueResult> {
  try {
    const db = dbOverride ?? (await getDb());
    const docs = await db.collection(COLLECTIONS.referenceProducts).find({}, { projection: { _id: 0 } }).toArray();
    const parsed = docs.map((d) => ReferenceProduct.safeParse(d)).filter((r) => r.success).map((r) => r.data);
    if (parsed.length > 0) return { products: parsed, servedFrom: "mongodb" };
  } catch (error) {
    console.warn("[reference] falling back to cached catalogue:", describeDbError(error));
  }
  return { products: [...NIKE_REFERENCE_CATALOGUE], servedFrom: "cache" };
}

export async function getReferenceFinancials(dbOverride?: Db): Promise<{ records: ReferenceFinancialsT[]; servedFrom: "mongodb" | "cache" }> {
  try {
    const db = dbOverride ?? (await getDb());
    const docs = await db.collection(COLLECTIONS.referenceFinancials).find({}, { projection: { _id: 0 } }).toArray();
    const parsed = docs.map((d) => ReferenceFinancials.safeParse(d)).filter((r) => r.success).map((r) => r.data);
    if (parsed.length > 0) return { records: parsed, servedFrom: "mongodb" };
  } catch (error) {
    console.warn("[reference] falling back to cached financials:", describeDbError(error));
  }
  return { records: [NIKE_Q1_FY27_RESULTS], servedFrom: "cache" };
}
