import type { ReferenceProductCategoryT } from "@/reference/schemas";
import type { Channel, Device } from "@/types/domain";

export const CONNECTOR_ID = "nike_simulator_v1";
export const DEFAULT_BUSINESS_ID = "nike_demo";
export const DEFAULT_BUSINESS_NAME = "Nike — Unaffiliated Simulation";
export const DEFAULT_MINUTES_PER_TICK = 60;
export const DEFAULT_VIRTUAL_START = "2026-10-01T00:00:00.000Z";

/** Relative traffic by hour of day (UTC), mean 1.0. */
export const HOUR_WEIGHTS: readonly number[] = normalise([
  0.30, 0.20, 0.15, 0.10, 0.10, 0.20, 0.40, 0.70, 0.90, 1.00, 1.10, 1.20,
  1.30, 1.30, 1.20, 1.20, 1.30, 1.50, 1.70, 1.80, 1.60, 1.30, 0.90, 0.50,
]);

function normalise(w: number[]): number[] {
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  return w.map((x) => x / mean);
}

export interface SimulationConfig {
  /** Expected organic + direct + email sessions per virtual hour at weight 1.0. */
  baseOrganicSessionsPerHour: number;
  /** Share of sessions that belong to a known returning customer. */
  returningRate: number;
  /** Baseline purchase probability per session before customer/price adjustments. */
  baseConversion: number;
  /** Probability a paid click lands and becomes a session. */
  landingRate: number;
  /** Initial customer pool size. */
  initialCustomers: number;
  /** Review probability after delivery, baseline. */
  baseReviewRate: number;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  baseOrganicSessionsPerHour: 20,
  returningRate: 0.45,
  baseConversion: 0.022,
  landingRate: 0.85,
  initialCustomers: 300,
  baseReviewRate: 0.22,
};

export const DEVICES: readonly Device[] = ["desktop", "ios", "android", "other"];
export const DEVICE_WEIGHTS: Record<Device, number> = { desktop: 0.38, ios: 0.34, android: 0.25, other: 0.03 };

export const ORGANIC_CHANNELS: readonly Channel[] = ["organic_search", "direct", "email", "social", "referral"];
export const ORGANIC_CHANNEL_WEIGHTS: Record<string, number> = {
  organic_search: 0.42, direct: 0.30, email: 0.10, social: 0.12, referral: 0.06,
};
export const CHANNEL_CONVERSION_FACTOR: Record<Channel, number> = {
  paid_social: 0.95, paid_search: 1.25, organic_search: 1.0, direct: 1.35, email: 1.6,
  social: 0.8, referral: 1.0, demo_storefront: 1,
};

export const CATEGORIES: readonly ReferenceProductCategoryT[] = ["running", "basketball", "lifestyle", "football", "apparel"];

export interface CampaignSeed {
  campaignId: string;
  name: string;
  platform: "meta_ads" | "google_ads";
  channel: Channel;
  targetCategory: ReferenceProductCategoryT;
  targetProductIds: string[];
  dailyBudgetMinor: number;
  cpmMinor: number;
  baseCtr: number;
  creativeQuality: number;
  audienceRelevance: number;
  audienceSize: number;
}

/** Synthetic campaigns themed on real Nike product lines. Budgets/CPMs are invented. */
export const CAMPAIGN_SEEDS: readonly CampaignSeed[] = [
  { campaignId: "cmp_running_pegasus", name: "Pegasus 42 — Run Your Way (Meta)", platform: "meta_ads", channel: "paid_social",
    targetCategory: "running", targetProductIds: ["nk_pegasus_42", "nk_vomero_18", "nk_pegasus_plus_2"],
    dailyBudgetMinor: 12000, cpmMinor: 720, baseCtr: 0.014, creativeQuality: 1.05, audienceRelevance: 1.0, audienceSize: 42000 },
  { campaignId: "cmp_lifestyle_af1", name: "Air Force 1 Icons (Meta)", platform: "meta_ads", channel: "paid_social",
    targetCategory: "lifestyle", targetProductIds: ["nk_air_force_1_07", "nk_dunk_low_retro", "nk_air_max_90"],
    dailyBudgetMinor: 10000, cpmMinor: 650, baseCtr: 0.016, creativeQuality: 1.1, audienceRelevance: 1.05, audienceSize: 55000 },
  { campaignId: "cmp_basketball_search", name: "Basketball Shoes — Search (Google)", platform: "google_ads", channel: "paid_search",
    targetCategory: "basketball", targetProductIds: ["nk_ja_4_nightmare", "nk_giannis_freak_8", "nk_kobe_ad_protro"],
    dailyBudgetMinor: 9000, cpmMinor: 1400, baseCtr: 0.032, creativeQuality: 1.0, audienceRelevance: 1.15, audienceSize: 18000 },
  { campaignId: "cmp_football_mercurial", name: "Mercurial Speed Pack (Meta)", platform: "meta_ads", channel: "paid_social",
    targetCategory: "football", targetProductIds: ["nk_mercurial_vapor_17_elite", "nk_phantom_6_low_elite", "nk_mercurial_superfly_11_academy"],
    dailyBudgetMinor: 8000, cpmMinor: 780, baseCtr: 0.012, creativeQuality: 0.95, audienceRelevance: 1.0, audienceSize: 30000 },
  { campaignId: "cmp_apparel_search", name: "Sportswear Essentials — Search (Google)", platform: "google_ads", channel: "paid_search",
    targetCategory: "apparel", targetProductIds: ["nk_tech_essentials_hoodie", "nk_sportswear_tshirt", "nk_hyverse_top"],
    dailyBudgetMinor: 7000, cpmMinor: 1100, baseCtr: 0.028, creativeQuality: 1.0, audienceRelevance: 1.0, audienceSize: 25000 },
];

/** Fictional customer name parts; never resemble real customer records. */
export const FIRST_NAMES = ["Alex", "Sam", "Jordan", "Taylor", "Morgan", "Riley", "Casey", "Avery", "Quinn", "Rowan", "Jamie", "Drew", "Ellis", "Harper", "Kai", "Reese"];
export const LAST_INITIALS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "R", "S", "T", "W"];

export const STANDARD_DELIVERY_HOURS = 48;
export const DISPATCH_MIN_HOURS = 6;
export const DISPATCH_MAX_HOURS = 30;
