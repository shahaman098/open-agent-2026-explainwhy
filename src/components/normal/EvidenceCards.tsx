/* Source-provided images load directly from their validated source host, without a server image proxy. */
/* eslint-disable @next/next/no-img-element */
"use client";
import { virtualDate } from "@/lib/format";
import type { EvidenceItem } from "./api";
import type { ExternalSourceT } from "@/intelligence/investigator/schemas";
import { externalCardView, internalCardView, type InternalCard } from "./evidence-card-model";

function amount(value: number, unit: string) {
  if (unit.startsWith("GBP minor")) return `£${(value / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}${unit.endsWith("/hour") ? "/h" : ""}`;
  if (unit === "ratio" && value <= 1) return `${(value * 100).toFixed(2)}%`;
  return `${value.toLocaleString("en-GB", { maximumFractionDigits: 2 })} ${unit}`.trim();
}
function Trend({ card }: { card: InternalCard }) {
  if (card.series.length > 1) {
    const max = Math.max(1, ...card.series.map((point) => point.value));
    return <div className="investigation-trend" role="img" aria-label={`Actual daily values: ${card.series.map((point) => `${point.day} ${amount(point.value, "GBP minor units")}`).join(", ")}`}>{card.series.map((point) => <span key={point.day} style={{ height: `${Math.max(4, point.value / max * 100)}%` }} title={`${point.day}: ${amount(point.value, "GBP minor units")}`} />)}</div>;
  }
  const measure = card.measurements.find((item) => item.baseline !== undefined && item.value >= 0 && item.baseline >= 0);
  if (!measure) return null;
  const max = Math.max(1, measure.value, measure.baseline!);
  return <div className="investigation-comparison" role="img" aria-label={`${measure.metric}: observed ${amount(measure.value, measure.unit)}, baseline ${amount(measure.baseline!, measure.unit)}`}>
    <span>Observed</span><div><i style={{ width: `${Math.max(2, measure.value / max * 100)}%` }} /></div><span>Baseline</span><div><i style={{ width: `${Math.max(2, measure.baseline! / max * 100)}%` }} /></div>
  </div>;
}

export function InternalEvidenceCard({ item, compact = false }: { item: EvidenceItem; compact?: boolean }) {
  const card = internalCardView(item);
  const displayMeasures = card.measurements.slice(0, compact ? 3 : 5);
  return <article className={`investigation-evidence-card evidence-${card.kind}`} data-testid="internal-evidence-card" data-evidence-id={card.id}>
    <div className="investigation-card-top"><span className="investigation-card-type">{card.kind === "campaign" ? "Campaign evidence" : card.kind === "metric" ? "Metric evidence" : card.kind === "social" ? "Social observation" : "Operational record"}</span><span className={`pill ${card.verified ? "ok" : "warn"}`}>{card.verified ? "Source records checked" : "Verification pending"}</span></div>
    <h5>{card.title}</h5><p>{card.observation}</p>
    {displayMeasures.length ? <div className="investigation-measures">{displayMeasures.map((measure) => <div key={measure.metric}><span>{measure.metric.replaceAll("_", " ")}</span><strong>{amount(measure.value, measure.unit)}</strong>{measure.baseline !== undefined ? <small>Baseline {amount(measure.baseline, measure.unit)}</small> : null}</div>)}</div> : null}
    <Trend card={card} />
    {card.campaigns.length ? <div className="investigation-campaign-rows">{card.campaigns.map((campaign) => <div key={campaign.campaignId}><strong>{campaign.url ? <a href={campaign.url}>{campaign.name || campaign.campaignId.replaceAll("_", " ")} →</a> : campaign.name || campaign.campaignId.replaceAll("_", " ")}</strong><span>{campaign.platform?.replaceAll("_", " ") || "Platform unavailable"} · CTR {campaign.ctr === null ? "—" : amount(campaign.ctr, "ratio")}{campaign.baselineCtr === null ? "" : ` vs ${amount(campaign.baselineCtr, "ratio")} baseline`} · ROAS {campaign.roas?.toFixed(2) ?? "—"} · Spend {amount(campaign.spendMinor, "GBP minor units")} · {campaign.attributedOrders} attributed orders</span></div>)}</div> : null}
    <div className="investigation-card-foot"><span>{card.window ? `${virtualDate(card.window.startAt)} → ${virtualDate(card.window.endAt)}` : "Window unavailable"} · {card.sourceCount} source records</span><a href={`#evidence-${encodeURIComponent(card.id)}`}>Inspect record →</a></div>
  </article>;
}

export function ExternalEvidenceCard({ source }: { source: ExternalSourceT }) {
  const card = externalCardView(source);
  return <article className={`investigation-evidence-card evidence-external evidence-${card.kind}`} data-testid="external-evidence-card" data-source-id={card.id}>
    {card.previewImageUrl ? <img className="investigation-source-image" src={card.previewImageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
    <div className="investigation-card-top"><span className="investigation-card-type">{card.kind === "unverified" ? "Unverified research" : card.kind === "official_document" ? "Official document" : card.kind === "status_incident" ? "Platform status" : card.kind === "social" ? "Community source" : "Publisher article"}</span><span className={`pill ${card.claimSupport === "supported" && card.kind !== "unverified" ? "ok" : "warn"}`}>{card.claimSupport.replaceAll("_", " ")}</span></div>
    <h5>{card.title}</h5><div className="investigation-source-meta">{card.publisher || "Publisher unknown"} · {card.publisherIdentity === "official_domain" ? "Recognized official host" : "Host attribution only"} · Published {card.publishedAt ? <time dateTime={card.publishedAt}>{new Date(card.publishedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</time> : "unknown"}</div>
    <p>{card.claim}</p>{card.passage ? <blockquote>{card.passage}</blockquote> : null}{card.kind === "social" ? <p className="investigation-source-limit">Anecdotal public record; it does not establish population-wide impact.</p> : null}
    <div className="investigation-card-foot"><span>Retrieved {virtualDate(card.retrievedAt)} · HTTP {card.httpStatus ?? "unknown"} · {card.status.replaceAll("_", " ")} · incident relevance {card.contextRelevance.replaceAll("_", " ")}</span>{card.originalUrl ? <a href={card.originalUrl} target="_blank" rel="noopener noreferrer">Original source ↗</a> : null}</div>
    {source.duplicateOf ? <p className="investigation-source-limit">Same source page as {source.duplicateOf}; not independent corroboration.</p> : null}
    {card.kind === "unverified" ? <p className="investigation-source-limit">{card.limitations.at(-1) || "This candidate is excluded from supported findings."}</p> : <><p className="investigation-source-limit">Public context only; does not establish a cause of this simulation.</p><details><summary>Verification and limits</summary><p className="small">{card.limitations.join(" ")}</p></details></>}
  </article>;
}
