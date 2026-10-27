import type { ReferenceProductT } from "@/reference/schemas";
import type { SimulatedProduct } from "@/types/domain";

/**
 * Synthetic operational assumptions layered on top of the public catalogue.
 * Nothing here is a Nike figure: unit costs, stock levels, popularity weights
 * and quality scores are invented for the simulation and labelled as such.
 */
export interface OperationalAssumption {
  productId: string;
  referenceProductId: string;
  costRatio: number;
  initialStock: number;
  popularity: number;
  qualityScore: number;
}

export const OPERATIONAL_ASSUMPTIONS: readonly OperationalAssumption[] = [
  { productId: "nk_pegasus_42", referenceProductId: "ref_nike_pegasus_42", costRatio: 0.42, initialStock: 180, popularity: 0.90, qualityScore: 0.88 },
  { productId: "nk_vomero_18", referenceProductId: "ref_nike_vomero_18", costRatio: 0.42, initialStock: 140, popularity: 0.70, qualityScore: 0.87 },
  { productId: "nk_pegasus_plus_2", referenceProductId: "ref_nike_pegasus_plus_2", costRatio: 0.40, initialStock: 90, popularity: 0.50, qualityScore: 0.86 },
  { productId: "nk_quest_7", referenceProductId: "ref_nike_quest_7", costRatio: 0.45, initialStock: 220, popularity: 0.65, qualityScore: 0.80 },
  { productId: "nk_ja_4_nightmare", referenceProductId: "ref_nike_ja_4_nightmare", costRatio: 0.42, initialStock: 120, popularity: 0.60, qualityScore: 0.85 },
  { productId: "nk_giannis_freak_8", referenceProductId: "ref_nike_giannis_freak_8", costRatio: 0.42, initialStock: 110, popularity: 0.55, qualityScore: 0.84 },
  { productId: "nk_kobe_ad_protro", referenceProductId: "ref_nike_kobe_ad_protro", costRatio: 0.40, initialStock: 80, popularity: 0.60, qualityScore: 0.88 },
  { productId: "nk_air_force_1_07", referenceProductId: "ref_nike_air_force_1_07", costRatio: 0.38, initialStock: 320, popularity: 1.00, qualityScore: 0.90 },
  { productId: "nk_dunk_low_retro", referenceProductId: "ref_nike_dunk_low_retro", costRatio: 0.38, initialStock: 110, popularity: 0.85, qualityScore: 0.88 },
  { productId: "nk_air_max_90", referenceProductId: "ref_nike_air_max_90", costRatio: 0.40, initialStock: 160, popularity: 0.75, qualityScore: 0.87 },
  { productId: "nk_p_6000", referenceProductId: "ref_nike_p_6000", costRatio: 0.40, initialStock: 130, popularity: 0.55, qualityScore: 0.84 },
  { productId: "nk_mercurial_vapor_17_elite", referenceProductId: "ref_nike_mercurial_vapor_17_elite", costRatio: 0.38, initialStock: 60, popularity: 0.40, qualityScore: 0.89 },
  { productId: "nk_phantom_6_low_elite", referenceProductId: "ref_nike_phantom_6_low_elite", costRatio: 0.38, initialStock: 55, popularity: 0.35, qualityScore: 0.89 },
  { productId: "nk_mercurial_superfly_11_academy", referenceProductId: "ref_nike_mercurial_superfly_11_academy", costRatio: 0.45, initialStock: 150, popularity: 0.60, qualityScore: 0.82 },
  { productId: "nk_tech_essentials_hoodie", referenceProductId: "ref_nike_tech_essentials_hoodie", costRatio: 0.35, initialStock: 260, popularity: 0.80, qualityScore: 0.86 },
  { productId: "nk_sportswear_tshirt", referenceProductId: "ref_nike_sportswear_tshirt", costRatio: 0.30, initialStock: 400, popularity: 0.75, qualityScore: 0.85 },
  { productId: "nk_hyverse_top", referenceProductId: "ref_nike_hyverse_top", costRatio: 0.30, initialStock: 300, popularity: 0.55, qualityScore: 0.83 },
];

/** Builds the initial simulated product records for a run from the public catalogue. */
export function buildSimulatedProducts(
  businessId: string,
  simulationRunId: string,
  catalogue: readonly ReferenceProductT[],
  nowIso: string,
): SimulatedProduct[] {
  const byRef = new Map(catalogue.map((p) => [p.referenceProductId, p]));
  const products: SimulatedProduct[] = [];
  for (const a of OPERATIONAL_ASSUMPTIONS) {
    const ref = byRef.get(a.referenceProductId);
    if (!ref) throw new Error(`Operational assumption ${a.productId} references unknown catalogue product ${a.referenceProductId}`);
    const verifiedPublicPrice = ref.dataOrigin !== "synthetic" && ref.verification === "verified_verbatim";
    products.push({
      businessId, simulationRunId, productId: a.productId, referenceProductId: ref.referenceProductId,
      name: ref.name, subtitle: ref.subtitle, category: ref.category,
      priceMinor: ref.observedPriceMinor,
      priceOrigin: verifiedPublicPrice ? "official_public_list_price" : "synthetic",
      costMinor: Math.round(ref.observedPriceMinor * a.costRatio),
      currency: "GBP", availableUnits: a.initialStock, reservedUnits: 0,
      popularity: a.popularity, qualityScore: a.qualityScore, active: true, discountPercent: 0,
      dataOrigin: "synthetic", updatedAt: nowIso,
    });
  }
  return products;
}
