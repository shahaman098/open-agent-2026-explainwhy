# MongoDB collection map and indexes

## Collections

| Collection | Schema | Owner | Purpose |
|---|---|---|---|
| `businesses` | `Business` | Shared | Tenant settings |
| `integrations` | `Integration` | Ingestion | Provider, scopes, sync cursor, secret reference (never tokens) |
| `business_events` | `BusinessEvent` | Ingestion | Immutable event ledger |
| `metric_snapshots` | `MetricSnapshot` | Analytics | Computed counters/rates per period |
| `anomalies` | `Anomaly` | Analytics | Significant changes versus baseline |
| `investigations` | `Investigation` | Intelligence | Case state and linked record IDs |
| `evidence` | `Evidence` | Intelligence | Independently traceable findings |
| `diagnoses` | `Diagnosis` | Intelligence | Mubit-routed task output |
| `plans` | `ProposedPlan` | Intelligence | Immutable versions of execution proposals |
| `approvals` | `PlanApproval` | Execution | Human approval decisions |
| `agent_missions` | `AgentMission` | Execution | Agent job tracking |
| `action_executions` | `ActionExecution` | Execution | Idempotent side effects |
| `action_outcomes` | `ActionOutcome` | Execution | Observed verification/outcomes |
| `model_calls` | `ModelCall` | Intelligence | Application-side trace of calls routed through Mubit |
| `model_corrections` | `ModelCorrection` | Intelligence | Verified user feedback, separate from actual Mubit acceptance |
| `adapter_records` | `AdapterRecord` | Intelligence | Cached adapter status observed from workspace |
| `evaluation_cases` | `EvaluationCase` | Intelligence | Privately labelled train/validation/test fixtures |
| `evaluation_results` | `EvaluationResult` | Intelligence | Actual baseline/adapter predictions and metrics |
| `simulator_runs` | `SimulatorRun` | Simulator | Seed, clock, scenario and run state |
| `simulator_ground_truth` | `ScenarioGroundTruth` | Simulator (private) | Hidden cause labels; do not expose to intelligence agent |

## Recommended indexes

```ts
// business_events
await db.collection('business_events').createIndex(
  { businessId: 1, 'provenance.connectorId': 1, 'provenance.sourceRecordId': 1 },
  { unique: true }
);
await db.collection('business_events').createIndex({ businessId: 1, occurredAt: -1, type: 1 });
await db.collection('metric_snapshots').createIndex({ businessId: 1, 'window.startAt': -1 });
await db.collection('investigations').createIndex({ businessId: 1, startedAt: -1 });
await db.collection('evidence').createIndex({ businessId: 1, investigationId: 1 });
await db.collection('plans').createIndex({ businessId: 1, planId: 1, planVersion: 1 }, { unique: true });
await db.collection('action_executions').createIndex({ businessId: 1, idempotencyKey: 1 }, { unique: true });
await db.collection('model_calls').createIndex({ businessId: 1, taskKey: 1, createdAt: -1 });
await db.collection('model_corrections').createIndex({ businessId: 1, diagnosisId: 1 });
```

**Data model note:** Keep source-provider IDs separate from Normal IDs, and use currency as an explicit field. Do not count refunds twice when computing net revenue. Do not add users' email addresses to LLM evidence packages unless necessary and authorised. Limit access to supplier and customer data. Use stable seed/run IDs to make demo repeatable.

## Implemented monitoring storage

`src/lib/collections.ts` is the executable index inventory. The roadmap table above also includes future collections;
the monitor creates only the collections it uses.

| Collection | Identity/index | Purpose |
|---|---|---|
| `monitoring_windows` | unique `windowKey`; business/run/windowEnd | Ready batches of 1–72 complete UTC hours; all cited hourly snapshots are validated before publication |
| `monitoring_jobs` | unique `jobKey`; business/run/windowEnd/status; status/nextAttemptAt/leaseUntil | Pending/running/completed/failed, attempts, retry time, lease token/expiry, summary/error |
| `monitoring_workers` | unique `workerId` | Watcher lease, BSON resume token, checkpoint time, recent heartbeat and connection state |
| `monitor_state` | unique business/run | Detector lease, queue lease, last scan and detector version |
| `monitor_runs` | unique business/run/asOf | Scan summaries and successful scan timestamps |
| `detection_findings` | unique business/run/findingId | Explainable signal measurements, frozen baselines, thresholds and source references |
| `detection_observations` | unique business/observationId | Finding measurements at each scan boundary |
| `incidents` | unique business/run/incidentId | Correlated findings, severity history and canonical investigation link |
| `anomalies` | unique business/anomalyId | Validated canonical `Anomaly` plus storage-only run envelope |
| `investigations` | unique business/investigationId | Validated canonical `Investigation` plus storage-only run envelope; `evidenceIds` and `collecting_evidence` status are set by evidence retrieval |
| `evidence` | unique business/evidenceId; business/investigationId | Validated canonical `Evidence` plus storage-only run envelope. `evidenceId` = hash(investigation, tool, item key, validated input) so identical retrievals upsert in place |
| `evidence_details` | unique business/evidenceId | Internal 1:1 companion: tool, input, data origin, comparison rows/series, warnings, verification checks, retrieval time |
| `evidence_collections` | unique `collectionId` = hash(business, run, investigation, data cutoff); existing IDs retained; business/run/investigation/startedAt | One collection run per cutoff: mode, status (running/completed/partial/failed), lock, selected tools with reasons, completed/failed/empty tools, evidence ids, windows, attempt |
| `evidence_tool_runs` | unique `toolRunId`; business/investigation/collection/startedAt | Every tool execution: parameters, role, reason, status, duration, result/evidence/source counts, warnings, error, data sources |

The job key is SHA-256 of the JSON tuple `(businessId, simulationRunId, windowStart, windowEnd, detectorVersion)`.
Ready-window and job upserts use majority acknowledgement. The linked incident graph is committed in one
transaction that also checks the detector lease; deterministic evidence snapshots may safely precede it.

Producer publication progress (`monitoringBatch`, `monitoringPublishedThrough`, `publicationLock`) lives on
the existing run record. Only `src/simulator/monitoring.ts` reads those clock/progress fields. Detector modules
never read private simulation state. A crash after the clock commit but before metric/ready publication is recovered
from this durable producer progress. Tests/reset cleanup includes monitoring windows/jobs and all four Stage 4 evidence collections (`evidence`,
`evidence_details`, `evidence_collections`, `evidence_tool_runs`) for the specified business/run only. This prevents
stale evidence and collection locks from surviving an explicitly requested run reset.

Worker checkpoints advance only after the corresponding job upsert succeeds, or when a replayed insert refers to a
window that has since been deleted or invalidated (the skip is recorded in `monitoring_workers.lastSkippedWindowKey`
and `lastError`). A periodic anti-join finds ready
windows without a job even if the stream checkpoint is missing or expired. Failed/expired jobs are reclaimed by
the normal job processor; exhausted jobs remain visible for operator review rather than being silently reset.
