import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BusinessEvent, MetricSnapshot, Anomaly, Investigation, Evidence, Diagnosis,
  ProposedPlan, PlanApproval, ActionExecution, ModelCorrection, SimulatorRun,
  IngestBatch, PlanHandoff,
} from '../src/contracts';

const files = [
  ['order-event.json', BusinessEvent],
  ['ad-event.json', BusinessEvent],
  ['review-event.json', BusinessEvent],
  ['metric-snapshot.json', MetricSnapshot],
  ['anomaly.json', Anomaly],
  ['investigation.json', Investigation],
  ['evidence.json', Evidence],
  ['diagnosis.json', Diagnosis],
  ['proposed-plan.json', ProposedPlan],
  ['approval.json', PlanApproval],
  ['execution.json', ActionExecution],
  ['correction.json', ModelCorrection],
  ['simulator-run.json', SimulatorRun],
  ['ingest-batch.json', IngestBatch],
  ['plan-handoff.json', PlanHandoff],
] as const;
let failures = 0;
for (const [name, schema] of files) {
  const data = JSON.parse(readFileSync(resolve('examples', name), 'utf8'));
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`✗ ${name}`, JSON.stringify(result.error.issues, null, 2));
    failures++;
  } else {
    console.log(`✓ ${name}`);
  }
}
if (failures) process.exitCode = 1;
