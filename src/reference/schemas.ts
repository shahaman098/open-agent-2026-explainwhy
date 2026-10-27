import { z } from "zod";

/**
 * Supplementary (non-canonical) schemas for public reference observations.
 * These are NOT part of @normal/contracts; they describe provenance-tagged
 * records about publicly observable Nike information.
 */
export const DataOrigin = z.enum(["official_public", "third_party_public", "synthetic"]);
export type DataOriginT = z.infer<typeof DataOrigin>;

export const ReferenceProductCategory = z.enum([
  "running", "basketball", "lifestyle", "football", "apparel",
]);
export type ReferenceProductCategoryT = z.infer<typeof ReferenceProductCategory>;

export const ReferenceProduct = z.object({
  referenceProductId: z.string().min(1),
  name: z.string().min(1),
  subtitle: z.string().min(1),
  category: ReferenceProductCategory,
  /** Publicly observed list price in minor units (e.g. 12999 = £129.99). */
  observedPriceMinor: z.number().int().positive(),
  currency: z.literal("GBP"),
  styleCode: z.string().min(1).optional(),
  sourceUrl: z.string().url(),
  sourceSite: z.literal("nike.com/gb"),
  dataOrigin: DataOrigin,
  retrievedAt: z.string().datetime({ offset: true }),
  retrievalMethod: z.string().min(1),
  description: z.string().optional(),
  /** Public image URL recorded for provenance only; the demo UI does not hotlink it. */
  imageUrl: z.string().url().optional(),
  verification: z.enum(["verified_verbatim", "unverified"]),
}).strict().superRefine((p, ctx) => {
  if (p.dataOrigin === "official_public" && p.verification !== "verified_verbatim") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "official_public records must be verified_verbatim" });
  }
});
export type ReferenceProductT = z.infer<typeof ReferenceProduct>;

export const ReferenceFinancialFigure = z.object({
  label: z.string().min(1),
  /** USD millions as published. */
  valueUsdMillions: z.number(),
  priorYearUsdMillions: z.number().optional(),
  reportedChangePercent: z.number().optional(),
  currencyNeutralChangePercent: z.number().optional(),
}).strict();

export const ReferenceFinancials = z.object({
  referenceId: z.string().min(1),
  company: z.literal("NIKE, Inc."),
  fiscalPeriod: z.string().min(1),
  periodEndedOn: z.string().min(1),
  releasedOn: z.string().min(1),
  currency: z.literal("USD"),
  figures: z.array(ReferenceFinancialFigure).min(1),
  grossMarginPercent: z.number().optional(),
  dilutedEpsUsd: z.number().optional(),
  sourceUrl: z.string().url(),
  dataOrigin: z.literal("official_public"),
  retrievedAt: z.string().datetime({ offset: true }),
  /** Explicit, machine-readable statement that this is NOT simulator revenue. */
  relationshipToSimulator: z.literal("context_only_not_simulated_revenue"),
}).strict();
export type ReferenceFinancialsT = z.infer<typeof ReferenceFinancials>;
