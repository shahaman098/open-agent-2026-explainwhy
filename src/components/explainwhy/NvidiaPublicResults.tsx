"use client";
import { AnimateChart } from "@/components/presentation/AnimateChart";
import { NVIDIA_Q2_FY27, NVIDIA_Q2_SOURCE, NVIDIA_REVENUE_HISTORY } from "@/reference/nvidia";
import type { ChartSpec, PresentationSpec } from "@/lib/presentation/schema";
import "./nvidia-results.css";
const latest = NVIDIA_Q2_FY27;
export function nvidiaPublicPresentation(): PresentationSpec {
  const charts: ChartSpec[] = [
    { title: "Reported quarterly revenue", subtitle: "Published NVIDIA results · fiscal quarters · USD billions", kind: "bar", unit: "USD billions", source: "NVIDIA Investor Relations · retrieved 27 Oct 2026", sourceUrl: NVIDIA_Q2_SOURCE, summary: { label: "Q2 FY27", value: 96.221 }, series: [{ name: "Revenue", points: NVIDIA_REVENUE_HISTORY.map(item => ({ label: item.quarter, value: item.revenueUsdMillions / 1000 })) }] },
    { title: "Q2 FY27 · GAAP results", subtitle: "Quarter ended 26 July 2026 · USD billions", kind: "bar", unit: "USD billions", source: "NVIDIA · results released 26 Aug 2026", sourceUrl: NVIDIA_Q2_SOURCE, series: [{ name: "GAAP", points: latest.figures.map(item => ({ label: item.label.replace("GAAP ", ""), value: item.valueUsdMillions / 1000 })) }] },
  ];
  return { title: "NVIDIA · Reported financial results", subtitle: "Official public disclosures · Quarterly data · USD", synthetic: false, charts };
}
export function NvidiaPublicResults({ scope }: { scope: { businessId: string; simulationRunId: string } }) {
  const presentation = nvidiaPublicPresentation();
  const max = 100000;
  return <section className="nvidia-public-results" aria-label="NVIDIA official public financial results"><header><div><span className="nvidia-public-kicker">OFFICIAL PUBLIC DATA · USD</span><h2>NVIDIA · Reported financials</h2><p>Company disclosures, alongside a separate synthetic operations demo.</p></div><AnimateChart label="Animate NVIDIA results" presentation={presentation} scope={scope}/></header><div className="nvidia-public-grid"><article><div className="nvidia-public-chart-heading"><h3>Quarterly revenue</h3><span>USD billions</span></div><div className="nvidia-public-bars" role="img" aria-label={NVIDIA_REVENUE_HISTORY.map(item => `${item.quarter}: USD ${item.revenueUsdMillions} million`).join(", ")}>{NVIDIA_REVENUE_HISTORY.map(item => <a key={item.quarter} href={item.sourceUrl} target="_blank" rel="noreferrer" title={`${item.quarter} · reported revenue $${item.revenueUsdMillions.toLocaleString("en-US")} million · official source`}><strong>${(item.revenueUsdMillions / 1000).toFixed(1)}B</strong><i style={{ height: `${item.revenueUsdMillions / max * 120}px` }}/><span>{item.quarter}</span></a>)}</div><footer>Fiscal quarters · source values retained in millions; chart labels rounded to billions.</footer></article><div className="nvidia-public-metrics"><article><span>Q2 FY27 revenue</span><strong>$96.2B</strong><small>+106% year over year</small></article><article><span>GAAP operating income</span><strong>$63.7B</strong><small>Q2 FY27 · reported</small></article><article><span>GAAP gross margin</span><strong>75.0%</strong><small>Quarter ended 26 July 2026</small></article><article><span>Diluted EPS · GAAP</span><strong>$2.46</strong><small>Released 26 August 2026</small></article></div></div><div className="nvidia-public-provenance"><span>Verified against the published releases · retrieved 27 Oct 2026</span><a href="/assets/ExplainWhy_NVIDIA_60s_4K.mp4">Watch 60s results · 4K ↗</a><a href={NVIDIA_Q2_SOURCE} target="_blank" rel="noreferrer">Open NVIDIA source ↗</a></div></section>;
}
