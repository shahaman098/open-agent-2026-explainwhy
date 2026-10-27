"use client";

import type { PlanHandoffT } from "@/execution/types";
import type { ProposedPlanT } from "@normal/contracts";
import { ArrowUpRight, Filter, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlanReview, type ExecutionView } from "../partner/PlanReview";
import { api, q } from "./api";
import { PageSkeleton } from "./PageSkeleton";
import { useRun } from "./run-context";

type Row = ExecutionView & { plan: ProposedPlanT };
const rowStatus = (row: Row) => row.run?.status ?? row.approval?.decision ?? "awaiting_review";
const statusLabel = (status: string) => status.replaceAll("_", " ");

export function Approvals() {
  const { runId } = useRun();
  return <ApprovalsContent key={runId} />;
}

function ApprovalsContent() {
  const { businessId, runId, loaded, withRun } = useRun();
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<PlanHandoffT | null>(null);
  const [snapshot, setSnapshot] = useState<ExecutionView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!runId) return;
    try {
      const result = await api<{ plans: Row[] }>(`/api/approvals?${q({ businessId, simulationRunId: runId })}`);
      setRows(result.plans);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Plans could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [businessId, runId]);

  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  const inspect = async (row: Row) => {
    const nextRequest = ++requestId.current;
    setSelected(`${row.plan.planId}:${row.plan.planVersion}`);
    setHandoff(null);
    setSnapshot(row);
    setReady(false);
    setError("");
    try {
      const result = await api<PlanHandoffT>(`/api/plans/${encodeURIComponent(row.plan.planId)}?${q({ businessId, simulationRunId: runId, planVersion: row.plan.planVersion })}`);
      if (nextRequest !== requestId.current) return;
      setHandoff(result);
      setReady(true);
    } catch (cause) {
      if (nextRequest !== requestId.current) return;
      setHandoff(row.reviewedHandoff);
      if (!row.run) setError(cause instanceof Error ? cause.message : "Plan could not be opened.");
    }
  };

  const act = async (action: string, body: unknown) => {
    if (!handoff || !runId) return;
    setBusy(true);
    setError("");
    try {
      const query = q({ businessId, simulationRunId: runId, planVersion: handoff.plan.planVersion });
      await api(`/api/plans/${encodeURIComponent(handoff.plan.planId)}/${action}?${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setSnapshot(await api<ExecutionView>(`/api/plans/${encodeURIComponent(handoff.plan.planId)}/executions?${query}`));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const statuses = [...new Set(rows.map(rowStatus))].sort();
  const visible = rows.filter((row) => (filter === "all" || rowStatus(row) === filter) && (!search.trim() || row.plan.objective.toLowerCase().includes(search.trim().toLowerCase())));
  if (!loaded || (runId && loading)) return <PageSkeleton variant="section" />;
  if (!runId) return <div className="record-empty">Select a run to review its plans.</div>;

  return <div className="approval-page" data-testid="approvals-page">
    <section className="card record-index" aria-label="Proposed plans">
      <header className="record-index-head"><div><h2>Approvals</h2><p>Review proposed changes before they reach the simulator.</p></div><div className="record-index-head-actions"><span className="record-index-count">{rows.length} {rows.length === 1 ? "plan" : "plans"}</span><Link href={withRun("/dashboard/activity")}>View activity <ArrowUpRight size={15} aria-hidden="true" /></Link></div></header>
      {rows.length > 4 ? <div className="record-index-filters"><label className="record-filter"><Search size={16} aria-hidden="true" /><span className="sr-only">Search plans</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search plans" /></label><label className="record-filter"><Filter size={15} aria-hidden="true" /><span className="sr-only">Filter plans by status</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label></div> : null}
      {error ? <div className="record-alert" role="alert">{error}</div> : null}
      {rows.length ? <div className="approval-list">{visible.map((row) => {
        const key = `${row.plan.planId}:${row.plan.planVersion}`;
        const active = selected === key;
        return <button type="button" key={key} className={`approval-list-row${active ? " selected" : ""}`} onClick={() => void inspect(row)} aria-pressed={active}>
          <span className="approval-list-main"><strong>{row.plan.objective}</strong><small>Version {row.plan.planVersion} · {row.plan.actions.length} {row.plan.actions.length === 1 ? "proposed action" : "proposed actions"}</small></span>
          <span className={`record-badge approval-${rowStatus(row)}`}>{statusLabel(rowStatus(row))}</span><ArrowUpRight size={18} aria-hidden="true" />
        </button>;
      })}{visible.length === 0 ? <div className="record-empty">No plans match these filters.</div> : null}</div> : <div className="record-empty">No plans are waiting in this run. Open an investigation to prepare a proposal.</div>}
    </section>
    {selected && !handoff ? <PageSkeleton variant="section" /> : null}
    {handoff && snapshot ? <PlanReview key={selected} handoff={handoff} snapshot={snapshot} ready={ready} busy={busy} investigationHref={withRun(`/dashboard/investigations/${encodeURIComponent(handoff.plan.investigationId)}`)} onApprove={(ids, decision, comment) => act("approve", { decision, approvedActionIds: ids, comment })} onExecute={() => act("execute", { approvalId: snapshot.approval?.approvalId })} /> : null}
  </div>;
}
