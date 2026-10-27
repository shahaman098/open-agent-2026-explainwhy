import { productImages } from "@/reference/product-images";
import { readStorefront } from "@/adapters";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { businessIdFrom, handleRouteError } from "@/lib/route-helpers";
import { getReferenceCatalogue } from "@/reference/service";
import { getActiveRunId, getRunSummary } from "@/simulator/runtime";
import type { SimulatedProduct } from "@/types/domain";

/**
 * GET /api/demo-store/products — public catalogue for the storefront: verified
 * Nike reference data (name, public list price, source URL) joined with the
 * active run's simulated inventory and active banners.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const businessId = businessIdFrom(request);
    const db = await getDb();
    const runId = new URL(request.url).searchParams.get("simulationRunId") ?? await getActiveRunId(businessId, db);
    const { products: catalogue, servedFrom } = await getReferenceCatalogue(db);
    const byRef = new Map(catalogue.map((c) => [c.referenceProductId, c]));
    if (!runId) {
      return Response.json({ simulationRunId: null, virtualTime: null, servedFrom, banners: [], products: [], notice: "No active simulation run. Start one from /dev/simulator." });
    }
    const [summary, simulated, storefront] = await Promise.all([
      getRunSummary(businessId, runId, db),
      db.collection<SimulatedProduct>(COLLECTIONS.simulatedProducts).find({ businessId, simulationRunId: runId }, { projection: { _id: 0, costMinor: 0, popularity: 0, qualityScore: 0 } }).sort({ category: 1, productId: 1 }).toArray(),
      readStorefront({ businessId, simulationRunId: runId, db }),
    ]);
    const products = simulated.map((p) => {
      const ref = byRef.get(p.referenceProductId);
      return {
        productId: p.productId, name: p.name, subtitle: p.subtitle, category: p.category, priceMinor: p.priceMinor, currency: p.currency,
        images: productImages(p.referenceProductId, ref?.styleCode, ref?.imageUrl),
        priceOrigin: p.priceOrigin, discountPercent: p.discountPercent, availableUnits: p.availableUnits, active: p.active,
        reference: ref ? { referenceProductId: ref.referenceProductId, sourceUrl: ref.sourceUrl, retrievedAt: ref.retrievedAt, dataOrigin: ref.dataOrigin, styleCode: ref.styleCode, description: ref.description } : null,
      };
    });
    return Response.json({ simulationRunId: runId, virtualTime: summary.run.virtualTime, servedFrom, banners: storefront.activeBanners, promotions: storefront.promotions.map((p) => ({ promoCode: p.promoCode, percentOff: p.percentOff, productIds: p.productIds, expiresAt: p.expiresAt })), products });
  } catch (error) {
    return handleRouteError(error, "demo-store/products");
  }
}
