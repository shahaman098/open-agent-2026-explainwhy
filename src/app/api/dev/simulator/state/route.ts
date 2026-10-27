import { readCampaigns, readStorefront } from "@/adapters";
import { COLLECTIONS } from "@/lib/collections";
import { getDb } from "@/lib/mongodb";
import { businessIdFrom, guardDevRoute, handleRouteError } from "@/lib/route-helpers";
import { getRunSummary } from "@/simulator/runtime";
import type { SimulatedProduct, SimulatedReview, SimulatedShipment } from "@/types/domain";

/**
 * GET /api/dev/simulator/state?businessId&simulationRunId
 * Operator view of a run: canonical SimulatorRun + supplementary counts. The
 * private mechanistic fault parameters are never included.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = guardDevRoute(request);
  if (denied) return denied;
  try {
    const businessId = businessIdFrom(request);
    const url = new URL(request.url);
    const summary = await getRunSummary(businessId, url.searchParams.get("simulationRunId"));
    const runId = summary.run.simulationRunId;
    const db = await getDb();
    const f = { businessId, simulationRunId: runId };
    const [products, campaigns, storefront, shipmentsByStatus, recentReviews, recentShipments, ordersCount, customersCount] = await Promise.all([
      db.collection<SimulatedProduct>(COLLECTIONS.simulatedProducts).find(f, { projection: { _id: 0 } }).sort({ productId: 1 }).toArray(),
      readCampaigns({ businessId, simulationRunId: runId }),
      readStorefront({ businessId, simulationRunId: runId }),
      db.collection(COLLECTIONS.simulatedShipments).aggregate<{ _id: string; n: number }>([{ $match: f }, { $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
      db.collection<SimulatedReview>(COLLECTIONS.simulatedReviews).find(f, { projection: { _id: 0, drivers: 0 } }).sort({ createdAt: -1 }).limit(12).toArray(),
      db.collection<SimulatedShipment>(COLLECTIONS.simulatedShipments).find(f, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(12).toArray(),
      db.collection(COLLECTIONS.simulatedOrders).countDocuments(f),
      db.collection(COLLECTIONS.simulatedCustomers).countDocuments(f),
    ]);
    return Response.json({
      ...summary,
      inventory: products.map((p) => ({ productId: p.productId, name: p.name, category: p.category, priceMinor: p.priceMinor, availableUnits: p.availableUnits, reservedUnits: p.reservedUnits, active: p.active })),
      campaigns,
      storefront: { activeBanners: storefront.activeBanners, banners: storefront.banners.length, promotions: storefront.promotions.length },
      shipments: Object.fromEntries(shipmentsByStatus.map((s) => [s._id, s.n])),
      recentReviews, recentShipments,
      counts: { orders: ordersCount, customers: customersCount },
    });
  } catch (error) {
    return handleRouteError(error, "simulator/state");
  }
}
