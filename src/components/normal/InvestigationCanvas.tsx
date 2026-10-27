"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ChartNoAxesCombined, CircleHelp, FileCheck2, GitBranch, ShieldCheck, X } from "lucide-react";

export type CanvasSection = "signal" | "evidence" | "decision" | "outcome";
const sections: CanvasSection[] = ["signal", "evidence", "decision", "outcome"];
const names = { signal: "Signal", evidence: "Evidence", decision: "Decision / Plan", outcome: "Outcome" };
const icons = { signal: ArrowDownRight, evidence: ChartNoAxesCombined, decision: GitBranch, outcome: ShieldCheck };

export interface CanvasBlock {
  icon?: ReactNode;
  title: string;
  value?: string;
  detail?: string;
  status?: string;
  preview?: ReactNode;
}

export function ComparisonPreview({ label, before, after, format }: { label: string; before: number; after: number; format: (value: number) => string }) {
  const maximum = Math.max(before, after, 0.00001);
  return <div className="decision-preview" role="img" aria-label={`${label}: baseline ${format(before)}, observed ${format(after)}`}>
    <span>{label}</span><div><small>Baseline</small><i><b style={{ width: `${Math.max(2, before / maximum * 100)}%` }} /></i><strong>{format(before)}</strong></div><div><small>Observed</small><i><b style={{ width: `${Math.max(2, after / maximum * 100)}%` }} /></i><strong>{format(after)}</strong></div>
  </div>;
}

export function InvestigationCanvas({ title, summary, business, run, area, severity, lifecycle, blocks, panels, footer, loading, error, recordId, testId = "incident-story" }: {
  title: string; summary: string; business: string; run: string; area: string; severity?: string | null; lifecycle: string;
  blocks: Record<CanvasSection, CanvasBlock[]>; panels: Record<CanvasSection, ReactNode>; footer: ReactNode; loading?: boolean; error?: string | null; recordId?: string; testId?: string;
}) {
  const [active, setActive] = useState<CanvasSection | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const panelBody = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const headingId = useId();
  const isOpen = active !== null;
  const open = (section: CanvasSection) => { returnFocus.current = document.activeElement as HTMLElement; setActive(section); };
  useEffect(() => {
    if (!isOpen) return;
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = overflow; returnFocus.current?.focus({ preventScroll: true }); };
  }, [isOpen]);
  useEffect(() => {
    const followCitation = () => {
      if (!/^#(?:evidence-|source-)/.test(window.location.hash)) return;
      setActive("evidence");
    };
    window.addEventListener("hashchange", followCitation);
    return () => window.removeEventListener("hashchange", followCitation);
  }, []);
  useEffect(() => {
    panelBody.current?.scrollTo({ top: 0 });
    if (active !== "evidence" || !window.location.hash) return;
    const frame = requestAnimationFrame(() => document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return <div className="decision-workspace" data-testid={testId}>
    <header className="decision-incident" data-testid="incident-overview" data-investigation-id={recordId}><div><div className="decision-breadcrumb">Investigations <span>/</span> {area}</div><h1>{title}</h1><p>{summary}</p><div className="decision-scope"><span>{business}</span><span>{run}</span></div></div><div className="decision-incident-state">{severity ? <span className="decision-severity">{severity}</span> : null}<strong data-testid="investigation-status">{lifecycle}</strong></div></header>
    {error ? <p role="status" className="decision-service-note">{error}</p> : null}
    <section className="decision-board card" aria-label="Investigation decision path" data-testid="decision-canvas" aria-busy={loading}>
      <div className="decision-board-head"><div><GitBranch size={21} strokeWidth={1.7} aria-hidden="true" /><h2>Decision path</h2><span>{area}</span></div><button className="btn sm" onClick={() => open("decision")}><CircleHelp size={15} aria-hidden="true" /> Why this decision?</button></div>
      <div className="decision-flow">
        <svg className="decision-connectors" viewBox="0 0 1200 330" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="decision-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 7 3.5 0 7" fill="none" stroke="currentColor" /></marker></defs><path d="M180 165H465M465 165H760M760 165H1035" markerEnd="url(#decision-arrow)" /></svg>
        {sections.map((section, index) => { const Icon = icons[section]; return <div className={`decision-column decision-column-${section}`} key={section} data-testid={`canvas-${section}`}><div className="decision-column-heading"><span>{String(index + 1).padStart(2, "0")}</span><h3>{names[section]}</h3></div><div className="decision-column-cards">{blocks[section].map((block, item) => <button key={`${section}:${item}`} className={`decision-node ${section === "decision" ? "decision-node-primary" : ""}`} onClick={() => open(section)} aria-haspopup="dialog" data-testid={item === 0 ? `open-${section}-details` : undefined}><div className="decision-node-top"><span className="decision-node-icon">{block.icon ?? <Icon size={19} strokeWidth={1.6} aria-hidden="true" />}</span>{block.status ? <span className="decision-node-status">{block.status}</span> : <ArrowRight className="decision-node-open" size={14} aria-hidden="true" />}</div><strong>{block.title}</strong>{block.value ? <b className="decision-node-value">{block.value}</b> : null}{block.detail ? <p>{block.detail}</p> : null}{block.preview}{section === "decision" ? <span className="decision-node-inspect">Review decision <ArrowRight size={13} aria-hidden="true" /></span> : null}</button>)}</div></div>; })}
      </div>
      <footer className="decision-board-foot"><FileCheck2 size={17} aria-hidden="true" /><div>{footer}</div><span>Saved records · this run</span></footer>
    </section>
    <p className="decision-hint">Select any block to inspect its evidence, controls and history.</p>
    {active ? <dialog ref={dialog} className="decision-drawer" aria-labelledby={headingId} onCancel={() => setActive(null)} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setActive(null); } }}>
      <div className="decision-drawer-head"><div><span>Investigation details</span><h2 id={headingId}>{names[active]}</h2><p>{run}</p></div><button className="decision-drawer-close" onClick={() => setActive(null)} aria-label="Close details" autoFocus><X size={21} /></button></div>
      <nav className="decision-drawer-tabs" aria-label="Detail sections">{sections.map((section) => <button key={section} onClick={() => setActive(section)} aria-current={active === section ? "page" : undefined}>{names[section]}</button>)}</nav>
      <div ref={panelBody} className="decision-drawer-body" data-testid={`detail-${active}`}>{panels[active]}</div>
    </dialog> : null}
  </div>;
}
