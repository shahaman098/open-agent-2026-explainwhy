import { describe, expect, it } from "vitest";
import { externalCardView, internalCardView, scopedExternalSources, supportsPublicClaim } from "@/components/normal/evidence-card-model";
import type { EvidenceItem } from "@/components/normal/api";
import type { ExternalSourceT } from "@/intelligence/investigator/schemas";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExternalEvidenceCard } from "@/components/normal/EvidenceCards";

const item: EvidenceItem = { evidence: { businessId: "nike_eval", evidenceId: "ev_1", category: "sales", title: "Revenue change", observation: "Observed revenue declined.",
  window: { startAt: "2026-10-04T00:00:00Z", endAt: "2026-10-05T00:00:00Z" }, measurements: [{ metric: "revenue", value: 90, baseline: 120, unit: "GBP minor units" }],
  sourceRecords: [{ collection: "metric_snapshots", recordId: "snap_1" }], retrievedAt: "2026-10-06T00:00:00Z" },
  tool: "revenue_decomposition", dataOrigin: "simulated", collectionId: "col_1", toolRunId: "run_1", detail: { dailyRevenueMinor: [{ day: "2026-10-04", value: 90, hours: 24 }] }, warnings: [], input: null,
  verification: { passed: true, checks: [], resolvedSources: 1, unresolvedSources: [] } };
const source: ExternalSourceT = { schemaVersion: 1, sourceId: "src_1", claimId: "clm_1", investigationId: "inv_1", businessId: "nike_eval", simulationRunId: "run_1",
  originalUrl: "https://about.nike.com/news", canonicalUrl: "https://about.nike.com/news", title: "Official notice", publisher: "about.nike.com", author: null,
  publishedAt: "2026-10-01T00:00:00Z", updatedAt: null, retrievedAt: "2026-10-02T00:00:00Z", eventWindow: { startAt: "2026-10-01T00:00:00Z", endAt: "2026-10-02T00:00:00Z" },
  proposedClaim: "Nike published a notice", excerpt: "Nike published a notice", excerptMatched: true, contentHash: "a".repeat(64), status: "contextual", semanticAssessment: "model_only", claimSupport: "supported",
  publisherIdentity: "official_domain", previewImageUrl: "https://media.about.nike.com/photo.jpg", temporalValidity: "within_cutoff", limitations: [], duplicateOf: null, httpStatus: 200 };

describe("evidence presentation models", () => {
  it("derives metric values and trend only from verified canonical records", () => { const card = internalCardView(item); expect(card).toMatchObject({ kind: "metric", verified: true, sourceRef: "metric_snapshots:snap_1" }); expect(card.series).toEqual([{ day: "2026-10-04", value: 90, hours: 24 }]); });
  it("identifies campaign rows and uses scoped campaign metadata without inventing creative assets", () => { const card = internalCardView({ ...item, tool: "advertising_analysis", simulationRunId: "run_1", campaignMetadata: [{ campaignId: "cmp_1", name: "Running campaign", platform: "meta_ads" }], detail: { campaigns: [{ campaignId: "cmp_1", ctr: .02, baselineCtr: .03, roas: 1.2, spendMinor: 9000, attributedOrders: 3 }] } }); expect(card.kind).toBe("campaign"); expect(card.campaigns[0]).toMatchObject({ name: "Running campaign", platform: "meta_ads", spendMinor: 9000, url: "/dashboard/campaigns/cmp_1?run=run_1" }); });
  it("separates a supported official article from an unsupported claim on the same page", () => {
    expect(externalCardView(source)).toMatchObject({ kind: "article", claimSupport: "supported", publisherIdentity: "official_domain", previewImageUrl: "https://media.about.nike.com/photo.jpg" });
    expect(externalCardView({ ...source, claimSupport: "insufficient", status: "insufficient_evidence" })).toMatchObject({ kind: "unverified", claimSupport: "insufficient", previewImageUrl: null });
  });
  it("does not expose an unavailable candidate as a retrieved original link", () => { expect(externalCardView({ ...source, httpStatus: null, status: "unavailable" }).originalUrl).toBeNull(); });
  it("selects document, platform status, and anecdotal social variants by validated source host", () => {
    expect(externalCardView({ ...source, publisher: "www.sec.gov", canonicalUrl: "https://www.sec.gov/report", previewImageUrl: null }).kind).toBe("official_document");
    expect(externalCardView({ ...source, publisher: "ads.google.com", canonicalUrl: "https://ads.google.com/status/notice", previewImageUrl: null }).kind).toBe("status_incident");
    expect(externalCardView({ ...source, publisher: "reddit.com", canonicalUrl: "https://reddit.com/post", previewImageUrl: null }).kind).toBe("social");
  });
  it("drops a stored preview image that is not on the retrieved publisher host", () => { expect(externalCardView({ ...source, previewImageUrl: "https://other.example.com/tracker.jpg" }).previewImageUrl).toBeNull(); });
  it("renders the actual original source link and distinguishes unsupported claims", () => {
    const supported = renderToStaticMarkup(createElement(ExternalEvidenceCard, { source }));
    expect(supported).toContain('href="https://about.nike.com/news"');
    expect(supported).toContain('src="https://media.about.nike.com/photo.jpg"');
    const unsupported = renderToStaticMarkup(createElement(ExternalEvidenceCard, { source: { ...source, claimSupport: "insufficient", status: "insufficient_evidence" } }));
    expect(unsupported).toContain("Unverified research");
    expect(unsupported).not.toContain("investigation-source-image");
  });
  it("deduplicates record IDs within the exact business/run/investigation, retaining distinct same-page claim assessments", () => {
    const rejected = { ...source, sourceId: "src_rejected", claimId: "clm_rejected", claimSupport: "insufficient" as const, status: "insufficient_evidence" as const, duplicateOf: source.sourceId };
    const scope = { businessId: source.businessId, simulationRunId: source.simulationRunId, investigationId: source.investigationId };
    expect(scopedExternalSources([{ ...source, businessId: "other" }, { ...source, simulationRunId: "other" }, { ...source, investigationId: "other" }, source, source, rejected], scope)).toEqual([source, rejected]);
    expect(renderToStaticMarkup(createElement(ExternalEvidenceCard, { source: rejected }))).toContain("not independent corroboration");
  });
  it("never promotes rejected, unchecked, duplicate or unavailable claims into the supporting filter", () => {
    expect(supportsPublicClaim(source)).toBe(true);
    for (const changed of [{ status: "insufficient_evidence" as const }, { claimSupport: "insufficient" as const }, { excerptMatched: false }, { httpStatus: null }, { duplicateOf: "original" }, { temporalValidity: "after_cutoff" as const }]) {
      expect(supportsPublicClaim({ ...source, ...changed })).toBe(false);
    }
    expect(externalCardView({ ...source, status: "insufficient_evidence" }).kind).toBe("unverified");
  });
});
