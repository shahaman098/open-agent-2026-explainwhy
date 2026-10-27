import type { CampaignSeed } from "./config";
import type { OperationalAssumption } from "./catalogue";
import { NVIDIA_DEMO_CATALOGUE } from "@/reference/nvidia";
export const NVIDIA_CATEGORIES = ["gaming", "creator", "workstation", "datacenter", "compact_ai"] as const;
export const NVIDIA_ASSUMPTIONS: OperationalAssumption[] = NVIDIA_DEMO_CATALOGUE.map((product, index) => ({ productId: product.referenceProductId.replace(/^ref_/, ""), referenceProductId: product.referenceProductId, costRatio: .67, initialStock: index < 4 ? 240 : 70, popularity: index < 4 ? .95 : .5, qualityScore: .91 }));
export const NVIDIA_CAMPAIGNS: CampaignSeed[] = NVIDIA_CATEGORIES.map((category, index) => ({
  campaignId: `cmp_nv_${category}`, name: ["GeForce RTX 50 · Gaming", "RTX Studio · Creators", "RTX PRO · Workstations", "Blackwell · AI Servers", "RTX PRO Max-Q · Compact AI"][index],
  platform: index % 2 ? "google_ads" : "meta_ads", channel: index % 2 ? "paid_search" : "paid_social", targetCategory: category,
  targetProductIds: NVIDIA_ASSUMPTIONS.filter((_, i) => NVIDIA_DEMO_CATALOGUE[i].category === category).map(item => item.productId),
  dailyBudgetMinor: [24000, 18000, 16000, 20000, 12000][index], cpmMinor: [950, 1400, 1800, 2200, 1600][index], baseCtr: [0.018, 0.03, 0.025, 0.022, 0.026][index], creativeQuality: 1.05, audienceRelevance: 1.1, audienceSize: [65000, 32000, 18000, 16000, 14000][index],
}));
