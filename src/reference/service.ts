import "server-only";

// The Postgres document store preserves the MongoDB collection interface.
import type { Db } from "mongodb";
import { COLLECTIONS, ensureIndexes } from "@/lib/collections";
import { describeDbError, getDb } from "@/lib/mongodb";
import { NIKE_REFERENCE_CATALOGUE } from "@/reference/nike-catalogue";
import { NIKE_Q1_FY27_RESULTS } from "@/reference/nike-financials";
import { ReferenceFinancials, ReferenceProduct, type ReferenceFinancialsT, type ReferenceProductT } from "@/reference/schemas";
import { NVIDIA_DEMO_CATALOGUE, NVIDIA_Q2_FY27 } from "./nvidia";

export interface ReferenceCatalogueResult {
  products: ReferenceProductT[];
  /** "supabase" when read from the persisted collection, "cache" when the bundled fallback was used. */
  servedFrom: "supabase" | "cache";
}

/** Upserts the cached public catalogue and financials into the database. Idempotent. */
export async function seedReferenceData(dbOverride?: Db, businessId = "nike_demo"): Promise<{ products: number; financials: number }> {
  const db = dbOverride ?? (await getDb());
  await ensureIndexes(db);
  const products = db.collection(COLLECTIONS.referenceProducts);
  await products.bulkWrite(
    (businessId === "nvidia_demo" ? NVIDIA_DEMO_CATALOGUE : NIKE_REFERENCE_CATALOGUE).map((p) => ({
      updateOne: { filter: { referenceProductId: p.referenceProductId }, update: { $set: p }, upsert: true },
    })),
    { ordered: false },
  );
  const financials = businessId === "nvidia_demo" ? NVIDIA_Q2_FY27 : NIKE_Q1_FY27_RESULTS;
  await db.collection(COLLECTIONS.referenceFinancials).updateOne(
    { referenceId: financials.referenceId },
    { $set: financials },
    { upsert: true },
  );
  return { products: businessId === "nvidia_demo" ? NVIDIA_DEMO_CATALOGUE.length : NIKE_REFERENCE_CATALOGUE.length, financials: 1 };
}

/**
 * Returns the public reference catalogue. Prefers the database; falls back to the
 * bundled verified cache when the database is empty or unreachable so the
 * simulator can always run.
 */
export async function getReferenceCatalogue(dbOverride?: Db, businessId = "nike_demo"): Promise<ReferenceCatalogueResult> {
  try {
    const db = dbOverride ?? (await getDb());
    const docs = await db.collection(COLLECTIONS.referenceProducts).find({ sourceSite: businessId === "nvidia_demo" ? "nvidia.com" : "nike.com/gb" }, { projection: { _id: 0 } }).toArray();
    const parsed = docs.map((d) => ReferenceProduct.safeParse(d)).filter((r) => r.success).map((r) => r.data);
    if (parsed.length > 0) return { products: parsed, servedFrom: "supabase" };
  } catch (error) {
    console.warn("[reference] falling back to cached catalogue:", describeDbError(error));
  }
  return { products: [...(businessId === "nvidia_demo" ? NVIDIA_DEMO_CATALOGUE : NIKE_REFERENCE_CATALOGUE)], servedFrom: "cache" };
}

export async function getReferenceFinancials(dbOverride?: Db, businessId = "nike_demo"): Promise<{ records: ReferenceFinancialsT[]; servedFrom: "supabase" | "cache" }> {
  try {
    const db = dbOverride ?? (await getDb());
    const docs = await db.collection(COLLECTIONS.referenceFinancials).find({ company: businessId === "nvidia_demo" ? "NVIDIA Corporation" : "NIKE, Inc." }, { projection: { _id: 0 } }).toArray();
    const parsed = docs.map((d) => ReferenceFinancials.safeParse(d)).filter((r) => r.success).map((r) => r.data);
    if (parsed.length > 0) return { records: parsed, servedFrom: "supabase" };
  } catch (error) {
    console.warn("[reference] falling back to cached financials:", describeDbError(error));
  }
  return { records: [businessId === "nvidia_demo" ? NVIDIA_Q2_FY27 : NIKE_Q1_FY27_RESULTS], servedFrom: "cache" };
}
