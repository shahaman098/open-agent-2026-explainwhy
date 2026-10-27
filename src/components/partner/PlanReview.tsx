"use client";

import type { ActionProposalT, AgentMissionT, PlanApprovalT } from "@normal/contracts";
import type { PlanHandoffT } from "@/execution/types";
import { agentDisplayName } from "@/agents/roles";
import { ArrowUpRight, Check, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export interface ExecutionView { approval: PlanApprovalT | null; reviewedHandoff: PlanHandoffT | null; run: { status: string; startedAt: string } | null; executions: import("@normal/contracts").ActionExecutionT[]; missions: AgentMissionT[] }

const sentence = (value: string, max = 270) => {
  const first = value.trim().split(/\n|(?<=[.!?])\s+/)[0];
  const text = first.length > 45 ? first : value.trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};
const date = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(value));
const money = (minor: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
const label = (value: string) => value.replaceAll(/[._]/g, " ");

function actionFacts(action: ActionProposalT): Array<{ label: string; value: string }> {
  switch (action.actionType) {
    case "ads.set_daily_budget": return [{ label: "Campaign", value: action.params.campaignId }, { label: "New daily budget", value: money(action.params.newDailyBudgetMinor, action.params.currency) }];
    case "customer.send_delay_notice": return [{ label: "Recipients", value: `${action.params.orderIds.length} orders` }, { label: "Message", value: "Delivery delay notice" }];
    case "storefront.publish_banner": return [{ label: "Banner message", value: action.params.message }, { label: "Ends", value: date(action.params.expiresAt) }];
    case "marketing.publish_ad": return [{ label: "Campaign", value: action.params.campaignId }, { label: "Headline", value: action.params.headline }, { label: "Spend limit", value: money(action.params.spendLimitMinor, action.params.currency) }];
    case "customer.send_promotion_email": return [{ label: "Recipients", value: `${action.params.customerIds.length} customers` }, { label: "Promotion", value: action.params.promoCode }];
    case "storefront.create_discount": return [{ label: "Discount", value: `${action.params.percentOff}% off` }, { label: "Products", value: `${action.params.productIds.length} products` }, { label: "Limit", value: `${action.params.maxRedemptions} redemptions` }];
  }
}

export function PlanReview({ handoff, snapshot, onApprove, onExecute, busy, ready, investigationHref }: {
  handoff: PlanHandoffT;
  snapshot: ExecutionView;
  onApprove: (ids: string[], decision: "approved" | "rejected" | "changes_requested", comment: string) => Promise<void>;
  onExecute: () => Promise<void>;
  busy: boolean;
  ready: boolean;
  investigationHref: string;
}) {
  const { plan, diagnosis, evidence } = handoff;
  const all = plan.actions.map((action) => action.actionId);
  const [selected, setSelected] = useState(all);
  const [note, setNote] = useState("");
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    let active = true;
    const update = () => { if (active) setExpired(Date.parse(plan.expiresAt) <= Date.now()); };
    queueMicrotask(update);
    const timer = window.setInterval(update, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [plan.expiresAt]);
  const decided = Boolean(snapshot.approval);
  const displayedSelection = snapshot.approval?.approvedActionIds ?? selected;
  const decisionLabel = snapshot.run?.status ?? snapshot.approval?.decision ?? (expired ? "expired" : "awaiting review");

  return <section className="card plan-review" aria-label="Selected plan review">
    <header className="plan-review-head"><div><span className="plan-kicker">Plan review · version {plan.planVersion}</span><h2>{plan.objective}</h2></div><span className={`record-badge approval-${decisionLabel.replaceAll(" ", "_")}`}>{label(decisionLabel)}</span></header>
    <div className="plan-review-intro"><p>{sentence(plan.summary)}</p><details className="plan-disclosure"><summary>Read full proposal</summary><p>{plan.summary}</p></details></div>
    <div className="plan-review-meta"><div><small>Expires</small><strong>{date(plan.expiresAt)}</strong></div><div><small>Proposed actions</small><strong>{plan.actions.length}</strong></div><div><small>Diagnosis</small><strong>{label(diagnosis.primaryCause)}</strong></div><Link href={investigationHref}>View investigation <ArrowUpRight size={15} aria-hidden="true" /></Link></div>

    <div className="plan-section-head"><div><span className="plan-kicker">Decision</span><h3>Proposed actions</h3></div><span>{displayedSelection.length} of {all.length} selected</span></div>
    <div className="plan-actions">{plan.actions.map((action) => <article className="plan-action" key={action.actionId}>
      <label className="plan-action-head"><input type="checkbox" disabled={decided || busy || expired} checked={displayedSelection.includes(action.actionId)} onChange={() => setSelected((current) => current.includes(action.actionId) ? current.filter((id) => id !== action.actionId) : [...current, action.actionId])} /><span><strong>{action.title}</strong><small>{agentDisplayName(action.agent)} · {action.risk} risk</small></span></label>
      <div className="plan-action-facts">{actionFacts(action).map((fact) => <div key={fact.label}><small>{fact.label}</small><strong>{fact.value}</strong></div>)}</div>
      <p>{sentence(action.rationale, 330)}</p>
      {action.rationale.length > 330 || action.dependsOnActionIds.length ? <details className="plan-disclosure"><summary>Rationale and dependencies</summary><p>{action.rationale}</p>{action.dependsOnActionIds.length ? <p>Runs after {action.dependsOnActionIds.length} preceding {action.dependsOnActionIds.length === 1 ? "action" : "actions"}.</p> : null}</details> : null}
    </article>)}</div>

    <details className="plan-evidence"><summary>Supporting evidence <span>{evidence.length} sources</span></summary><div>{evidence.map((item) => <p key={item.evidenceId}>{item.observation}</p>)}</div></details>

    <div className="plan-decision" aria-label="Approval decision">
      <div><span className="plan-kicker">Human decision</span><h3>{decided ? "Decision recorded" : "Ready for your review"}</h3><p>{decided ? "This exact plan version already has a recorded decision." : "Selecting an action does not approve or execute it."}</p></div>
      {expired && !decided ? <p className="plan-expired"><CircleAlert size={16} aria-hidden="true" /> This proposal has expired. Prepare a new plan version from the investigation.</p> : null}
      {!decided ? <><label className="plan-comment"><span className="sr-only">Review comment</span><textarea aria-label="Review comment" placeholder="Optional review comment" value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="plan-buttons"><button className="btn primary" disabled={busy || !ready || expired} onClick={() => onApprove(all, "approved", note)}>Approve exact version</button><button className="btn" disabled={busy || !ready || expired || !selected.length} onClick={() => onApprove(selected, "approved", note)}>Approve selected</button><button className="btn" disabled={busy || !ready || expired} onClick={() => onApprove([], "rejected", note)}>Reject</button><button className="btn" disabled={busy || !ready || expired || !note.trim()} onClick={() => onApprove([], "changes_requested", note)}>Request changes</button></div></> : null}
      {snapshot.approval ? <div className="plan-decision-result" data-testid="approval-decision"><Check size={16} aria-hidden="true" /><strong>{label(snapshot.approval.decision)}</strong><span>Version {snapshot.approval.planVersion} · {date(snapshot.approval.reviewedAt)}</span></div> : null}
      {snapshot.approval?.decision === "approved" && !snapshot.run ? <button className="btn primary" disabled={busy || !ready} onClick={onExecute}>Execute approved actions</button> : null}
      <p className="plan-decision-note">Approval and execution are separate steps. Decisions for this version cannot be changed.</p>
    </div>

    {snapshot.run ? <div className="plan-execution" data-testid="execution-results"><div className="plan-section-head"><h3>Execution activity</h3><span className="record-badge">{label(snapshot.run.status)}</span></div>{snapshot.missions.map((mission) => <p key={mission.missionId}>{agentDisplayName(mission.agent)} · {label(mission.status)}</p>)}{snapshot.executions.map((execution) => <div key={execution.executionId}><strong>{label(execution.toolName)} · {label(execution.status)}</strong><p>{execution.result?.verification ?? execution.error?.message ?? "Awaiting durable completion. Review before another attempt."}</p></div>)}</div> : null}
  </section>;
}
