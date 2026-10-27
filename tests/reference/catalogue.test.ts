import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { NIKE_REFERENCE_CATALOGUE } from "@/reference/nike-catalogue";
import { NIKE_Q1_FY27_RESULTS } from "@/reference/nike-financials";
import { ReferenceFinancials, ReferenceProduct } from "@/reference/schemas";
import { getReferenceCatalogue, getReferenceFinancials, seedReferenceData } from "@/reference/service";
import { OPERATIONAL_ASSUMPTIONS, buildSimulatedProducts } from "@/simulator/catalogue";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";

describe("Nike public reference catalogue (Milestone 1)", () => {
  it("contains 10-20 products that each validate and cite a nike.com/gb source", () => {
    expect(NIKE_REFERENCE_CATALOGUE.length).toBeGreaterThanOrEqual(10);
    expect(NIKE_REFERENCE_CATALOGUE.length).toBeLessThanOrEqual(20);
    for (const p of NIKE_REFERENCE_CATALOGUE) {
      expect(ReferenceProduct.safeParse(p).success).toBe(true);
      expect(p.sourceUrl.startsWith("https://www.nike.com/gb/")).toBe(true);
      expect(p.dataOrigin).toBe("official_public");
      expect(p.verification).toBe("verified_verbatim");
      expect(Number.isInteger(p.observedPriceMinor) && p.observedPriceMinor > 0).toBe(true);
      expect(p.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("covers every required category and has unique IDs and style codes", () => {
    const categories = new Set(NIKE_REFERENCE_CATALOGUE.map((p) => p.category));
    expect([...categories].sort()).toEqual(["apparel", "basketball", "football", "lifestyle", "running"]);
    const ids = NIKE_REFERENCE_CATALOGUE.map((p) => p.referenceProductId);
    expect(new Set(ids).size).toBe(ids.length);
    const codes = NIKE_REFERENCE_CATALOGUE.map((p) => p.styleCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("refuses to label an unverified price as official", () => {
    const base = { ...NIKE_REFERENCE_CATALOGUE[0], verification: "unverified" as const };
    expect(ReferenceProduct.safeParse(base).success).toBe(false);
    expect(ReferenceProduct.safeParse({ ...base, dataOrigin: "synthetic" }).success).toBe(true);
  });

  it("stores Nike's reported financials separately, in USD, flagged as context only", () => {
    expect(ReferenceFinancials.safeParse(NIKE_Q1_FY27_RESULTS).success).toBe(true);
    expect(NIKE_Q1_FY27_RESULTS.currency).toBe("USD");
    expect(NIKE_Q1_FY27_RESULTS.relationshipToSimulator).toBe("context_only_not_simulated_revenue");
    expect(NIKE_Q1_FY27_RESULTS.sourceUrl).toContain("investors.nike.com");
  });
});

describe("synthetic operational configuration", () => {
  it("every operational assumption resolves to a verified catalogue product", () => {
    const refs = new Set(NIKE_REFERENCE_CATALOGUE.map((p) => p.referenceProductId));
    for (const a of OPERATIONAL_ASSUMPTIONS) expect(refs.has(a.referenceProductId), a.productId).toBe(true);
    const ids = OPERATIONAL_ASSUMPTIONS.map((a) => a.productId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("builds simulated products with public list prices and synthetic costs below price", () => {
    const products = buildSimulatedProducts("nike_demo", "run_test", NIKE_REFERENCE_CATALOGUE, "2026-10-01T00:00:00.000Z");
    expect(products).toHaveLength(OPERATIONAL_ASSUMPTIONS.length);
    for (const p of products) {
      expect(p.priceOrigin).toBe("official_public_list_price");
      expect(p.dataOrigin).toBe("synthetic");
      expect(p.costMinor).toBeGreaterThan(0);
      expect(p.costMinor).toBeLessThan(p.priceMinor);
      expect(p.availableUnits).toBeGreaterThan(0);
    }
  });

  it("marks the price synthetic when the catalogue record is not a verified public one", () => {
    const synthetic = NIKE_REFERENCE_CATALOGUE.map((p) => ({ ...p, dataOrigin: "synthetic" as const, verification: "unverified" as const }));
    const products = buildSimulatedProducts("nike_demo", "run_test", synthetic, "2026-10-01T00:00:00.000Z");
    expect(products.every((p) => p.priceOrigin === "synthetic")).toBe(true);
  });

  it("throws when a required reference is missing instead of fabricating one", () => {
    expect(() => buildSimulatedProducts("nike_demo", "run_test", NIKE_REFERENCE_CATALOGUE.slice(1), "2026-10-01T00:00:00.000Z")).toThrow(/unknown catalogue product/);
  });
});

describe("reference persistence and fallback", () => {
  it("seeds MongoDB idempotently and reads back from the collection", async () => {
    const first = await seedReferenceData();
    const second = await seedReferenceData();
    expect(first).toEqual(second);
    const db = await getDb();
    expect(await db.collection(COLLECTIONS.referenceProducts).countDocuments()).toBe(NIKE_REFERENCE_CATALOGUE.length);
    const result = await getReferenceCatalogue();
    expect(result.servedFrom).toBe("mongodb");
    expect(result.products.map((p) => p.referenceProductId).sort()).toEqual(NIKE_REFERENCE_CATALOGUE.map((p) => p.referenceProductId).sort());
    const fin = await getReferenceFinancials();
    expect(fin.servedFrom).toBe("mongodb");
    expect(fin.records[0]?.referenceId).toBe(NIKE_Q1_FY27_RESULTS.referenceId);
  });

  it("falls back to the bundled cache when the collection is empty", async () => {
    const empty = await getDb("normal_test_empty_reference");
    await empty.collection(COLLECTIONS.referenceProducts).deleteMany({});
    const result = await getReferenceCatalogue(empty);
    expect(result.servedFrom).toBe("cache");
    expect(result.products).toHaveLength(NIKE_REFERENCE_CATALOGUE.length);
  });

  it("falls back to the bundled cache when the database is unreachable", async () => {
    const broken = { collection: () => { throw new Error("connection refused"); } } as unknown as Db;
    const result = await getReferenceCatalogue(broken);
    expect(result.servedFrom).toBe("cache");
    const fin = await getReferenceFinancials(broken);
    expect(fin.servedFrom).toBe("cache");
  });
});
