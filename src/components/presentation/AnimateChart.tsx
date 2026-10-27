"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clapperboard, Download, Pause, Play, RotateCcw, X } from "lucide-react";
import { presentationSvg } from "@/lib/presentation/render";
import { hasValues, type PresentationExport, type PresentationSpec } from "@/lib/presentation/schema";
import { workspaceFromSearch } from "@/lib/workspaces";
import "./presentation.css";

type Scope = PresentationExport["scope"];
interface Job { id: string; status: string; progress: number; error?: string }
export function AnimateChart({ presentation, scope, label = "Animate", compact = false }: { presentation: PresentationSpec; scope?: Scope; label?: string; compact?: boolean }) {
  const [frozen, setFrozen] = useState<{ presentation: PresentationSpec; scope: Scope } | null>(null);
  return <><button className={`animate-chart-button${compact ? " compact" : ""}`} type="button" title={`${label}: ${presentation.title}`} aria-label={`${label}: ${presentation.title}`} disabled={!hasValues(presentation)} onClick={event => {
    event.stopPropagation();
    const run = scope?.simulationRunId ?? new URLSearchParams(window.location.search).get("run");
    setFrozen({ presentation: structuredClone(presentation), scope: scope ?? { businessId: workspaceFromSearch(window.location.search), simulationRunId: run ?? "unselected" } });
  }}><Clapperboard size={compact ? 13 : 15}/>{label}</button>{frozen && createPortal(<PresentationDialog snapshot={frozen} onClose={() => setFrozen(null)}/>, document.body)}</>;
}

function PresentationDialog({ snapshot, onClose }: { snapshot: { presentation: PresentationSpec; scope: Scope }; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), canvas = useRef<HTMLDivElement>(null), clock = useRef(0), position = useRef(0), playingRef = useRef(true);
  const [theme, setTheme] = useState<PresentationExport["theme"]>("midnight"), [duration, setDuration] = useState<PresentationExport["duration"]>(snapshot.presentation.charts.length > 1 ? 20 : 8), [resolution, setResolution] = useState<PresentationExport["resolution"]>("1080p");
  const [title, setTitle] = useState(snapshot.presentation.title), [playing, setPlaying] = useState(true), [time, setTime] = useState(0), [job, setJob] = useState<Job | null>(null), [sending, setSending] = useState(false), [error, setError] = useState<string | null>(null);
  const request: PresentationExport = { ...snapshot, presentation: { ...snapshot.presentation, title: title || snapshot.presentation.title }, theme, duration, resolution };
  const requestRef = useRef(request);
  useEffect(() => { requestRef.current = request; });
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  useEffect(() => {
    let frame = 0, lastUi = 0;
    const draw = (now: number) => {
      const elapsed = clock.current ? Math.min((now - clock.current) / 1000, .15) : 0; clock.current = now;
      if (playingRef.current) position.current = (position.current + elapsed) % requestRef.current.duration;
      if (now - lastUi > 40) {
        if (canvas.current) canvas.current.innerHTML = presentationSvg(requestRef.current, position.current);
        setTime(position.current); lastUi = now;
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw); return () => cancelAnimationFrame(frame);
  }, []);
  const base = `/api/dev/presentations?${new URLSearchParams({ businessId: snapshot.scope.businessId, simulationRunId: snapshot.scope.simulationRunId })}`;
  const terminal = job && ["complete", "failed"].includes(job.status);
  useEffect(() => {
    if (!job?.id || terminal) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`${base}&id=${job.id}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Could not read the export status. Reopen the export with the same settings to retrieve it.");
        const result = await response.json(); if (!controller.signal.aborted) { setJob(result); setError(null); }
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1500); }
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [base, job?.id, terminal]);
  const exportVideo = async () => {
    setSending(true); setError(null); setJob(null);
    try {
      const response = await fetch("/api/dev/presentations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? "The video export could not start.");
      setJob(result);
    } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  };
  const pending = sending || Boolean(job && !terminal);
  const changed = () => { position.current = 0; setJob(null); setError(null); };
  const downloadSvg = () => {
    const url = URL.createObjectURL(new Blob([presentationSvg(request, duration - .1)], { type: "image/svg+xml" }));
    const link = document.createElement("a"); link.href = url; link.download = "ExplainWhy-presentation.svg"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <dialog ref={dialog} className="chart-presentation-dialog" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="presentation-title">
    <div className="presentation-top"><div><span className="presentation-kicker">DASHBOARD → PRESENTATION</span><h2 id="presentation-title">Bring your data to life.</h2><p>{snapshot.presentation.charts.length > 1 ? `${snapshot.presentation.charts.length} dashboard charts, composed into one presentation.` : "The same chart values, with presentation motion."}</p></div><button className="presentation-close" onClick={onClose} aria-label="Close animation studio"><X size={21}/></button></div>
    <div className="presentation-workspace"><div className="presentation-preview-column"><div className="presentation-preview" ref={canvas} aria-label="Animated presentation preview" role="img"/><div className="presentation-playback"><button onClick={() => { playingRef.current = !playingRef.current; setPlaying(playingRef.current); }} aria-label={playing ? "Pause preview" : "Play preview"}>{playing ? <Pause size={17}/> : <Play size={17}/>}</button><button onClick={() => { position.current = 0; }} aria-label="Replay animation"><RotateCcw size={16}/></button><input aria-label="Animation timeline" type="range" min="0" max={duration} step=".05" value={time} onChange={event => { position.current = Number(event.target.value); setTime(position.current); }}/><span>{time.toFixed(1)} / {duration}s</span></div><div className="presentation-snapshot"><span className="presentation-dot"/> Data snapshot captured when you opened this preview · {snapshot.presentation.synthetic ? "Synthetic business data" : "Recorded data"}</div></div>
    <aside className="presentation-settings"><h3>Make it presentation ready</h3><label>Presentation title<input value={title} maxLength={160} disabled={pending} onChange={event => { setTitle(event.target.value); changed(); }}/></label><label>Visual style<select value={theme} disabled={pending} onChange={event => { setTheme(event.target.value as typeof theme); changed(); }}><option value="midnight">Midnight · cinematic</option><option value="paper">Paper · clean and bright</option></select></label><div className="presentation-setting-pair"><label>Duration<select value={duration} disabled={pending} onChange={event => { setDuration(Number(event.target.value) as typeof duration); changed(); }}><option value="8">8 seconds</option><option value="12">12 seconds</option><option value="20">20 seconds</option><option value="60">60 seconds</option></select></label><label>Resolution<select value={resolution} disabled={pending} onChange={event => { setResolution(event.target.value as typeof resolution); changed(); }}><option value="1080p">Full HD</option><option value="4k">4K Ultra HD</option></select></label></div><div className="presentation-facts"><span>16:9 widescreen</span><span>MP4 · no audio</span><span>Same values and units</span></div><button className="presentation-export" onClick={() => void exportVideo()} disabled={pending || snapshot.scope.simulationRunId === "unselected"}><Download size={17}/>{pending ? `Exporting${job ? ` · ${job.progress}%` : "…"}` : "Export MP4"}</button>{pending && <><progress value={job?.progress ?? 0} max="100"/><p className="presentation-help">Rendering your presentation. You can close this preview; export with the same settings to retrieve it.</p></>}{error && <p className="presentation-error" role="alert">{error}</p>}{job?.status === "failed" && <p className="presentation-error" role="alert">{job.error}</p>}{job?.status === "complete" && <div className="presentation-ready" role="status"><strong>Your presentation is ready.</strong><a href={`${base}&id=${job.id}&download=video`}><Download size={15}/>Download MP4</a><a href={`${base}&id=${job.id}&download=data`}>Download source data</a></div>}<button className="presentation-still" onClick={downloadSvg}>Save presentation slide · SVG</button><p className="presentation-help">The animation changes the presentation, not the underlying data.</p></aside></div>
  </dialog>;
}
