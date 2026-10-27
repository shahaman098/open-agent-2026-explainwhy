"use client";

import { useMemo, useState } from "react";
import { virtualDate } from "@/lib/format";
import type { EvidenceItem } from "./api";
import type { ExternalSourceT, ReportT } from "@/intelligence/investigator/schemas";
import { ExternalEvidenceCard, InternalEvidenceCard } from "./EvidenceCards";
import { supportsPublicClaim } from "./evidence-card-model";

function fmt(m: { value: number; unit: string }): string {
  if (m.unit.startsWith("GBP minor")) return `£${(m.value / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}${m.unit.endsWith("/hour") ? "/h" : ""}`;
  if (m.unit === "ratio") return `${(m.value * 100).toFixed(2)}%`;
  return `${Number.isInteger(m.value) ? m.value : m.value.toFixed(3)} ${m.unit}`;
}

function Detail({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">[]</span>;
    if (typeof value[0] === "object" && value[0] !== null && depth < 2) {
      const cols = [...new Set(value.flatMap((r) => Object.keys(r as Record<string, unknown>)))].slice(0, 12);
      return (<div className="scroll-x"><table><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{(value as Array<Record<string, unknown>>).slice(0, 50).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className="small">{typeof r[c] === "object" && r[c] !== null ? JSON.stringify(r[c]) : String(r[c] ?? "—")}</td>)}</tr>)}</tbody></table>
        {value.length > 50 ? <div className="muted small">{value.length - 50} more rows stored</div> : null}</div>);
    }
    return <code className="small">{JSON.stringify(value).slice(0, 400)}</code>;
  }
  if (typeof value === "object") {
    return <div style={{ display: "grid", gap: 4 }}>{Object.entries(value as Record<string, unknown>).map(([k, v]) => <div key={k} className="small"><span className="muted">{k}:</span> <Detail value={v} depth={depth + 1} /></div>)}</div>;
  }
  return <span>{String(value)}</span>;
}

/** Real retrieved records with filters and expandable provenance; nothing here is derived from a scenario label. */
export function EvidenceExplorer({ items, total, simulationRunId, externalSources = [], report = null }: { items: EvidenceItem[]; total: number; simulationRunId: string; externalSources?: ExternalSourceT[]; report?: ReportT | null }) {
  const [tool, setTool] = useState<string>("all");
  const [origin, setOrigin] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [sourceType, setSourceType] = useState("all");
  const [verification, setVerification] = useState("all");
  const [role, setRole] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const tools = useMemo(() => [...new Set(items.map((i) => i.tool ?? "unknown"))].sort(), [items]);
  const origins = useMemo(() => [...new Set(items.map((i) => i.dataOrigin ?? "unknown"))].sort(), [items]);
  const categories = useMemo(() => [...new Set(items.map((i) => i.evidence.category))].sort(), [items]);
  const roleFor = (id: string) => report?.ledger.find((entry) => entry.evidenceId === id)?.role || "context";
  const roleMatches = (id: string) => role === "all" || roleFor(id) === role || roleFor(id) === "mixed";
  const shown = items.filter((i) => sourceType !== "external" && (tool === "all" || i.tool === tool) && (origin === "all" || i.dataOrigin === origin) && (category === "all" || i.evidence.category === category)
    && (verification === "all" || (i.verification?.passed === true) === (verification === "verified")) && roleMatches(i.evidence.evidenceId));
  const shownExternal = externalSources.filter((source) => sourceType !== "internal" && (verification === "all" || supportsPublicClaim(source) === (verification === "verified"))
    && (role === "support" ? supportsPublicClaim(source) : roleMatches(source.sourceId) || (role === "contradiction" && source.claimSupport === "contradictory")));
  return (
    <div className="card" data-testid="evidence-explorer">
      <div className="card-head"><h3>Evidence</h3><span>{shown.length + shownExternal.length} shown · {total + externalSources.length} total</span></div>
      <div className="card-body row" style={{ flexWrap: "wrap" }}>
        <label className="small">Source <select className="select" value={sourceType} onChange={(e) => setSourceType(e.target.value)} data-testid="filter-source"><option value="all">all</option><option value="internal">internal</option><option value="external">external</option></select></label>
        <label className="small">Verification <select className="select" value={verification} onChange={(e) => setVerification(e.target.value)} data-testid="filter-verification"><option value="all">all</option><option value="verified">verified</option><option value="unverified">unverified / rejected</option></select></label>
        <label className="small">Role <select className="select" value={role} onChange={(e) => setRole(e.target.value)} data-testid="filter-role"><option value="all">all</option><option value="support">supporting</option><option value="contradiction">contradictory</option><option value="context">context</option></select></label>
        <label className="small">Tool <select className="select" value={tool} onChange={(e) => setTool(e.target.value)} data-testid="filter-tool"><option value="all">all</option>{tools.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label className="small">Data origin <select className="select" value={origin} onChange={(e) => setOrigin(e.target.value)} data-testid="filter-origin"><option value="all">all</option>{origins.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label className="small">Category <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="filter-category"><option value="all">all</option>{categories.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
      </div>
      <div className="card-body" style={{ display: "grid", gap: 8 }}>
        {items.length === 0 && externalSources.length === 0 ? <div className="empty" data-testid="evidence-empty">No evidence collected yet. Use “Collect evidence” to run the deterministic retrieval policy.</div> : null}
        {items.length + externalSources.length > 0 && shown.length + shownExternal.length === 0 ? <div className="muted small">No evidence matches the filters.</div> : null}
        {shownExternal.length ? <h4 className="small muted">External sources</h4> : null}
        {shownExternal.map((source) => <div key={source.sourceId} id={`source-${source.sourceId}`}><ExternalEvidenceCard source={source} /></div>)}
        {shownExternal.length && shown.length ? <h4 className="small muted">Internal records</h4> : null}
        {shown.map((i) => {
          const e = i.evidence, isOpen = open === e.evidenceId;
          return (
            <div key={e.evidenceId} id={`evidence-${e.evidenceId}`} className="order" data-testid="evidence-item" data-tool={i.tool ?? ""}>
              <div className="row" style={{ justifyContent: "space-between", cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : e.evidenceId)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen(isOpen ? null : e.evidenceId); } }} role="button" aria-expanded={isOpen} data-testid="evidence-toggle">
                <strong>{e.title}</strong>
                <div className="row"><span className="pill">{i.tool ?? "unknown tool"}</span><span className="pill">{e.category}</span><span className={`pill ${i.dataOrigin === "simulated" ? "accent" : ""}`}>{i.dataOrigin ?? "origin unknown"}</span>{i.verification ? <span className={`pill ${i.verification.passed ? "ok" : "danger"}`}>{i.verification.passed ? "verified" : "unverified"}</span> : null}</div>
              </div>
              <InternalEvidenceCard item={i} compact />
              <span className="muted small">{e.window ? `${virtualDate(e.window.startAt)} → ${virtualDate(e.window.endAt)} · ` : ""}{e.sourceRecords.length} source records · retrieved {new Date(e.retrievedAt).toLocaleString("en-GB")} · <code>{e.evidenceId}</code></span>
              {isOpen ? (
                <div style={{ display: "grid", gap: 10 }} data-testid="evidence-detail">
                  <div className="scroll-x"><table><thead><tr><th>Measurement</th><th className="num">Value</th><th className="num">Baseline</th><th className="num">Change</th></tr></thead>
                    <tbody>{e.measurements.map((m) => <tr key={m.metric}><td><code>{m.metric}</code></td><td className="num">{fmt(m)}</td><td className="num">{m.baseline === undefined ? "—" : fmt({ value: m.baseline, unit: m.unit })}</td><td className="num">{m.baseline === undefined || m.baseline === 0 ? "—" : `${((m.value - m.baseline) / Math.abs(m.baseline) * 100).toFixed(1)}%`}</td></tr>)}</tbody></table></div>
                  {i.warnings.length ? <div className="alert info" data-testid="evidence-warnings">{i.warnings.map((w) => <div key={w} className="small">⚠ {w}</div>)}</div> : null}
                  {i.verification ? <div className="small" data-testid="evidence-verification"><strong>Verification:</strong> {i.verification.checks.map((c) => <span key={c.name} className={`pill ${c.passed ? "ok" : "danger"}`} style={{ marginRight: 4 }} title={c.note}>{c.name}</span>)} <span className="muted">{i.verification.resolvedSources} source references resolved</span></div> : null}
                  <div className="small"><strong>Source records</strong> <span className="muted">({e.sourceRecords.length}; collection:recordId, all stored in MongoDB or the verified reference set)</span>
                    <div className="scroll-x" style={{ maxHeight: 180, overflowY: "auto" }} data-testid="evidence-sources"><table><tbody>{e.sourceRecords.slice(0, 200).map((r) => <tr key={`${r.collection}:${r.recordId}`}><td><code>{r.collection}</code></td><td><code>{r.recordId}</code></td><td>{r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="small">source ↗</a> : r.collection === "business_events" ? <a href={`/api/dev/simulator/events?businessId=${encodeURIComponent(e.businessId)}&simulationRunId=${encodeURIComponent(simulationRunId)}&eventId=${encodeURIComponent(r.recordId)}`} target="_blank" rel="noreferrer" className="small" data-testid="source-link">open record ↗</a> : null}</td></tr>)}</tbody></table></div></div>
                  <div className="small"><strong>Tool input</strong> <code className="small">{JSON.stringify(i.input)}</code></div>
                  <div className="small"><strong>Retrieval detail</strong> <span className="muted">(internal record linked by evidenceId; comparisons, series and rows)</span><Detail value={i.detail} /></div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
