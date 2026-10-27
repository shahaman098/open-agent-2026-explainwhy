# HTTP API contract (v1)

All responses are JSON. The implemented demo defaults to `nike_demo` and validates caller-supplied business/run IDs.
Production tenant authentication is **not implemented**; validated IDs are data scoping, not tenant authorization.
Persisted canonical records use `schemaVersion: 1`.

## Target API roadmap (not an implementation inventory)

The table below preserves the original integration plan. Diagnosis, planning, approval, execution orchestration,
correction and evaluation HTTP endpoints are **not implemented**. Simulator and monitor endpoints use `/api/dev/`
in the actual application. The implemented endpoint inventory follows below.

| Method | Path | Body / response | Owner |
|---|---|---|---|
| POST | `/api/ingest/events` | `IngestBatch` -> `IngestResult` | Intelligence developer |
| POST | `/api/simulator/start` | `SimulatorRun` config -> `SimulatorRun` | Intelligence developer |
| POST | `/api/simulator/inject` | `InjectScenarioRequest` -> updated `SimulatorRun` | Intelligence developer |
| POST | `/api/simulator/tick` | `SimulatorTickRequest` -> `SimulatorTickResponse` | Intelligence developer |
| GET | `/api/metrics?businessId=...` | array of `MetricSnapshot` | Intelligence developer |
| POST | `/api/monitor/run` | `{businessId}` -> created anomalies | Intelligence developer |
| GET | `/api/investigations/:id` | `Investigation` plus evidence | Intelligence developer |
| POST | `/api/investigations/:id/diagnose` | -> `Diagnosis` | Intelligence developer |
| POST | `/api/investigations/:id/propose-plan` | -> `ProposedPlan` | Intelligence developer |
| GET | `/api/plans/:id` | `PlanHandoff` (plan + diagnosis + evidence) | Intelligence developer |
| POST | `/api/plans/:id/approve` | `PlanApproval` -> reviewed plan state | Execution developer |
| POST | `/api/plans/:id/execute` | `{approvalId, planVersion, selectedActionIds}` -> `AgentMission[]` | Execution developer |
| GET | `/api/plans/:id/executions` | `ActionExecution[]` | Execution developer |
| POST | `/api/diagnoses/:id/correct` | `ModelCorrection` -> receipt | Intelligence developer |
| GET | `/api/evaluations/:datasetId` | `EvaluationResult[]` | Intelligence developer |

## Critical handshake

Your partner builds against `examples/plan-handoff.json`. On GET `/api/plans/plan_001`, the exact response is:

```json
{
  "plan": "<ProposedPlan object>",
  "diagnosis": "<Diagnosis object>",
  "evidence": ["<Evidence object>"]
}
```

The angle brackets above are placeholders; the example fixture contains actual complete JSON.

### Approval invariants

1. Only the authenticated business owner or an authorised delegate can approve.
2. Approval references exact `planId`, `planVersion`, and selected `actionId` values. Editing a plan invalidates approvals for prior versions.
3. Do not execute until action IDs are in an unexpired approved record, and the plan is still current.
4. Reject unknown action types; never turn free-form LLM text into code or tool names.
5. Enforce per-action account, campaign, recipient and spend limits server-side, even if the model requested more.
6. Use stable idempotency keys, such as `plan_001:v1:act_ads_001`, to avoid duplicate emails or budget changes on retries.
7. Execution status comes from actual provider/simulator responses, not model text.
8. Keep side effects in the simulator and controlled test inboxes for the hackathon. Document any real integrations accurately.

### Ingestion invariants

1. Check webhook authentication/signatures where applicable, and validate against `BusinessEvent`.
2. For event deduplication, use `(businessId, provenance.connectorId, provenance.sourceRecordId)` as a unique composite index.
3. Store the raw source payload in a separate, access-controlled collection when appropriate; normalised events are immutable.
4. Distinguish source event time `occurredAt` from ingestion time `receivedAt`.
5. Aggregate the current/baseline windows consistently and label incomplete data; do not fabricate missing metrics.

---

## Implemented in the Nike simulator stage (this repository)

All routes return JSON; errors use the canonical `ApiError` envelope `{ error: { code, message, requestId } }`.
`businessId` defaults to `nike_demo` and may be passed as `?businessId=` on this stage's routes (a validated
`[a-z0-9_]` identifier). Money is integer minor units (GBP); times are ISO-8601 UTC strings; metric windows are
half-open `[startAt, endAt)` in **virtual** time.

### Access control

| Routes | Rule |
|---|---|
| `/api/dev/**` | `NODE_ENV=development`, or `NORMAL_DEMO_MODE=true` with header `x-normal-demo-key: $NORMAL_DEMO_KEY`; otherwise **404** |
| `POST /api/ingest/events` | as above, or `Authorization: Bearer $NORMAL_INGEST_API_KEY`; otherwise **401** |
| `/api/metrics*`, `/api/demo-store/*`, `GET /api/plans/:id` | public read (checkout is a public, bounded, server-priced mutation) |

### Simulator (dev/demo)

| Method | Path | Body → response |
|---|---|---|
| POST | `/api/dev/simulator/start` | `StartSimulatorRequest` (supplementary) `{ businessId?, simulationRunId?, seed=42, virtualStartAt?, minutesPerTick=60, reset=false, makeActive=true }` → **201** run summary `{ run: SimulatorRun, tickIndex, virtualStartAt, totals, locked, scenarioInjectedAt, isActiveRun }`. **409 `run_exists`** unless `reset:true`. Seeds the reference catalogue first. |
| POST | `/api/dev/simulator/tick` | canonical `SimulatorTickRequest` → canonical `SimulatorTickResponse` (`metricSnapshotIds` = one hourly global snapshot per tick). Optional `Idempotency-Key` header replays the stored response. **409 `run_locked`** when another tick/inject is running. |
| POST | `/api/dev/simulator/inject` | canonical `InjectScenarioRequest` → run summary. Writes private ground truth; never returns it. |
| GET | `/api/dev/simulator/state?simulationRunId` | run summary + `inventory[]`, `campaigns[]` (budget/status/totals, no hidden params), `storefront`, `shipments{status→count}`, `recentReviews[]`, `recentShipments[]`, `counts` |
| GET | `/api/dev/simulator/events?simulationRunId&type&eventId&limit≤200` | `{ simulationRunId, events: BusinessEvent[] }` newest first |
| GET | `/api/dev/simulator/runs` | `{ activeSimulationRunId, runs: (SimulatorRun & {tickIndex,totals})[] }` |
| POST | `/api/dev/plans/seed-fixture` | loads `examples/plan-handoff.json` into `plans`/`diagnoses`/`evidence` |

### Data

| Method | Path | Body → response |
|---|---|---|
| POST | `/api/ingest/events?businessId?` | canonical `IngestBatch` → canonical `IngestResult`. Per-event rejections are listed in header `x-normal-rejections`; a malformed envelope is **400**. Dedupe key: `(businessId, provenance.connectorId, provenance.sourceRecordId)`. |
| GET | `/api/metrics?simulationRunId&startAt&endAt&bucket=window\|hour\|day&days=7&campaignId&productId&channel&device&persist=false` | `MetricSnapshot[]` (one per bucket; `completeness: partial` when the bucket ends after virtual time; rates `null` on zero denominators) |
| GET | `/api/metrics/breakdown?simulationRunId&days=7` | UI wrapper `{ run, window, total: MetricSnapshot, daily: MetricSnapshot[], hourly (last 72h), products[] (units, revenue, stock), campaigns[] (CTR, CPA, ROAS, frequency) }` |
| GET | `/api/demo-store/products` | `{ simulationRunId, virtualTime, servedFrom, banners[], promotions[], products[] }` — each product carries `priceOrigin` and `reference { sourceUrl, retrievedAt, dataOrigin, styleCode }` |
| POST | `/api/demo-store/checkout` | `CheckoutRequest` `{ idempotencyKey (8–120 chars), items[{productId, quantity≤5}]≤5, device?, couponCode?, shopperName? }` → **201** `{ status: "completed", order, ingest }`, **200** `{ status: "replayed", order }`, **409** `{ status: "failed", failureCode: "out_of_stock" \| "coupon_rejected", message }` |
| GET | `/api/demo-store/orders?keys=k1,k2` | `{ orders[] }` with shipment status; without keys, the latest storefront orders |
| GET | `/api/plans/:id` | canonical `PlanHandoff`, validated incl. `planReferenceErrors`; **404** when missing |

### Partner adapters

Service functions, not HTTP: see [`partner-integration.md`](partner-integration.md).

### Anomaly monitoring (dev/demo)

All monitoring routes use the same development/demo-key guard as simulator controls.

| Method | Path | Behaviour |
|---|---|---|
| POST | `/api/dev/monitor/run` | `{businessId?, simulationRunId, asOf?, dryRun?}`. `asOf` must be a completed UTC hour boundary. Returns measured signals, skipped checks, incidents and persistence counts. |
| GET | `/api/dev/monitor/run?businessId&simulationRunId` | Last successful scan, observed watermark and recent scans. |
| GET | `/api/anomalies` | Filters: business/run, status, severity, canonical metric, category, from/to. Pagination: `limit` 1–100, `offset` 0–10,000. Returns canonical anomalies with supplementary finding metadata. |
| GET | `/api/incidents` | Correlated observations, severity, investigation policy and linked IDs. Filters: business/run, status, severity, category; same pagination. |
| GET | `/api/investigations` | Canonical investigations and incident metadata. Filters: business/run, status; same pagination. |
| GET | `/api/investigations/:id?businessId&simulationRunId` | Scoped investigation, anomalies, metric snapshots, findings, source references and bounded event queries. Business defaults to `nike_demo`; an incorrect business or supplied run returns 404. |

### Evidence retrieval and dashboard (dev/demo)

All four routes below use the development/demo-key guard, including the read endpoints outside `/api/dev/`.

| Method | Path | Behaviour |
|---|---|---|
| POST | `/api/dev/investigations/:id/collect-evidence` | `{businessId?, simulationRunId?, collectionMode?: "initial" \| "refresh"}`. Deterministic tool selection from the investigation's observed anomalies, bounded concurrent execution (≤8 tools, 4 at a time, 25 s each), verification, persistence. `initial` returns the existing collection for the same data cutoff; `refresh` re-executes in place (same evidence IDs). 409 `evidence_collection_in_progress` while another collection holds the lock; 404 outside the business/run scope. |
| GET | `/api/investigations/:id/evidence?businessId&simulationRunId&tool&category&dataOrigin&from&to&limit&offset` | Canonical `Evidence` records plus, per item, the tool, data origin, retrieval detail, tool input and verification checks. `latestCollection` summarises the newest run. |
| GET | `/api/investigations/:id/evidence-trace?businessId&simulationRunId&limit` | Collection runs (selected tools with reasons, windows, cutoff, status, attempt) and every tool execution (parameters, status, duration, result/evidence/source counts, warnings, error, data sources). |
| GET | `/api/intelligence/capabilities?businessId&simulationRunId` | Measured readiness of the nine pipeline stages (operational / waiting for data / running / failed from persisted records; not implemented / partner pending from implementation metadata) plus the registered tool list. |
| GET | `/api/dev/simulator/events?…&eventId=` | Existing ledger route; `eventId` returns one cited canonical event so a source reference can be opened independently. |

Evidence tool inputs are strict Zod schemas: business/run scope (validated against the investigation), positive windows up to 336 h,
optional ≤672 h baseline, ≤20 entity ids, `limit` ≤200. No collection names, pipelines, operators or code are accepted.

The detector reports observations and correlations, never a definitive cause. The v1 canonical metric enum
does not contain ROAS, stock units, checkout failures or social mentions. These remain supplementary
findings and may support an investigation linked to a qualifying canonical anomaly; they are never relabelled
as an unrelated canonical metric. Inventory-only findings therefore do not independently open a canonical
investigation until a supported business-impact metric also qualifies.
