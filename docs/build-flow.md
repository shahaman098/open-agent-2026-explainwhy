# Full development sequence and task ownership

## Your side: intelligence pipeline

1. Put the `@normal/contracts` package into `packages/contracts` (both developers import from it).
2. Build an ingestion endpoint that validates `IngestBatch`, applies `eventBusinessRules()`, deduplicates and stores canonical immutable events.
3. Create a seeded simulator with healthy web sessions, orders, ads, shipping and review events. Each simulated API produces the exact same event shape as a real connector.
4. Aggregate events into `MetricSnapshot`. Conversion rate = orders/sessions when denominator nonzero; CTR = clicks/impressions; late delivery rate = delayedShipments/shipments. If denominator is zero, use `null`, not 0.
5. Compare equivalent current/baseline periods, create `Anomaly` only after minimum sample-size checks and dedupe ongoing alerts.
6. Create `Investigation`; fetch source records; emit `Evidence` with stable references and real observations.
7. Send a stable recurring task through Mubit. Validate the response with `DiagnosisModelOutput`. Server adds IDs/links to create `Diagnosis`, and checks evidence references against current investigation.
8. Build a separate planner with only `ActionProposal` action types. Validate `ProposedPlan`, cross-check evidence/dependencies via `planReferenceErrors`, persist version 1 and return `PlanHandoff`.
9. Save `ModelCall` records for traceability; keep original model output and verified user corrections in `ModelCorrection`. Do not assume the local correction has been ingested by Mubit.
10. Create unseen `EvaluationCase` fixtures with hidden labels. Record actual `EvaluationResult` outputs; never hard-code accuracy figures.

## Partner's side: execution pipeline

1. Load `examples/plan-handoff.json` now; build flowchart and approval screen without depending on your backend being ready.
2. On approval, validate `PlanApproval`, re-check plan version, selected actions, permissions and expiration.
3. Build `AgentMission` records from approved action types.
4. Implement three actual simulator tools: `ads.set_daily_budget`, `customer.send_delay_notice`, `storefront.publish_banner`. Stretch: `marketing.publish_ad`.
5. Generate idempotency key per selected action, validate and execute with restricted permissions and clear budgets / recipient caps.
6. Verify resulting simulator state, write `ActionExecution`, and record outcomes separately from the model's claims.
7. New simulator events go back through ingestion, closing the monitoring loop.

## Integration checkpoint

Use `/api/plans/:id` to return the exact `PlanHandoff` fixture shape. Partner should be able to approve and execute mock actions before the Mubit diagnosis engine is ready. Conversely, your system should create the same kind of plan without requiring your partner's agent implementation.

## Mubit caution

Mubit provides an LLM gateway and task-adapter pipeline. In Normal, `ModelCall` and `ModelCorrection` are Normal's **own** records. They are not guaranteed to match a documented Mubit feedback endpoint. Confirm correction-to-training ingestion and programmatic adapter inference with the event staff. Always distinguish original provider model predictions from updated adapter results, and show independent held-out evaluation.
