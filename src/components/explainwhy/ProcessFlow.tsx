"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, q, STATUS_LABEL, statusClass, type Capabilities, type StageCapability } from "./api";
import { useRun } from "./run-context";
import { PipelineStagePanel } from "./PipelineStagePanel";
import { PageSkeleton } from "./PageSkeleton";

/** Clickable Observe → … → Learn pipeline. Statuses come from /api/intelligence/capabilities (measured data + implementation metadata). */
export function ProcessFlow() {
  const { runId, loaded } = useRun();
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const selectedStage = params.get("stage");
  const [result, setResult] = useState<{ runId: string | null; caps: Capabilities | null; error: string | null } | null>(null);
  const selected = useRef<string | null>(null);
  const requestSequence = useRef(0);
  const load = useCallback(async (id: string | null) => {
    const sequence = ++requestSequence.current;
    try { const c = await api<Capabilities>(`/api/intelligence/capabilities?${q({ simulationRunId: id })}`); if (selected.current === id && requestSequence.current === sequence) setResult({ runId: id, caps: c, error: null }); }
    catch (e) { if (selected.current === id && requestSequence.current === sequence) setResult({ runId: id, caps: null, error: (e as Error).message }); }
  }, []);
  useLayoutEffect(() => { selected.current = runId; requestSequence.current++; }, [runId]);
  useEffect(() => { if (!loaded) return; void (async () => { await load(runId); })(); }, [runId, loaded, load]);
  useEffect(() => { if (!loaded) return; const t = setInterval(() => void load(runId), 10_000); return () => clearInterval(t); }, [runId, loaded, load]);

  const pick = (id: string) => { const next = new URLSearchParams(params.toString()); next.set("stage", id); router.replace(`${pathname}?${next.toString()}`); };
  const current = result && result.runId === runId ? result : null;
  if (current?.error) return <div className="alert error">{current.error}</div>;
  if (!current?.caps) return <PageSkeleton variant="pipeline" label="Loading pipeline readiness" />;
  const caps = current.caps;
  const stage: StageCapability | undefined = caps.stages.find((s) => s.id === selectedStage) ?? caps.stages[0];
  return (
    <>
      <div className="card" data-testid="process-flow">
        <div className="card-head"><h3>Operational pipeline</h3><span>detector {caps.detectorVersion} · measured {new Date(caps.generatedAt).toLocaleTimeString("en-GB")}</span></div>
        <div className="card-body" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {caps.stages.map((s, i) => (
            <span key={s.id} className="row" style={{ gap: 6 }}>
              <button className={`chip ${stage?.id === s.id ? "active" : ""}`} onClick={() => pick(s.id)} data-testid={`stage-${s.id}`} data-status={s.status} aria-pressed={stage?.id === s.id}>
                {s.name} <span className={`pill ${statusClass(s.status)}`} style={{ marginLeft: 6 }}>{STATUS_LABEL[s.status] ?? s.status}</span>
              </button>
              {i < caps.stages.length - 1 ? <span className="muted" aria-hidden="true">→</span> : null}
            </span>
          ))}
        </div>
        <div className="card-body muted small">Operational, waiting-for-data, running and failed are derived from persisted records for the selected run. “Not implemented” and “partner integration pending” are implementation metadata, not health.</div>
      </div>
      {stage ? <PipelineStagePanel stage={stage} tools={caps.tools} /> : null}
      <div className="row"><Link href="/dev/simulator" className="btn sm">Control room</Link><Link href="/dev/monitor" className="btn sm">Anomaly monitor</Link><Link href="/demo-store" className="btn sm">Demo store</Link></div>
    </>
  );
}
