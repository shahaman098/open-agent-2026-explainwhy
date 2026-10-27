import "server-only";

/**
 * Partner execution adapters — the ONLY supported way for the agent/orchestration
 * module to read or change simulated business state.
 *
 * Contract: every mutation takes an `ActionContext` (actionId, executionId,
 * idempotencyKey) that the partner derives from an approved PlanApproval. The
 * adapters do not perform approval or policy checks themselves; they enforce
 * bounded parameters, idempotency, and emit the canonical callback event only
 * after the state change is persisted and read back.
 *
 * Nothing in this module is reachable over HTTP without the partner's own
 * authenticated route; see docs/partner-integration.md.
 */
export * from "@/adapters/types";
export * from "@/adapters/campaigns";
export * from "@/adapters/customer-care";
export * from "@/adapters/storefront";
export * from "@/adapters/orders";
export * from "@/adapters/verification";
