/**
 * Supplementary domain records persisted in MongoDB alongside canonical events.
 * These are rich, mutable operational records and are NOT canonical contracts;
 * nothing here may be copied into a `.strict()` BusinessEvent payload.
 */
import type { ReferenceProductCategoryT } from "@/reference/schemas";

export type Device = "desktop" | "ios" | "android" | "other";
export type Channel = "paid_social" | "paid_search" | "organic_search" | "direct" | "email" | "social" | "referral" | "demo_storefront";

export interface SimulatedProduct {
  businessId: string;
  simulationRunId: string;
  productId: string;
  referenceProductId: string;
  name: string;
  subtitle: string;
  category: ReferenceProductCategoryT;
  /** Selling price in minor units. Copied from the public list price when the reference is verified. */
  priceMinor: number;
  priceOrigin: "official_public_list_price" | "synthetic";
  /** Synthetic unit-cost assumption in minor units (never a Nike figure). */
  costMinor: number;
  currency: "GBP";
  availableUnits: number;
  reservedUnits: number;
  /** Relative demand weight (0-1). Synthetic. */
  popularity: number;
  /** Baseline product satisfaction (0-1). Synthetic. */
  qualityScore: number;
  active: boolean;
  discountPercent: number;
  dataOrigin: "synthetic";
  updatedAt: string;
}

export interface SimulatedCustomer {
  businessId: string;
  simulationRunId: string;
  customerId: string;
  /** Fictional display handle, never a real person. */
  displayName: string;
  preferredDevice: Device;
  acquisitionChannel: Channel;
  interests: ReferenceProductCategoryT[];
  purchasePropensity: number;
  priceSensitivity: number;
  deliverySensitivity: number;
  satisfaction: number;
  ordersPlaced: number;
  createdAt: string;
  lastSeenAt: string;
}

export interface SimulatedSessionItem {
  productId: string;
  quantity: number;
}

export interface SimulatedSession {
  businessId: string;
  simulationRunId: string;
  sessionId: string;
  customerId: string;
  isNewCustomer: boolean;
  device: Device;
  channel: Channel;
  campaignId?: string;
  startedAt: string;
  viewedProductIds: string[];
  cart: SimulatedSessionItem[];
  outcome: "browsed" | "abandoned_cart" | "checkout_failed" | "purchased" | "stockout";
  orderId?: string;
  checkoutId?: string;
  failureCode?: string;
}

export interface SimulatedOrderLine {
  productId: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  lineTotalMinor: number;
}

export interface SimulatedOrder {
  businessId: string;
  simulationRunId: string;
  orderId: string;
  customerId: string;
  sessionId: string;
  campaignId?: string;
  channel: Channel;
  device: Device;
  lines: SimulatedOrderLine[];
  grossTotalMinor: number;
  discountMinor: number;
  netRevenueMinor: number;
  refundedMinor: number;
  currency: "GBP";
  couponCode?: string;
  /** Virtual-clock time of purchase. */
  placedAt: string;
  /** Wall-clock time for storefront purchases made by a human. */
  wallClockAt?: string;
  origin: "simulator" | "demo_storefront";
  idempotencyKey?: string;
  status: "placed" | "refunded" | "partially_refunded";
}

export type ShipmentStatus = "pending" | "shipped" | "delivered" | "delayed" | "lost";

export interface SimulatedShipment {
  businessId: string;
  simulationRunId: string;
  shipmentId: string;
  orderId: string;
  customerId: string;
  status: ShipmentStatus;
  createdAt: string;
  promisedAt: string;
  shippedAt?: string;
  deliveredAt?: string;
  delayMinutes?: number;
  /** Virtual time of the next scheduled status transition, or null when terminal. */
  nextTransitionAt: string | null;
  nextStatus: ShipmentStatus | null;
  /** Pre-rolled outcome so transitions are deterministic and causally fixed at dispatch time. */
  plannedOutcome: "on_time" | "delayed" | "lost";
  reviewScheduledAt?: string | null;
  refundIssued: boolean;
  /** Denormalised from the order so refunds/reviews work after a restart without loading orders. */
  orderNetMinor?: number;
  productIds?: string[];
}

export interface SimulatedReview {
  businessId: string;
  simulationRunId: string;
  reviewId: string;
  productId: string;
  orderId: string;
  customerId: string;
  rating: number;
  text: string;
  /** Internal modelling inputs (observable consequences only reach events). */
  drivers: { productSatisfaction: number; deliveryPenalty: number; expectationGap: number };
  createdAt: string;
}

export interface SimulatedCampaign {
  businessId: string;
  simulationRunId: string;
  campaignId: string;
  name: string;
  platform: "meta_ads" | "google_ads";
  channel: Channel;
  targetCategory: ReferenceProductCategoryT;
  targetProductIds: string[];
  status: "active" | "paused";
  dailyBudgetMinor: number;
  currency: "GBP";
  /** Cost per thousand impressions in minor units. Synthetic. */
  cpmMinor: number;
  baseCtr: number;
  creativeQuality: number;
  audienceRelevance: number;
  /** Reachable audience size per day used to derive frequency. */
  audienceSize: number;
  /** Rolling impressions over the trailing day to compute frequency. */
  rollingImpressions: number[];
  totals: {
    impressions: number; clicks: number; spendMinor: number; sessions: number;
    attributedOrders: number; attributedRevenueMinor: number;
  };
  /** Unspent budget carried within the current virtual day. */
  budgetSpentTodayMinor: number;
  budgetDay: string;
  createdAt: string;
  updatedAt: string;
}

export interface StorefrontBanner {
  bannerId: string;
  message: string;
  startsAt: string;
  expiresAt?: string;
  promoCode?: string;
  actionId: string;
  publishedAt: string;
}

export interface SimulatedStorefront {
  businessId: string;
  simulationRunId: string;
  banners: StorefrontBanner[];
  promotions: Array<{
    promoCode: string; productIds: string[]; percentOff: number; maxRedemptions: number;
    redemptions: number; expiresAt: string; actionId: string;
  }>;
  updatedAt: string;
}

export interface SimulatedMessage {
  businessId: string;
  simulationRunId: string;
  messageId: string;
  orderId: string;
  customerId: string;
  templateId: string;
  actionId: string;
  deliveryStatus: "queued" | "sent" | "failed";
  /** Fake inbox only — never a real address. */
  inbox: "demo_test_inbox";
  body: string;
  sentAt: string;
}
