import type { Db } from "mongodb";

/** Identity of the approved action an adapter call executes on behalf of. */
export interface ActionContext {
  businessId: string;
  simulationRunId?: string;
  /** `actionId` from the approved ProposedPlan action. */
  actionId: string;
  /** Stable key, e.g. `plan_001:v1:act_ads_001`; replays return the first result. */
  idempotencyKey: string;
  executionId?: string;
  db?: Db;
}

export interface AdapterResult<T> {
  /** True when this call performed the change; false when it replayed a prior execution. */
  applied: boolean;
  /** Canonical callback event IDs emitted (empty on replay). */
  emittedEventIds: string[];
  /** Human-readable read-back statement suitable for ActionExecution.result.verification. */
  verification: string;
  affectedEntityIds: string[];
  state: T;
}

export class AdapterError extends Error {
  constructor(message: string, readonly code: string, readonly retryable = false) {
    super(message);
    this.name = "AdapterError";
  }
}

/** Server-enforced limits (the model may ask for more; these win). */
export const ADAPTER_LIMITS = {
  maxDailyBudgetMinor: 100_000,          // £1,000/day per campaign
  maxBudgetChangeFactor: 4,              // no more than 4x up or down per action
  maxDelayNoticeRecipients: 200,
  maxBannerMessageLength: 160,
  maxBannerDurationHours: 24 * 14,
} as const;
