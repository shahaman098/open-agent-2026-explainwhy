"use client";

import { useState } from "react";
import { statusClass, type CollectionDoc, type ToolRun } from "./api";

/** Tool execution timeline: what was queried, with which parameters, how long it took and what came back. */
export function EvidenceToolTrace({ collections, runs }: { collections: CollectionDoc[]; runs: ToolRun[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (collections.length === 0) return (
    <div className="card" data-testid="tool-trace"><div className="card-head"><h3>Tool execution timeline</h3></div><div className="card-body muted small">No evidence collection has run for this investigation.</div></div>
  );
  return (
    <div className="card" data-testid="tool-trace">
      <div className="card-head"><h3>Tool execution timeline</h3><span>{collections.length} collection run(s) · {runs.length} tool execution(s)</span></div>
      {collections.map((c) => {
        const mine = runs.filter((r) => r.collectionId === c.collectionId);
        return (
          <div key={c.collectionId} className="card-body" style={{ display: "grid", gap: 8 }} data-testid="collection-run">
            <div className="row" style={{ flexWrap: "wrap" }}>
              <span className={`pill ${statusClass(c.status)}`} data-testid="collection-status">{c.status}</span><span className="pill">{c.mode}</span><span className="pill">attempt {c.attempt}</span>
              <span className="small">cutoff {c.cutoff} · incident window {c.windows.incident.startAt} → {c.windows.incident.endAt}{c.windows.baseline ? ` · baseline ${c.windows.baseline.startAt} → ${c.windows.baseline.endAt}` : " · no baseline"}</span>
              <span className="muted small">started {new Date(c.startedAt).toLocaleString("en-GB")}{c.completedAt ? `, finished ${new Date(c.completedAt).toLocaleTimeString("en-GB")}` : ""} · <code>{c.collectionId}</code></span>
            </div>
            {c.error ? <div className="alert error small">{c.error}</div> : null}
            <div className="scroll-x"><table>
              <thead><tr><th>#</th><th>Tool</th><th>Role</th><th>Status</th><th className="num">Duration</th><th className="num">Results</th><th className="num">Evidence</th><th className="num">Sources</th><th>Outcome</th></tr></thead>
              <tbody>
                {c.selectedTools.map((s, idx) => {
                  const r = mine.find((x) => x.tool === s.tool);
                  const isOpen = open === `${c.collectionId}:${s.tool}`;
                  return [
                    <tr key={s.tool} onClick={() => setOpen(isOpen ? null : `${c.collectionId}:${s.tool}`)} style={{ cursor: "pointer" }} data-testid="tool-run" data-tool={s.tool} data-status={r?.status ?? "pending"}>
                      <td>{idx + 1}</td><td><code>{s.tool}</code><div className="muted small">{s.reason}</div></td><td>{s.role.replaceAll("_", " ")}</td>
                      <td><span className={`pill ${r ? (r.status === "completed" ? "ok" : r.status === "failed" ? "danger" : "") : "warn"}`}>{r?.status ?? "not recorded"}</span></td>
                      <td className="num">{r ? `${r.durationMs} ms` : "—"}</td><td className="num">{r?.resultCount ?? "—"}</td><td className="num">{r?.evidenceIds.length ?? "—"}</td><td className="num">{r?.sourceRecordCount ?? "—"}</td>
                      <td className="small">{r?.error ? <span className="pill danger">{r.error}</span> : r?.emptyResult ? <span className="muted">{r.emptyResult}</span> : r ? "evidence persisted" : ""}</td>
                    </tr>,
                    isOpen && r ? (
                      <tr key={`${s.tool}-detail`}><td colSpan={9} className="small" data-testid="tool-run-detail">
                        <div><strong>Parameters</strong> <code>{JSON.stringify(r.input)}</code></div>
                        <div><strong>Data sources</strong> {r.dataSources.map((d) => <span key={`${d.collection ?? d.externalSource}-${d.description}`} className="pill" style={{ marginRight: 4 }} title={d.description}>{d.collection ?? d.externalSource} · {d.origin}</span>)}</div>
                        {r.warnings.length ? <div><strong>Warnings</strong> {r.warnings.map((w) => <div key={w}>⚠ {w}</div>)}</div> : null}
                        <div className="muted">{r.startedAt} → {r.completedAt} · <code>{r.toolRunId}</code></div>
                      </td></tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table></div>
          </div>
        );
      })}
    </div>
  );
}
