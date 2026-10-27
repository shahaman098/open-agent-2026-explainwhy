import { ReferenceFinancials, ReferenceProduct, type ReferenceProductCategoryT } from "./schemas";
export const NVIDIA_Q2_SOURCE = "https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx";
export const NVIDIA_Q1_SOURCE = "https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-First-Quarter-Fiscal-2027/default.aspx";
export const NVIDIA_Q3_SOURCE = "https://investor.nvidia.com/news/press-release-details/2025/NVIDIA-Announces-Financial-Results-for-Third-Quarter-Fiscal-2026/";
export const NVIDIA_RETRIEVED_AT = "2026-10-27T00:00:00.000Z";
/** Actual, dated company disclosures. Never used as simulated order or daily revenue. */
export const NVIDIA_REVENUE_HISTORY = [
  { quarter: "Q2 FY26", revenueUsdMillions: 46743, sourceUrl: NVIDIA_Q2_SOURCE },
  { quarter: "Q3 FY26", revenueUsdMillions: 57006, sourceUrl: NVIDIA_Q3_SOURCE },
  { quarter: "Q4 FY26", revenueUsdMillions: 68127, sourceUrl: NVIDIA_Q1_SOURCE },
  { quarter: "Q1 FY27", revenueUsdMillions: 81615, sourceUrl: NVIDIA_Q1_SOURCE },
  { quarter: "Q2 FY27", revenueUsdMillions: 96221, sourceUrl: NVIDIA_Q2_SOURCE },
];
export const NVIDIA_Q2_FY27 = ReferenceFinancials.parse({
  referenceId: "nvidia_q2_fy2027_results", company: "NVIDIA Corporation", fiscalPeriod: "Q2 FY2027", periodEndedOn: "2026-07-26", releasedOn: "2026-08-26", currency: "USD",
  figures: [{ label: "Revenue", valueUsdMillions: 96221, priorYearUsdMillions: 46743, reportedChangePercent: 106 }, { label: "GAAP operating income", valueUsdMillions: 63734, priorYearUsdMillions: 28440, reportedChangePercent: 124 }, { label: "GAAP net income", valueUsdMillions: 59688, priorYearUsdMillions: 26422, reportedChangePercent: 126 }],
  grossMarginPercent: 75, dilutedEpsUsd: 2.46, sourceUrl: NVIDIA_Q2_SOURCE, dataOrigin: "official_public", retrievedAt: NVIDIA_RETRIEVED_AT, relationshipToSimulator: "context_only_not_simulated_revenue",
});
const geforceSource = "https://nvidianews.nvidia.com/news/nvidia-blackwell-geforce-rtx-50-series-opens-new-world-of-ai-computer-graphics";
const proSource = "https://www.nvidia.com/en-us/products/workstations/professional-desktop-gpus/rtx-pro-6000-family/";
/** Names have public product references. GBP prices and all operational assumptions are invented for this UK-channel demo. */
const product = (id: string, name: string, category: ReferenceProductCategoryT, price: number, sourceUrl: string) => ReferenceProduct.parse({ referenceProductId: `ref_${id}`, name, subtitle: "Synthetic UK channel offer · price is invented", category, observedPriceMinor: price, currency: "GBP", sourceUrl, sourceSite: "nvidia.com", dataOrigin: "synthetic", retrievedAt: NVIDIA_RETRIEVED_AT, retrievalMethod: "Public product name reference; synthetic GBP offer, inventory and demand", verification: "unverified" });
export const NVIDIA_DEMO_CATALOGUE = [
  product("nv_rtx_5090", "GeForce RTX 5090", "gaming", 189999, geforceSource),
  product("nv_rtx_5080", "GeForce RTX 5080", "gaming", 99999, geforceSource),
  product("nv_rtx_5070_ti", "GeForce RTX 5070 Ti", "creator", 74999, geforceSource),
  product("nv_rtx_5070", "GeForce RTX 5070", "creator", 54999, geforceSource),
  product("nv_rtx_pro_workstation", "RTX PRO 6000 Blackwell Workstation Edition", "workstation", 799999, proSource),
  product("nv_rtx_pro_server", "RTX PRO 6000 Blackwell Server Edition", "datacenter", 899999, proSource),
  product("nv_rtx_pro_maxq", "RTX PRO 6000 Blackwell Max-Q Workstation Edition", "compact_ai", 699999, proSource),
];
