import type {PlanHandoffT} from "@/execution/types";
import { ActionProposalT, ActionExecutionT } from "@normal/contracts";
import { ExecutionError } from "./errors";

/** Rejects plans with duplicate action IDs, missing dependencies or cycles. */
export function validateGraph(h: PlanHandoffT) {
  const visiting = new Set<string>(), visited = new Set<string>(), actions = new Map(h.plan.actions.map(a => [a.actionId, a]));
  if (actions.size !== h.plan.actions.length) throw new ExecutionError("Duplicate action IDs", "invalid_graph");
  function visit(id: string) {
    if (visiting.has(id) || !actions.has(id)) throw new ExecutionError("Cyclic or missing dependency", "invalid_graph");
    if (visited.has(id)) return;
    visiting.add(id); actions.get(id)!.dependsOnActionIds.forEach(visit); visiting.delete(id); visited.add(id);
  }
  actions.forEach(a => visit(a.actionId));
}

export type Readiness = "ready" | "waiting" | "DEPENDENCY_NOT_APPROVED" | "DEPENDENCY_FAILED";

/** An action may only run once every dependency was approved and has succeeded. */
export function readiness(action: ActionProposalT, approvedActionIds: string[], byAction: Map<string, ActionExecutionT>): Readiness {
  if (action.dependsOnActionIds.some(id => !approvedActionIds.includes(id))) return "DEPENDENCY_NOT_APPROVED";
  if (action.dependsOnActionIds.some(id => ["failed", "cancelled"].includes(byAction.get(id)?.status ?? ""))) return "DEPENDENCY_FAILED";
  return action.dependsOnActionIds.every(id => byAction.get(id)?.status === "succeeded") ? "ready" : "waiting";
}
