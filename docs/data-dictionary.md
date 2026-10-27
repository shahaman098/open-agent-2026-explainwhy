# Data contract dictionary

Use this table to assign ownership and know which outputs feed the next stage. The authoritative field-level definitions are in `src/contracts.ts`.

| Schema | Required identity fields | Important content | Producer | Consumer |
|---|---|---|---|---|
| `Business` | `businessId` | Name, currency, timezone | Onboarding | All services |
| `Integration` | `integrationId`, `businessId` | Provider, status, scopes, sync cursor, *secret reference only* | Connectors | Ingestion |
| `BusinessEvent` | `eventId`, `businessId`, provenance ID | `type`, `payload`, `occurredAt`, `receivedAt`, `source` | External connector or simulator | Storage, metrics |
| `MetricSnapshot` | `snapshotId`, `businessId` | Period, dimension, raw counts, calculated rates | Aggregation | Monitoring, evidence |
| `Anomaly` | `anomalyId`, `businessId` | Metric, current/baseline windows, severity, values | Detector | Investigation |
| `Investigation` | `investigationId`, `businessId` | Anomaly IDs, status, evidence/diagnosis/plan links | Investigation service | Frontend, diagnosis |
| `Evidence` | `evidenceId`, `investigationId`, `businessId` | Observed fact, measurements, source record IDs | Evidence retriever | Model, frontend, planner |
| `DiagnosisModelOutput` | None; model-only | Primary cause, supported hypotheses, missing evidence | LLM through Mubit | Validator |
| `Diagnosis` | `diagnosisId`, `investigationId`, `modelCallId` | Validated model output + server attribution | Diagnosis service | Planner, feedback |
| `ActionProposal` | `actionId` | Tool enum, strictly typed parameters, evidence, dependencies | Planner | Execution agent |
| `ProposedPlan` | `planId`, `planVersion`, `businessId` | Objective, action proposals, success criteria, status | Planner | Partner frontend + execution |
| `PlanApproval` | `approvalId`, `planId`, `planVersion` | Decision, approved action IDs, reviewing principal | Approver | Policy gate |
| `AgentMission` | `missionId`, `planId` | Assigned agent, goal, action IDs, status | Orchestrator | Worker |
| `ActionExecution` | `executionId`, `idempotencyKey` | Status, actual tool, result/error, attempts | Action worker | Audit, UI |
| `ActionOutcome` | `outcomeId`, `executionId` | Verified changes, observed snapshots, summary | Verification worker | Monitoring, feedback |
| `ModelCall` | `modelCallId`, `businessId` | Task key, route, model, session, request metadata | LLM wrapper | Debug, evaluation |
| `ModelCorrection` | `correctionId`, `modelCallId` | Old label, verified new label, feedback status | User feedback | Possible Mubit integration |
| `AdapterRecord` | `adapterRecordId`, `businessId` | Task key, version ID (if known), training status | Adapter metadata sync | Demo / model evolution |
| `EvaluationCase` | `evaluationCaseId`, `datasetId` | Hidden ground truth and train/validation/test split | Benchmark builder | Evaluator only |
| `EvaluationResult` | `evaluationResultId`, `evaluationCaseId` | Actual output, correctness, timing, cost | Evaluator | Model dashboard |
| `SimulatorRun` | `simulationRunId`, `businessId` | Seed, virtual clock, scenario and severity | Simulator | Scenario endpoint |
| `ScenarioGroundTruth` | `simulationRunId` | **Private hidden cause labels and parameters** | Simulator | Evaluation only; NEVER diagnosis context |

## Source event types supported by the v1 union

| Event `type` | Critical payload fields | Usually originates from |
|---|---|---|
| `web.session_started` | session ID, device, channel, optional campaign | Web analytics |
| `order.completed` | order, products, money, optional session/campaign | Ecommerce store |
| `order.refunded` | order, refund, amount | Ecommerce or payments |
| `checkout.failed` | session, failure code, device, coupon | Store checkout |
| `ad.metrics_observed` | campaign, window, impressions, clicks, spend, frequency | Ad platform |
| `delivery.status_changed` | order, status, promise/delivery dates | Shipping platform |
| `review.created` | review, product, rating, review text | Review platform |
| `social.mention_observed` | post, platform, content, engagement | Authorised social monitoring |
| `inventory.level_changed` | product, available/reserved units | Inventory platform |
| `campaign.budget_updated` | campaign, previous/new budget, action ID | Action callback |
| `customer.message_sent` | message, order, template, status, action ID | Email action callback |
| `storefront.banner_published` | banner, text, dates, action ID | Storefront action callback |
| `promotion.created` | promo code, eligible products, percentage, expiry, action ID | Storefront action callback |

## Enums to freeze before integration

### Root causes
`ad_fatigue`, `ad_inefficiency`, `delivery_delays`, `product_quality`, `negative_sentiment`, `checkout_failure`, `discount_failure`, `stockout`, `viral_demand`, `seasonality`, `unknown`.

### Agent types
`marketing`, `customer_care`, `storefront`, `supplier`, `growth`.

### Action types
- MVP: `ads.set_daily_budget`, `customer.send_delay_notice`, `storefront.publish_banner`.
- Stretch: `marketing.publish_ad`, `customer.send_promotion_email`, `storefront.create_discount`.

### Plan status transitions
`proposed` → `awaiting_approval` → `approved` or `partially_approved` → `executing` → `completed`. Rejection and expiry may terminate a plan. Editing a plan creates a new `planVersion` (do not overwrite the approved object).

### Execute status transitions
`queued` → `running` → `succeeded` or `failed`; `cancelled` can be terminal before a side effect occurs.

## Key implementation constraints

- Source event data is *observed evidence*. Model hypotheses are *inferences*. Simulator hidden truth is a *private test label*.
- Do not include owner-only labels or hidden injected-fault flags in any Mubit model prompt.
- Treat human corrections as possible training inputs only after a supported adapter-training pathway is verified.
- A returned LLM plan is just a *proposal*. Actions only execute from explicitly approved, version-locked, policy-checked requests.
