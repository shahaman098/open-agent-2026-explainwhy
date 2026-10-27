export interface SimulatorRunView {
  simulationRunId: string; seed: number; status: string; virtualTime: string; minutesPerTick: number;
  activeScenario: string; scenarioSeverity: number; createdAt: string; updatedAt: string;
}
export interface InventoryRow { productId: string; name: string; category: string; priceMinor: number; availableUnits: number; reservedUnits: number; active: boolean }
export interface CampaignView { campaignId: string; name: string; platform: string; status: string; dailyBudgetMinor: number; targetCategory: string; totals: { impressions: number; clicks: number; spendMinor: number; sessions: number; attributedOrders: number; attributedRevenueMinor: number } }
export interface StateResponse {
  run: SimulatorRunView; tickIndex: number; virtualStartAt: string; totals: { events: number; orders: number; sessions: number }; locked: boolean;
  scenarioInjectedAt: string | null; isActiveRun: boolean; inventory: InventoryRow[]; campaigns: CampaignView[];
  storefront: { activeBanners: Array<{ bannerId: string; message: string }>; banners: number; promotions: number };
  shipments: Record<string, number>;
  recentReviews: Array<{ reviewId: string; productId: string; orderId: string; rating: number; text: string; createdAt: string }>;
  recentShipments: Array<{ shipmentId: string; orderId: string; status: string; promisedAt: string; deliveredAt?: string; delayMinutes?: number; createdAt: string }>;
  counts: { orders: number; customers: number };
}
export interface Snapshot {
  snapshotId: string; window: { startAt: string; endAt: string }; completeness: string;
  counters: { sessions: number; orders: number; revenueMinor: number; refundMinor: number; adSpendMinor: number; impressions: number; clicks: number; attributedOrders: number; shipments: number; delayedShipments: number; reviews: number; lowRatingReviews: number };
  rates: { conversionRate: number | null; ctr: number | null; lateDeliveryRate: number | null; lowRatingRate: number | null; costPerAcquisitionMinor: number | null };
}
export interface Breakdown {
  run: SimulatorRunView; window: { startAt: string; endAt: string }; total: Snapshot | null; daily: Snapshot[]; hourly: Snapshot[];
  products: Array<{ productId: string; name: string; category: string; priceMinor: number; unitsSold: number; revenueMinor: number; orders: number; availableUnits: number; active: boolean }>;
  campaigns: Array<{ campaignId: string; impressions: number; clicks: number; spendMinor: number; attributedOrders: number; attributedRevenueMinor: number; ctr: number | null; costPerAcquisitionMinor: number | null; roas: number | null; averageFrequency: number | null }>;
}
export interface LedgerEvent { eventId: string; type: string; occurredAt: string; payload: Record<string, unknown>; provenance: { ingestMethod: string } }
export interface RunsResponse { activeSimulationRunId: string | null; runs: Array<SimulatorRunView & { tickIndex: number }> }
