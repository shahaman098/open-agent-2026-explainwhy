import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { COLLECTIONS } from "@/lib/collections";
import { NVIDIA_DEMO_CATALOGUE, NVIDIA_Q2_FY27, NVIDIA_REVENUE_HISTORY } from "@/reference/nvidia";
import { NIKE_REFERENCE_CATALOGUE } from "@/reference/nike-catalogue";
import { NIKE_Q1_FY27_RESULTS } from "@/reference/nike-financials";
import { getReferenceCatalogue, getReferenceFinancials } from "@/reference/service";
import { ReferenceFinancials, ReferenceProduct } from "@/reference/schemas";
import { createInitialWorld } from "@/simulator/bootstrap";
import { TickEngine } from "@/simulator/engine";
import { publicReferenceContext, PublicContextInput } from "@/intelligence/evidence/tools/public-context";
import { displayValue } from "@/lib/presentation/render";

// Both brands coexist in the same reference store. Queries must select one.
const mixedStore = { collection: (name: string) => ({ find: (query: Record<string, unknown>) => ({ toArray: async () => {
  const rows = name === COLLECTIONS.referenceProducts ? [...NIKE_REFERENCE_CATALOGUE, ...NVIDIA_DEMO_CATALOGUE] : [NIKE_Q1_FY27_RESULTS, NVIDIA_Q2_FY27];
  return rows.filter(row => Object.entries(query).every(([key, value]) => (row as Record<string, unknown>)[key] === value));
} }) }) } as unknown as Db;
const scope = { businessId: "nvidia_demo", simulationRunId: "nvidia_test" };
const boot = () => createInitialWorld({ ...scope, seed: 61, catalogue: NVIDIA_DEMO_CATALOGUE, createdAt: "2026-10-27T00:00:00.000Z" });

describe("NVIDIA workspace provenance and isolation", () => {
  it("keeps official USD financials separate from invented GBP product prices", () => {
    expect(ReferenceFinancials.safeParse(NVIDIA_Q2_FY27).success).toBe(true);
    expect(NVIDIA_Q2_FY27).toMatchObject({ company: "NVIDIA Corporation", currency: "USD", relationshipToSimulator: "context_only_not_simulated_revenue" });
    expect(NVIDIA_REVENUE_HISTORY.map(item => item.revenueUsdMillions)).toEqual([46743, 57006, 68127, 81615, 96221]);
    for (const product of NVIDIA_DEMO_CATALOGUE) {
      expect(ReferenceProduct.safeParse(product).success).toBe(true);
      expect(product).toMatchObject({ currency: "GBP", dataOrigin: "synthetic", verification: "unverified" });
    }
    expect(displayValue(96.221, "USD billions")).toBe("$96.22B");
  });
  it("reads the selected company when both brands are persisted together", async () => {
    const nv = await getReferenceCatalogue(mixedStore, "nvidia_demo"), nike = await getReferenceCatalogue(mixedStore);
    expect(nv.products).toEqual(NVIDIA_DEMO_CATALOGUE);
    expect(nike.products).toEqual(NIKE_REFERENCE_CATALOGUE);
    expect((await getReferenceFinancials(mixedStore, "nvidia_demo")).records).toEqual([NVIDIA_Q2_FY27]);
    expect((await getReferenceFinancials(mixedStore)).records).toEqual([NIKE_Q1_FY27_RESULTS]);
  });
  it("never promotes synthetic GPU prices into verified public evidence", async () => {
    const { world } = boot();
    const result = await publicReferenceContext.run({ db: mixedStore, ...scope, investigationId: "test", cutoff: "2026-10-05T00:00:00.000Z", catalogue: new Map([...world.products].map(([id, p]) => [id, { name: p.name, category: p.category }])) }, PublicContextInput.parse({ ...scope, window: { startAt: "2026-10-01T00:00:00.000Z", endAt: "2026-10-02T00:00:00.000Z" } }));
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].sourceRecords[0].recordId).toBe(NVIDIA_Q2_FY27.referenceId);
    expect(result.evidence[0].measurements.every(item => item.unit === "USD millions (published)")).toBe(true);
    expect(result.warnings.some(item => item.includes("No verified public reference for 7 product"))).toBe(true);
  });
  it("produces reproducible GPU orders with campaign targets in the NVIDIA catalogue", () => {
    const a = boot(), b = boot();
    for (const campaign of a.world.campaigns.values()) for (const productId of campaign.targetProductIds) expect(a.world.products.has(productId)).toBe(true);
    const events = [], orders = [];
    for (let hour = 0; hour < 48; hour++) {
      const first = new TickEngine(a.world, a.rng, "2026-10-27T00:00:00.000Z").run();
      const second = new TickEngine(b.world, b.rng, "2026-10-27T00:00:00.000Z").run();
      expect(first.events).toEqual(second.events);
      events.push(...first.events); orders.push(...first.orders);
    }
    expect(events.length).toBeGreaterThan(500); expect(orders.length).toBeGreaterThan(10);
    for (const order of orders) for (const line of order.lines) {
      expect(line.productId.startsWith("nv_")).toBe(true);
      expect(line.unitPriceMinor).toBe(a.world.products.get(line.productId)?.priceMinor);
    }
    expect([...a.world.products.values()].every(item => item.priceOrigin === "synthetic")).toBe(true);
  });
});
