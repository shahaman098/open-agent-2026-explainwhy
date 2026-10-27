export interface StoreProduct {
  productId: string;
  images: Array<{src:string;alt:string}>;
  name: string;
  subtitle: string;
  category: string;
  priceMinor: number;
  currency: "GBP";
  priceOrigin: "official_public_list_price" | "synthetic";
  discountPercent: number;
  availableUnits: number;
  active: boolean;
  reference: { referenceProductId: string; sourceUrl: string; retrievedAt: string; dataOrigin: string; styleCode?: string; description?: string } | null;
}
export interface StoreBanner { bannerId: string; message: string; startsAt: string; expiresAt?: string; promoCode?: string }
export interface StoreCatalogue {
  simulationRunId: string | null;
  virtualTime: string | null;
  servedFrom: "mongodb" | "cache";
  banners: StoreBanner[];
  promotions: Array<{ promoCode: string; percentOff: number; productIds: string[]; expiresAt: string }>;
  products: StoreProduct[];
  notice?: string;
}
export interface CartLine { productId: string; quantity: number }
export interface StoreOrder {
  orderId: string;
  placedAt: string;
  wallClockAt?: string;
  lines: Array<{ productId: string; name: string; quantity: number; unitPriceMinor: number; discountMinor: number; lineTotalMinor: number }>;
  grossTotalMinor: number;
  discountMinor: number;
  netRevenueMinor: number;
  status: string;
  couponCode?: string;
  shipment: { status: string; promisedAt: string; shippedAt?: string; deliveredAt?: string; delayMinutes?: number } | null;
}
