import { z } from "zod";
import { SuccessCriterion, type ProposedPlanT, type EvidenceT } from "@normal/contracts";
import type { ScopeT, ReportT, StateT } from "@/intelligence/investigator/schemas";
import type { CallMetadata } from "@/intelligence/investigator/provider";

const Text = z.string().min(1).max(1600);
const Key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
export const StrategyAction = z.object({
  key: Key, actionType: z.enum(["ads.set_daily_budget", "customer.send_delay_notice", "storefront.publish_banner"]),
  title: Text, rationale: Text, evidenceIds: z.array(z.string()).min(1).max(10), dependsOnKeys: z.array(Key).max(4),
  risk: z.enum(["low", "medium", "high"]),
  budget: z.object({ campaignId: z.string(), newDailyBudgetMinor: z.number().int().positive(), currency: z.literal("GBP") }).strict().nullable(),
  notice: z.object({ orderIds: z.array(z.string()).min(1).max(200), templateId: z.literal("default"), maxRecipients: z.number().int().positive().max(200) }).strict().nullable(),
  banner: z.object({ message: z.string().min(1).max(160), durationHours: z.number().int().min(1).max(48) }).strict().nullable(),
  safeguards: z.array(Text).min(1).max(6), rollback: Text, partialFailure: Text,
}).strict();
export const Strategy = z.object({ key: Key, title: Text, explanation: Text, benefit: Text, downside: Text,
  risk: z.enum(["low", "medium", "high"]), feasibility: Text, reversibility: Text, uncertainty: Text,
  evidenceIds: z.array(z.string()).min(1).max(20), actions: z.array(StrategyAction).max(5), advisory: z.array(Text).max(8),
  successCriteria: z.array(z.object({ metric: SuccessCriterion.shape.metric, direction: SuccessCriterion.shape.direction,
    target: z.number().finite().nullable(), measurementWindowMinutes: z.number().int().min(60).max(10080) }).strict()).min(1).max(5), comparison: Text,
}).strict();
export const PlanningOutput = z.object({ strategies: z.array(Strategy).min(2).max(4), recommendedKey: Key, recommendation: Text }).strict();
export type StrategyT = z.infer<typeof Strategy>;
export type PlanningOutputT = z.infer<typeof PlanningOutput>;
export interface ActionCheck { actionId: string; passed: boolean; errors: string[]; current: unknown; proposed: unknown; preconditions: string[]; rollback: string; partialFailure: string }
export interface StrategyCheck { strategyKey: string; passed: boolean; errors: string[]; actions: ActionCheck[] }
export type PlanningStatus = "queued" | "running" | "awaiting_selection" | "ready" | "submitted" | "advisory" | "failed";
export interface PlanningJob extends ScopeT {
  jobId: string; diagnosisId: string; reportId: string; status: PlanningStatus; stage: string;
  createdAt: string; updatedAt: string; leaseToken: string | null; leaseUntil: Date | null; attempts: number;
  contextHash: string; context: unknown; output: PlanningOutputT | null; checks: StrategyCheck[];
  selectedKey: string | null; planId: string | null; planVersion: number; error: string | null;
  history: Array<{ planId: string; planVersion: number; strategyKey: string; status: string; at: string }>;
  archive?: { report: ReportT; evidence: EvidenceT[]; state: StateT; artifactHash: string };
  repair?: boolean;
  generation?: number;
}
export interface PlanningView {
  eligible: boolean; blockedReasons: string[]; advisoryOnly: boolean; job: PlanningJob | null;
  plan: ProposedPlanT | null; calls: Array<{ callId: string; status: string; task: string; promptVersion: string; promptFingerprint?: string | null; checksum: string; metadata: Partial<CallMetadata> | null; error: string | null }>;
  approvalIntegration: "pending";
  stale?: boolean;
}
