import { z } from "zod";
import { getReferenceCatalogue, getReferenceFinancials } from "@/reference/service";
import { MAX_ENTITY_IDS, ToolInputBase, type EvidenceDraft, type EvidenceTool } from "../types";
import { cap, labelFor } from "./_shared";

export const PublicContextInput = ToolInputBase.extend({
  productIds: z.array(z.string().min(1).max(64)).max(MAX_ENTITY_IDS).default([]),
  includeFinancials: z.boolean().default(true),
}).strict();
export type PublicContextInputT = z.infer<typeof PublicContextInput>;

export const REFERENCE_PRODUCTS = "reference_products";
export const REFERENCE_FINANCIALS = "reference_financials";

export const publicReferenceContext: EvidenceTool<PublicContextInputT> = {
  name: "public_reference_context",
  title: "Public Nike reference context",
  description: "Verified public Nike records already stored by Normal: product names and list prices observed on nike.com/gb and published NIKE, Inc. quarterly figures, each with source URL and observation date. Context only; never an explanation of a simulated hourly anomaly.",
  category: "sales",
  dataSources: [
    { collection: REFERENCE_PRODUCTS, externalSource: "nike.com/gb (retrieved once, dated)", description: "verified public product references", origin: "public_reference" },
    { collection: REFERENCE_FINANCIALS, externalSource: "investors.nike.com", description: "published quarterly results, USD millions", origin: "public_reference" },
  ],
  input: PublicContextInput,
  async run(ctx, input) {
    const warnings: string[] = [
      "Public references are dated observations of real-world records; they describe the real company, not the simulated business, and cannot explain a simulated hourly anomaly.",
    ];
    const [catalogue, financials] = await Promise.all([getReferenceCatalogue(ctx.db), input.includeFinancials ? getReferenceFinancials(ctx.db) : Promise.resolve({ records: [], servedFrom: "cache" as const })]);
    const wanted = input.productIds.length ? input.productIds : [...ctx.catalogue.keys()];
    const byName = new Map(catalogue.products.map((p) => [p.name, p]));
    const matched = wanted.map((productId) => ({ productId, label: labelFor(ctx, productId), ref: byName.get(labelFor(ctx, productId).name) ?? null }));
    const found = matched.filter((m) => m.ref !== null);
    const missing = matched.filter((m) => m.ref === null).map((m) => m.productId);
    if (missing.length) warnings.push(`No verified public reference for ${missing.length} product(s): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`);
    if (catalogue.servedFrom === "cache") warnings.push("Reference catalogue served from the bundled verified cache, not MongoDB");
    const evidence: EvidenceDraft[] = [];
    if (found.length) {
      evidence.push({
        key: "public:products", category: "sales", title: "Verified public product references", window: undefined,
        observation: `${found.length} simulated product(s) map to verified nike.com/gb references with public list prices (observed ${found[0]!.ref!.retrievedAt.slice(0, 10)}). Simulated selling prices copy the public list price only where the reference is verified; stock, sales and reviews are synthetic.`,
        measurements: found.slice(0, 50).map((m) => ({ metric: `public_list_price_minor:${m.productId}`, value: m.ref!.observedPriceMinor, unit: "GBP minor units" })),
        sourceRecords: found.slice(0, 50).map((m) => ({ collection: REFERENCE_PRODUCTS, recordId: m.ref!.referenceProductId, sourceUrl: m.ref!.sourceUrl })),
        detail: { products: cap(found.map((m) => ({ productId: m.productId, name: m.label.name, category: m.label.category, referenceProductId: m.ref!.referenceProductId, observedPriceMinor: m.ref!.observedPriceMinor,
          styleCode: m.ref!.styleCode ?? null, sourceUrl: m.ref!.sourceUrl, retrievedAt: m.ref!.retrievedAt, retrievalMethod: m.ref!.retrievalMethod, verification: m.ref!.verification, dataOrigin: m.ref!.dataOrigin })), input.limit),
          servedFrom: catalogue.servedFrom, unmatchedProductIds: missing },
        warnings: warnings.filter((w) => !w.includes("quarterly")), dataOrigin: "public_reference",
      });
    }
    for (const f of financials.records.slice(0, 5)) {
      evidence.push({
        key: `public:financials:${f.referenceId}`, category: "sales", title: `Published ${f.company} results — ${f.fiscalPeriod}`, window: undefined,
        observation: `${f.company} ${f.fiscalPeriod} (period ended ${f.periodEndedOn}, released ${f.releasedOn}): ${f.figures.slice(0, 3).map((x) => `${x.label} US$${x.valueUsdMillions}m${x.reportedChangePercent !== undefined ? ` (${x.reportedChangePercent > 0 ? "+" : ""}${x.reportedChangePercent}%)` : ""}`).join("; ")}. Relationship to the simulator: ${f.relationshipToSimulator}. This is macro context about the real company and does not explain simulated hourly metrics.`,
        measurements: f.figures.slice(0, 20).map((x) => ({ metric: `public_${x.label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_usd_millions`, value: x.valueUsdMillions, unit: "USD millions (published)", ...(x.priorYearUsdMillions !== undefined ? { baseline: x.priorYearUsdMillions } : {}) })),
        sourceRecords: [{ collection: REFERENCE_FINANCIALS, recordId: f.referenceId, sourceUrl: f.sourceUrl }],
        detail: { fiscalPeriod: f.fiscalPeriod, periodEndedOn: f.periodEndedOn, releasedOn: f.releasedOn, currency: f.currency, figures: f.figures, grossMarginPercent: f.grossMarginPercent ?? null, dilutedEpsUsd: f.dilutedEpsUsd ?? null,
          retrievedAt: f.retrievedAt, relationshipToSimulator: f.relationshipToSimulator, servedFrom: financials.servedFrom },
        warnings: [warnings[0]!], dataOrigin: "public_reference",
      });
    }
    if (!evidence.length) return { evidence: [], resultCount: 0, warnings, emptyResult: "No verified public references matched" };
    return { evidence, resultCount: found.length + financials.records.length, warnings };
  },
};
