import { z } from "zod";
import type { ExternalSourceT, ScopeT } from "@/intelligence/investigator/schemas";
import type { EvidenceItem } from "./api";

const Measure = z.object({ metric: z.string(), value: z.number().finite(), unit: z.string(), baseline: z.number().finite().optional() });
const SeriesPoint = z.object({ day: z.string(), value: z.number().finite(), hours: z.number().finite() });
const CampaignRow = z.object({ campaignId: z.string(), ctr: z.number().finite().nullable(), baselineCtr: z.number().finite().nullable(),
  roas: z.number().finite().nullable(), spendMinor: z.number().finite(), attributedOrders: z.number().finite(),
  name: z.string().optional(), platform: z.string().optional(), url: z.string().startsWith("/").optional() });
export const InternalCardView = z.object({ id: z.string(), kind: z.enum(["metric", "campaign", "operational", "social"]), title: z.string(),
  observation: z.string(), window: z.object({ startAt: z.string(), endAt: z.string() }).nullable(), sourceCount: z.number().int(),
  sourceRef: z.string().nullable(), verified: z.boolean(), measurements: z.array(Measure), series: z.array(SeriesPoint), campaigns: z.array(CampaignRow), warnings: z.array(z.string()) });
export const ExternalCardView = z.object({ id: z.string(), kind: z.enum(["article", "official_document", "status_incident", "social", "unverified"]),
  title: z.string(), publisher: z.string().nullable(), publisherIdentity: z.enum(["official_domain", "retrieved_host_only"]),
  originalUrl: z.string().url().nullable(), previewImageUrl: z.string().url().nullable(), publishedAt: z.string().nullable(),
  retrievedAt: z.string(), updatedAt: z.string().nullable(), claim: z.string(), passage: z.string(),
  claimSupport: z.enum(["not_assessed", "supported", "contradictory", "context_only", "insufficient"]),
  contextRelevance: z.enum(["not_assessed", "relevant", "not_relevant", "uncertain"]),
  status: z.string(), limitations: z.array(z.string()), httpStatus: z.number().nullable() });
export type InternalCard = z.infer<typeof InternalCardView>;
export type ExternalCard = z.infer<typeof ExternalCardView>;

/** One card per scoped claim record. Same-page claims retain their separate assessments. */
export function scopedExternalSources(sources: ExternalSourceT[], scope: ScopeT): ExternalSourceT[] {
  const unique = new Map<string, ExternalSourceT>();
  for (const source of sources) {
    if (source.businessId === scope.businessId && source.simulationRunId === scope.simulationRunId && source.investigationId === scope.investigationId && !unique.has(source.sourceId)) unique.set(source.sourceId, source);
  }
  return [...unique.values()];
}

export function supportsPublicClaim(source: ExternalSourceT): boolean {
  return source.status === "contextual" && source.httpStatus === 200 && source.claimSupport === "supported" && source.temporalValidity === "within_cutoff" && source.excerptMatched && !source.duplicateOf;
}

function sourceUrl(raw: string | null | undefined, publisher: string | null, allowSubdomain: boolean): string | null {
  if (!raw || !publisher) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) return null;
    if (parsed.hostname !== publisher && !(allowSubdomain && parsed.hostname.endsWith(`.${publisher}`))) return null;
    return parsed.href;
  } catch { return null; }
}

export function internalCardView(item: EvidenceItem): InternalCard {
  const evidence = item.evidence;
  const detail = item.detail;
  const campaigns = z.array(CampaignRow).safeParse(detail?.campaigns);
  const series = z.array(SeriesPoint).safeParse(detail?.dailyRevenueMinor);
  return InternalCardView.parse({ id: evidence.evidenceId,
    kind: item.tool === "advertising_analysis" && campaigns.success && campaigns.data.length ? "campaign" :
      evidence.category === "social" ? "social" : ["fulfillment", "inventory", "reviews"].includes(evidence.category) ? "operational" : "metric",
    title: evidence.title, observation: evidence.observation, window: evidence.window || null,
    sourceCount: evidence.sourceRecords.length, sourceRef: evidence.sourceRecords[0] ? `${evidence.sourceRecords[0].collection}:${evidence.sourceRecords[0].recordId}` : null,
    verified: item.verification?.passed === true, measurements: evidence.measurements,
    series: series.success ? series.data : [], campaigns: campaigns.success ? campaigns.data.slice(0, 3).map((campaign) => {
      const metadata = item.campaignMetadata?.find((entry) => entry.campaignId === campaign.campaignId);
      return { ...campaign, ...(metadata ? { name: metadata.name, platform: metadata.platform } : {}),
        ...(item.simulationRunId ? { url: `/dashboard/campaigns/${encodeURIComponent(campaign.campaignId)}?run=${encodeURIComponent(item.simulationRunId)}` } : {}) };
    }) : [], warnings: item.warnings });
}

export function externalCardView(source: ExternalSourceT): ExternalCard {
  const originalUrl = source.httpStatus === 200 ? sourceUrl(source.canonicalUrl, source.publisher, false) : null;
  const host = source.publisher || "";
  const assessment = source.claimSupport || "not_assessed";
  const unverified = !["contextual", "verified_accessible"].includes(source.status) || source.httpStatus !== 200 || source.temporalValidity !== "within_cutoff" || !source.excerptMatched || !["supported", "context_only"].includes(assessment);
  const kind = unverified ? "unverified" : /(?:^|\.)sec\.gov$|\.pdf(?:\?|$)/i.test(host) || /\.pdf(?:\?|$)/i.test(originalUrl || "") ? "official_document"
    : /(?:^|\.)status\./i.test(host) || /\/status\//i.test(originalUrl || "") ? "status_incident"
      : /(?:^|\.)(?:reddit\.com|x\.com|twitter\.com|bsky\.app)$/i.test(host) ? "social" : "article";
  return ExternalCardView.parse({ id: source.sourceId, kind, title: source.title, publisher: source.publisher,
    publisherIdentity: source.publisherIdentity || "retrieved_host_only", originalUrl,
    previewImageUrl: kind === "article" ? sourceUrl(source.previewImageUrl, source.publisher, true) : null,
    publishedAt: source.publishedAt, retrievedAt: source.retrievedAt, updatedAt: source.updatedAt,
    claim: source.proposedClaim, passage: source.excerpt, claimSupport: assessment, contextRelevance: source.contextRelevance || "not_assessed", status: source.status,
    limitations: source.limitations, httpStatus: source.httpStatus });
}
