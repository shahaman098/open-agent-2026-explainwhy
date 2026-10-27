"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type RunsResponse } from "./api";

interface RunState {
  businessId: string;
  runs: RunsResponse["runs"];
  activeRunId: string | null;
  /** Selected run: the `run` query parameter, else the storefront's active run, else the first run. */
  runId: string | null;
  loaded: boolean;
  unavailable: boolean;
  error: string | null;
  setRun: (id: string) => void;
  /** Appends the current run selection to an internal link. */
  withRun: (href: string) => string;
  reloadRuns: () => Promise<void>;
}

const RunContext = createContext<RunState | null>(null);

export function RunProvider({ children }: { children: ReactNode }) {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const requested = params.get("run");
  const [runs, setRuns] = useState<RunsResponse["runs"]>([]);
  const [activeRunId, setActive] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadRuns = useCallback(async () => {
    try {
      const r = await api<RunsResponse>("/api/dev/simulator/runs");
      setRuns(r.runs); setActive(r.activeSimulationRunId); setError(null);
    } catch (e) {
      if ((e as { status?: number }).status === 404) setUnavailable(true); else setError((e as Error).message);
    } finally { setLoaded(true); }
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => { if (!cancelled) await reloadRuns(); })();
    return () => { cancelled = true; };
  }, [reloadRuns]);

  // Keep the operator's choice in controlled state so panels and links switch in the same
  // render as the selector, without waiting for the URL navigation transition to finish.
  const [selectedRun, setSelectedRun] = useState<string | null>(requested);
  const selectedRunRef = useRef<string | null>(requested);
  const runId = selectedRun ?? activeRunId ?? runs[0]?.simulationRunId ?? null;

  // Back/forward restores the URL state. Router replace() does not emit popstate, so rapid
  // selector changes cannot be rolled back by a late query-param render.
  useEffect(() => {
    const onPopState = () => {
      const next = new URL(window.location.href).searchParams.get("run");
      selectedRunRef.current = next;
      setSelectedRun(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const value = useMemo<RunState>(() => ({
    businessId: "nike_demo", runs, activeRunId, runId, loaded, unavailable, error, reloadRuns,
    setRun: (id: string) => {
      if (selectedRunRef.current === id) return;
      selectedRunRef.current = id;
      setSelectedRun(id);
      const next = new URLSearchParams(window.location.search);
      next.set("run", id);
      startTransition(() => router.replace(`${pathname}?${next.toString()}`));
    },
    withRun: (href: string) => (runId ? `${href}${href.includes("?") ? "&" : "?"}run=${encodeURIComponent(runId)}` : href),
  }), [runs, activeRunId, runId, loaded, unavailable, error, reloadRuns, pathname, router]);
  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
}

export function useRun(): RunState {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error("useRun must be used inside RunProvider");
  return ctx;
}
