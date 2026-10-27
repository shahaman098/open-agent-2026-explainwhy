"use client";

import Link from "next/link";
import { STATUS_LABEL, statusClass, type Capabilities, type StageCapability } from "./api";
import { useRun } from "./run-context";
import { CapabilityPlaceholder } from "./CapabilityPlaceholder";

const FUTURE: Record<string, { inputs: string[]; outputs: string[]; contracts: string[]; later: string }> = {
  investigate: { inputs: ["Investigation + canonical Evidence", "Evidence tool registry (same eight tools)", "Model-requested additional tool calls"], outputs: ["Hypotheses with supporting/contradicting evidenceIds", "DiagnosisModelOutput → persisted Diagnosis"], contracts: ["DiagnosisModelOutput", "Diagnosis", "RootCause"], later: "Mubit chooses further tools, tests hypotheses and produces a structured diagnosis; investigation status moves to diagnosing → awaiting_review." },
  plan: { inputs: ["Diagnosis", "Evidence"], outputs: ["ProposedPlan with ActionProposals, success criteria and risk", "PlanHandoff served by GET /api/plans/:id"], contracts: ["ProposedPlan", "ActionProposal", "SuccessCriterion", "PlanHandoff"], later: "Evidence-backed plan generation; every action references evidenceIds and requires approval." },
  approve: { inputs: ["ProposedPlan"], outputs: ["PlanApproval (approved / rejected / changes requested)"], contracts: ["PlanApproval"], later: "The partner's approval UI consumes PlanHandoff and records decisions per action." },
  execute: { inputs: ["PlanApproval", "approved ActionProposals"], outputs: ["AgentMission, ActionExecution, callback business events"], contracts: ["AgentMission", "ActionExecution"], later: "Partner orchestrator delegates to the existing adapters (set daily budget, delay notice, banner) with idempotent receipts." },
  verify: { inputs: ["ActionExecution", "metric_snapshots before/after"], outputs: ["ActionOutcome with measured before-versus-after values"], contracts: ["ActionOutcome", "SuccessCriterion"], later: "Measured outcomes against success criteria; no estimated percentages." },
  learn: { inputs: ["ActionOutcome", "ModelCorrection"], outputs: ["EvaluationResult, corrections feeding detection and planning"], contracts: ["ModelCorrection", "EvaluationCase", "EvaluationResult"], later: "Recurring-task evaluation and adaptation." },
};

export function PipelineStagePanel({ stage, tools }: { stage: StageCapability; tools: Capabilities["tools"] }) {
  const { withRun } = useRun();
  const future = FUTURE[stage.id];
  if (!stage.implemented && future) {
    return (
      <CapabilityPlaceholder title={`${stage.name} — ${stage.description}`} status={stage.status === "partner_pending" ? "Partner integration pending" : "Not implemented"} description={`${stage.summary}. Later: ${future.later}`} inputs={future.inputs} outputs={future.outputs} contracts={future.contracts} testId="stage-panel">
        <span className="muted small">Backend: {stage.backend}</span>
      </CapabilityPlaceholder>
    );
  }
  return (
    <div className="card" data-testid="stage-panel" data-capability-status={STATUS_LABEL[stage.status] ?? stage.status}>
      <div className="card-head"><h3>{stage.name}</h3><span className={`pill ${statusClass(stage.status)}`}>{STATUS_LABEL[stage.status] ?? stage.status}</span></div>
      <div className="card-body" style={{ display: "grid", gap: 8 }}>
        <span className="small">{stage.description}</span>
        <span className="small"><strong>Now:</strong> {stage.summary}</span>
        <div className="grid two">
          <div><div className="muted small">Input</div><span className="small">{stage.input}</span></div>
          <div><div className="muted small">Output</div><span className="small">{stage.output}</span></div>
        </div>
        <span className="muted small">Backend: {stage.backend}</span>
        {Object.keys(stage.metrics).length ? <div className="row" style={{ flexWrap: "wrap" }}>{Object.entries(stage.metrics).map(([k, v]) => <span key={k} className="pill">{k}: {v === null ? "—" : String(v)}</span>)}</div> : null}
        {stage.id === "retrieve" ? (
          <div className="scroll-x"><table><thead><tr><th>Tool</th><th>Category</th><th>Description</th></tr></thead>
            <tbody>{tools.map((t) => <tr key={t.name}><td><code>{t.name}</code></td><td>{t.category}</td><td className="small">{t.description}</td></tr>)}</tbody></table></div>
        ) : null}
        <div className="row">
          {stage.link ? <Link href={withRun(stage.link)} className="btn sm primary">Open {stage.name === "Observe" ? "control room" : stage.id === "approve" ? "Approvals" : stage.id === "execute" ? "execution activity" : stage.id === "plan" ? "investigations" : stage.id === "verify" || stage.id === "learn" ? "Outcomes" : "anomaly monitor"}</Link> : null}
          {stage.id === "retrieve" || stage.id === "detect" ? <Link href={withRun("/dashboard")} className="btn sm">Open investigations from the overview</Link> : null}
        </div>
      </div>
    </div>
  );
}
