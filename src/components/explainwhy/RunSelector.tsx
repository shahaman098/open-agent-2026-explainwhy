"use client";

import { virtualDate } from "@/lib/format";
import { useRun } from "./run-context";

/** Business + simulation run selector; the choice lives in the URL so every page and link shares it. */
export function RunSelector() {
  const { businessId, runs, runId, activeRunId, loaded, setRun } = useRun();
  const current = runs.find((r) => r.simulationRunId === runId);
  return (
    <div className="row" data-testid="run-selector">
      <span className="pill">business <code>{businessId}</code></span>
      <select className="select" style={{ width: "auto" }} value={runId ?? ""} onChange={(e) => setRun(e.target.value)} disabled={!runs.length} data-testid="dashboard-run-select" aria-label="Simulation run">
        {runId && !current ? <option value={runId}>{loaded ? `${runId} (not found)` : runId}</option> : null}
        {!runs.length && !runId ? <option value="">{loaded ? "No runs" : "Loading runs…"}</option> : null}
        {runs.map((r) => <option key={r.simulationRunId} value={r.simulationRunId}>{r.simulationRunId}{r.simulationRunId === activeRunId ? " (storefront)" : ""}</option>)}
      </select>
      {current ? <span className="muted small" data-testid="run-virtual-time">virtual {virtualDate(current.virtualTime)}</span> : null}
    </div>
  );
}
