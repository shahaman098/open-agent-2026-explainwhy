# Partner integration: executing approved actions against the Nike digital twin

Audience: developers maintaining the integrated approval UI, orchestration and agent execution.

Stage 7 selectively adapts `origin/kris` (`f9bc19d`) into Normal. MongoDB, canonical contracts and the existing
simulator adapters remain authoritative; the partner D1 backend and independent simulator are not imported.
See [Stage 7 verification](stage7-verification.md) for execution results and
[Stage 8 verification](stage8-verification.md) for subsequent outcome measurement.

## What you consume

- `GET /api/plans/:id` → canonical `PlanHandoff` `{ plan, diagnosis, evidence }` validated with `@normal/contracts`
  before it is returned. Stage 6 now produces real persisted proposals from completed investigations.
  Use `?businessId=...&simulationRunId=...&planVersion=...` for the exact reviewed version. The legacy
  `POST /api/dev/plans/seed-fixture` remains available for the canonical example.
- `GET /api/investigations/:id/planning?businessId=...&simulationRunId=...` exposes strategy comparison,
  validation checks, current-state preconditions and version history. `POST` with `{ "action": "submit" }`
  prepares the selected plan as `awaiting_approval`; it does **not** approve or execute it.
  Review it at `/dashboard/approvals?run=...`. Run `npm run planner:work` to process queued strategy-generation jobs.
- Planner handoffs reject expired plans, changed diagnoses/targets and altered action parameters. Canonical action
  rationales include execution preconditions, rollback and partial-failure guidance; plan summaries retain risks and
  uncertainty without extending the shared schema. The integrated executor rechecks these conditions after approval
  and passes the **explicit source `simulationRunId`** to every adapter. Never substitute the
  active storefront run. Notices are limited to unnotified, unshipped delayed orders because the existing default
  template promises an update on shipping; other messaging requires an appropriate partner-owned template.
- The simulated business state, through the **adapter service functions** below. They are the only supported
  way to read or change the twin from your module. There is deliberately **no public HTTP mutation route** for
  them: the integrated approval/execute routes below provide the checked workflow. Production identity and RBAC
  still require host integration.

## Approval and execution API

All per-plan routes require `?businessId=...&simulationRunId=...&planVersion=...`.

| Route | Behavior |
|---|---|
| `GET /api/approvals?businessId=...&simulationRunId=...` | Submitted plans with durable decision and execution status |
| `POST /api/plans/:id/approve` | `{decision: "approved" \| "rejected" \| "changes_requested", approvedActionIds: string[], comment?: string}` |
| `POST /api/plans/:id/execute` | `{approvalId: string}`; execute the approved subset after current-state validation |
| `GET /api/plans/:id/executions` | Approval, reviewed handoff snapshot, run, canonical missions, executions and outcomes |

The approval binds the immutable plan hash, exact version, selected actions and current target-state digests.
Required dependencies must also be approved. Decisions cannot be overwritten; revisions require a new plan
version. Approval expires after 30 minutes or at plan expiry, whichever comes first.

Execution requires the same server-derived demo principal, the selected submitted version and unchanged targets.
A shared run lock coordinates execution with simulator ticks. Unique durable run/action keys and adapter receipts
prevent duplicate changes. Dependencies execute in order; a failure stops remaining actions and retains previous
receipts. Interrupted or ambiguous attempts are never automatically retried. Inspect them before creating a
separately reviewed corrective plan. Execution is synchronous, so process-loss reconciliation remains operational work.

The original plan stays immutable. After a successful target mutation, the canonical handoff can correctly fail
its current-state check. Activity displays the stored reviewed handoff as historical evidence; it does not use that
snapshot to bypass execution checks. `ActionOutcome` records immediate read-back verification. Stage 8 writes
separate business-outcome assessments from later observations; neither trains a model.

Routes use the existing development/demo gate and same-origin mutation check. Development uses
`local_demo_human`; configured production demo mode uses `configured_demo_operator` and the demo-key header.
Neither is production user authentication. No browser-supplied reviewer ID is trusted.

Storage: `plan_approvals`, `agent_runs`, `agent_missions`, `action_executions`, `action_outcomes`, plus existing
`action_receipts` and canonical callback events. Operational UI: `/dashboard/approvals` and `/dashboard/activity`.

## Adapter functions (`import { ... } from "@/adapters"`)

All mutations take an `ActionContext`:

```ts
interface ActionContext {
  businessId: string;            // "nike_demo"
  simulationRunId?: string;      // defaults to the business's active run
  actionId: string;              // ProposedPlan action.actionId
  idempotencyKey: string;        // e.g. `${planId}:v${planVersion}:${actionId}`
  executionId?: string;
}
```

and return an `AdapterResult<T>`:

```ts
interface AdapterResult<T> {
  applied: boolean;              // false when the idempotency key was already executed (replay)
  emittedEventIds: string[];     // canonical callback events written to business_events
  verification: string;          // read-back statement for ActionExecution.result.verification
  affectedEntityIds: string[];
  state: T;                      // the entity as read back after the change
}
```

| Action type (exact params from `ActionProposal`) | Adapter | Reads | Callback event |
|---|---|---|---|
| `ads.set_daily_budget` `{campaignId, newDailyBudgetMinor, currency}` | `setDailyBudget(ctx, params)` | `readCampaigns(ctx)`, `readCampaign(ctx, id)` | `campaign.budget_updated` (`ingestMethod: action_callback`) |
| `customer.send_delay_notice` `{orderIds, templateId, maxRecipients}` | `sendDelayNotice(ctx, params)` | `listDelayedOrders(ctx)`, `readOrdersShipping(ctx, orderIds)`, `readTestInbox(ctx)` | one `customer.message_sent` per message |
| `storefront.publish_banner` `{bannerId, message, startsAt, expiresAt, promoCode?}` | `publishBanner(ctx, params)` | `readStorefront(ctx)` | `storefront.banner_published` |

Independent verification: `verifyAction(ctx, idempotencyKey)` re-reads the affected entity and confirms the
callback events exist in the ledger (`stateMatches`, `callbackEventsPresent`).

### Guarantees

- Params are parsed with the **exact** `@normal/contracts` `ActionProposal` param schemas; unknown keys fail.
- Server-side limits always win over requested values (`ADAPTER_LIMITS`): max daily budget £1,000, max 4× budget
  change per action, ≤200 delay-notice recipients, banner ≤160 chars and ≤14 days.
- Idempotent: the first execution for an `idempotencyKey` is recorded in `action_receipts`; replays return the
  original result with `applied:false` and emit nothing.
- Callback events are emitted **only after** the persisted change has been read back.
- Effects are real for the twin: later ticks pace ad spend against the new budget; banners appear on `/demo-store`;
  delay notices land in the `simulated_messages` fake inbox (`inbox: "demo_test_inbox"`). No email is sent.
- Errors are `AdapterError { code, retryable }` (`campaign_not_found`, `budget_limit`, `budget_change_limit`,
  `currency_mismatch`, `no_recipients`, `invalid_window`, `verification_failed`, `conflict`…).

### Example

```ts
import { setDailyBudget, verifyAction } from "@/adapters";

// Inside the approved executor only; use the reviewed source run, never the active-run default.
const ctx = { businessId: "nike_demo", simulationRunId: "reviewed_run", actionId: "act_ads_001", idempotencyKey: "nike_demo:reviewed_run:plan_001:v1:act_ads_001" };
const result = await setDailyBudget(ctx, { campaignId: "cmp_running_pegasus", newDailyBudgetMinor: 6000, currency: "GBP" });
// result.applied === true, result.emittedEventIds = ["ev_<run>:action:plan_001:v1:act_ads_001:budget"]
const check = await verifyAction(ctx, ctx.idempotencyKey);   // { stateMatches: true, callbackEventsPresent: true, ... }
```

## Campaign IDs in the default run

`cmp_running_pegasus`, `cmp_lifestyle_af1`, `cmp_basketball_search`, `cmp_football_mercurial`, `cmp_apparel_search`.
Product IDs are listed in `src/simulator/catalogue.ts` (e.g. `nk_pegasus_42`, `nk_air_force_1_07`).

## Integrated partner frontends

`src/components/partner/` contains the adapted Meta Ads Manager, Nike Storefront, Plan Review and separate
Shopify demo. `/ads` and existing campaign deep links use the replacement Meta UI with MongoDB campaign metrics,
history and receipts. `/demo-store` and `/store` use the replacement Nike UI with scoped MongoDB products,
inventory, checkout and banners. Append `?run=...` to retain selection across operational pages.

Product images join by stable reference identity and verified style using `src/reference/product-images.json`;
cached assets live under `public/assets/products/`. They do not create or override business products.
`/shopify` preserves the partner synthetic presentation locally and has no operational data connection.

Production identity/RBAC, durable recovery of interrupted executions and causal impact evaluation remain
unfinished. Detection, evidence retrieval, Mubit diagnosis, planning, demo approval, verified simulator
execution and observational outcome assessment are implemented in this checkout.
