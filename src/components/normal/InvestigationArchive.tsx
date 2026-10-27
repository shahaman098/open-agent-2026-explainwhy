"use client";

import { useEffect, useState } from "react";
import type { PlanningView } from "@/planner/schemas";
import { api, q } from "./api";
import { InvestigationCanvas } from "./InvestigationCanvas";

/** Planning-only Stage 5 archives have no live incident, evidence API or executable handoff. */
export function InvestigationArchive({ investigationId, businessId, simulationRunId }: { investigationId: string; businessId: string; simulationRunId: string }) {
  const [view, setView] = useState<PlanningView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api<PlanningView>(`/api/investigations/${encodeURIComponent(investigationId)}/planning?${q({ businessId, simulationRunId })}`)
      .then((result) => { if (active) setView(result); })
      .catch((cause: Error) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [businessId, investigationId, simulationRunId]);
  if (error) return <div className="alert error" role="alert">Advisory archive unavailable: {error}</div>;
  if (!view) return <div className="incident-loading">Loading saved advisory investigation…</div>;
  const archive = view.job?.archive;
  if (!archive || !view.advisoryOnly) return <div className="empty" data-testid="investigation-not-found">No planning-only advisory archive exists for this exact business, run and investigation.</div>;
  const report = archive.report;
  const strategies = view.job?.output?.strategies ?? [];
  const selected = strategies.find((item) => item.key === view.job?.selectedKey);
  const recommended = strategies.find((item) => item.key === view.job?.output?.recommendedKey);
  const strategy = selected ?? recommended;
  const brief = (text: string) => text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
  return <InvestigationCanvas recordId={investigationId} testId="advisory-archive" title="Checkout: coupon failures" summary={brief(report.diagnosis.summary)} business={businessId} run={simulationRunId} area="Checkout archive" lifecycle="Advisory only"
    blocks={{ signal: [{ title: report.diagnosis.primaryCause.replaceAll("_", " "), value: "Saved finding", detail: "Provisional diagnosis from the Stage 5 report" }], evidence: [{ title: `${report.ledger.length} archived references`, detail: "Original source records unavailable" }], decision: [{ title: "Further investigation", value: "Advisory only", detail: brief(strategy?.title || "Review the saved diagnosis"), status: `${strategies.length} strategies` }], outcome: [{ title: "No executable action", detail: "No approval or business outcome to assess" }] }}
    footer={<><strong>Saved advisory result</strong><span>{strategies.length} strategies</span><span>Planning-only archive</span></>}
    panels={{
      signal: <section className="canvas-detail-intro"><span>Saved Stage 5 diagnosis</span><h3>{report.diagnosis.primaryCause.replaceAll("_", " ")}</h3><p>{report.diagnosis.summary}</p><div className="canvas-detail-caution"><strong>Uncertainty</strong><p>{report.handoff.uncertainty.join(" ") || report.executiveBrief.certainty}</p></div><details><summary>Full investigation report</summary>{report.sections.map((item) => <section className="canvas-detail-section" key={item.title}><h3>{item.title}</h3><p>{item.text}</p></section>)}</details></section>,
      evidence: <section className="canvas-detail-intro"><span>Saved source references</span><h3>Archived evidence</h3><p>The original run was cleaned after Stage 5. The validated report and its references were retained; live source records were not recreated.</p>{report.claims.filter((claim) => claim.evidenceIds.length).map((claim) => <section className="canvas-detail-section" key={claim.claimId}><h3>{claim.support.replaceAll("_", " ")} finding</h3><p>{claim.claim}</p><p className="small muted">Archived references: {claim.evidenceIds.join(", ")}</p></section>)}<details><summary>Archive identity</summary><p>{investigationId}</p><p>Original artifact hash: {archive.artifactHash}</p></details></section>,
      decision: <section className="canvas-detail-intro" data-testid="strategy-comparison"><span>Saved advisory strategies</span><h3>{strategy?.title || "Further investigation"}</h3><p>{strategy?.explanation}</p><div className="canvas-detail-caution"><strong>No adapter action</strong><p>No supported repair adapter was proposed. This archive cannot create an executable handoff.</p></div><div className="canvas-archive-strategies">{strategies.map((item) => <article key={item.key}><span>{item.key === view.job?.output?.recommendedKey ? "Recommended" : "Alternative"}</span><h3>{item.title}</h3><p>{item.explanation}</p><details><summary>Benefits, risks and references</summary><p>Benefit: {item.benefit}</p><p>Downside: {item.downside}</p><p>Uncertainty: {item.uncertainty}</p><p>Evidence: {item.evidenceIds.join(", ")}</p></details></article>)}</div></section>,
      outcome: <section className="canvas-detail-intro"><span>Execution and measurement</span><h3>Advisory only</h3><p>No executable proposal, approval, adapter receipt or subsequent business assessment belongs to this archive.</p></section>,
    }} />;
}
