"use client";
import { useEffect, useState } from "react";
import { api, q } from "./api";

interface Option { evidenceId: string; metric: string; unit: string; title: string }
interface Animation { animationId: string; status: string; error: string | null }
interface AnimationView { animation: Animation; job: { status: string; message?: string; video: string | null; blend: string | null; studioUrl: string } | null }
export function FinancialAnimation({ investigationId, businessId, simulationRunId, evidenceVersion }: { investigationId: string; businessId: string; simulationRunId: string; evidenceVersion: string }) {
  const url = `/api/investigations/${encodeURIComponent(investigationId)}/animation?${q({ businessId, simulationRunId })}`;
  const [options, setOptions] = useState<Option[]>([]), [selection, setSelection] = useState(""), [enabled, setEnabled] = useState(false), [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<AnimationView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api<{ enabled: boolean; options: Option[] }>(url).then((result) => {
      if (!active) return;
      setEnabled(result.enabled); setOptions(result.options); setLoaded(true);
      setSelection((old) => result.options.some((o) => `${o.evidenceId}|${o.metric}` === old) ? old : result.options[0] ? `${result.options[0].evidenceId}|${result.options[0].metric}` : "");
    }).catch(() => { if (active) { setEnabled(false); setLoaded(true); setError("Could not load verified chart measurements. The investigation is still available."); } });
    return () => { active = false; };
  }, [url, evidenceVersion]);
  const animationId = view?.animation.animationId, terminal = view?.job && ["complete", "failed", "cancelled", "interrupted"].includes(view.job.status);
  useEffect(() => {
    if (!animationId || terminal || view?.animation.status !== "submitted") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const result = await api<AnimationView>(`${url}&animationId=${animationId}`); if (active) { setView(result); setError(null); } }
      catch (e) { if (active) setError((e as Error).message); }
      finally { if (active) timer = setTimeout(() => void poll(), 3000); }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [url, animationId, terminal, view?.animation.status]);
  const create = async () => {
    const option = options.find((o) => `${o.evidenceId}|${o.metric}` === selection); if (!option) return;
    setBusy(true); setError(null); setView(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ evidenceId: option.evidenceId, metric: option.metric }) });
      const result = await response.json();
      if (result.animation) {
        setView({ animation: result.animation, job: null });
        if (result.animation.status === "unknown" || result.animation.status === "submitting") setError("Submission outcome is not confirmed. Check Animation Studio before attempting another render.");
        else if (result.animation.status === "failed") setError(result.animation.error?.replaceAll("_", " ") || "Animation could not be started.");
      } else throw new Error(result.error?.message || "Animation could not be started.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const pending = view?.animation.status === "unknown" || view?.animation.status === "submitting" || (view?.animation.status === "submitted" && !terminal);
  return <div data-testid="financial-animation">
    <h4>Animate this comparison</h4>
    <p className="muted small">Watch verified baseline and current figures on the same scale. Bar growth illustrates the comparison; it does not represent a measured time series.</p>
    {enabled && options.length ? <div className="row">
      <label>Measurement <select aria-label="Animation measurement" value={selection} disabled={busy || Boolean(pending)} onChange={(event) => setSelection(event.target.value)}>
        {options.map((option) => <option key={`${option.evidenceId}|${option.metric}`} value={`${option.evidenceId}|${option.metric}`}>{option.metric.replaceAll("_", " ")} · {option.unit} · {option.evidenceId.slice(-8)}</option>)}
      </select></label>
      <button className="btn" disabled={busy || Boolean(pending)} onClick={() => void create()}>{busy ? "Sending…" : "Create chart animation"}</button>
    </div> : <p className="muted small">{!loaded ? "Loading verified measurements…" : enabled ? "A verified measurement with a baseline is needed." : "Chart animation is available when Animation Studio is enabled on the host Mac."}</p>}
    {error ? <p role="alert" className="alert error">{error}</p> : null}
    {view ? <p className="small" aria-live="polite">Animation: {view.job?.status || view.animation.status}{view.job?.message ? ` · ${view.job.message}` : ""}</p> : null}
    {view?.job?.video ? <video controls preload="metadata" src={view.job.video} style={{ width: "100%", maxHeight: 440 }} aria-label="Verified financial comparison animation" /> : null}
    {view?.job?.blend ? <a className="btn" href={view.job.blend}>Download editable Blender project</a> : null}
    {view?.job ? <p><a href={view.job.studioUrl} target="_blank" rel="noreferrer">Open Animation Studio</a></p> : null}
  </div>;
}
