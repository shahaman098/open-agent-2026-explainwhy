# Implementation report — Nike business digital twin

## Stage 4 — Autonomous evidence retrieval + unified dashboard (24 October 2026)

Built on the committed Stage 3 checkpoint (`4d4623c`) without resetting data, environment or existing modules.
The interrupted changes were audited and retained. Recovery corrections and current verification are recorded
in this Stage 4 section; earlier simulator/monitoring verification below is historical. No contracts, detector
thresholds or environment credentials were changed.

### Deliverable A — evidence retrieval (`src/intelligence/evidence/`)

| File | Responsibility |
|---|---|
| `types.ts` | Tool interface, `ToolInputBase` (scoped business/run, positive window ≤336 h, ≤672 h baseline, `limit` ≤200), evidence draft/result shapes, data-origin labels |
| `registry.ts` | The eight read-only tools by stable name; nothing accepts collection names, pipelines, operators or code |
| `context.ts` | Loads the scoped investigation, incident, anomalies, findings, catalogue labels and the observation horizon; derives the incident window (onset → last evaluated hour, ≤14 days, clamped to the data cutoff) and the pre-onset baseline (at least 24 h where history permits) |
| `policies.ts` | Deterministic routing from themes, signal ids, canonical metrics, affected entities, polarity and severity → primary, alternative-explanation and context tools (≤8), each with a reason |
| `orchestrator.ts` | `collectInvestigationEvidence({investigationId, businessId, simulationRunId?, collectionMode})` and `executeTool(ctx, selection, collectionId)` (shared with the future investigator): strict input parse, scope enforcement, 25 s timeout, 4-way concurrency, verification, persistence, traces |
| `verification.ts` | Canonical `Evidence` parse; every source reference resolved in the real store within scope; finite measurements; window ≤ cutoff; bounded detail (200 KB); simulated data labelled; no causal language |
| `persistence.ts` | `evidence` (canonical + run envelope), `evidence_details`, `evidence_collections` (lock, idempotent per cutoff), `evidence_tool_runs`; links evidence ids into the canonical investigation and moves `open` → `collecting_evidence` |
| `provenance.ts` | Deterministic ids: new collection = hash(business, run, investigation, cutoff); existing IDs retained; tool run = hash(collection, tool, input); evidence = hash(investigation, tool, item, validated input) |
| `queries.ts` | Scoped, filterable, paginated reads for the evidence and trace APIs |
| `tools/` | `revenue_analysis`, `advertising_analysis`, `checkout_analysis`, `inventory_analysis`, `shipping_analysis`, `customer_feedback_analysis`, `public_reference_context`, `historical_incidents` |

Data boundary: tools read canonical `business_events`, persisted hourly global `metric_snapshots`, product labels
through the detector's existing `CATALOGUE_PROJECTION`, the detector's own anomaly/incident/investigation records and
the verified public reference set via `src/reference/service.ts`. They never read `simulated_*` operational records,
simulator state or ground truth; the leakage guard (`tests/intelligence/leakage.test.ts`) now also inspects the
evidence module and the new routes, with the evidence module's own collections added to its allow-list.

Shipping evidence reuses the due-date cohort semantics through the hourly snapshots (never an event-ratio delay rate).
Revenue decomposes hourly revenue = sessions × conversion × AOV into log-change shares. Product and channel revenue is
order-level attribution and says so. Public references carry source URL, retrieval date and the explicit statement
that they describe the real company and cannot explain a simulated hourly anomaly. Historical retrieval returns an
explicit empty result when nothing exists. Reviews are labelled simulated and delivery complaints as a keyword heuristic.

**Routing methodology.** Always: `revenue_analysis` (impact) and the two context tools. Advertising themes/metrics
(`ctr`, `cac_minor`, `ad_spend_minor`, frequency/paid signals) → `advertising_analysis` on the affected campaigns;
conversion/traffic → `checkout_analysis`; fulfilment → `shipping_analysis`; inventory/demand → `inventory_analysis`;
reputation → `customer_feedback_analysis`. Negative sales/traffic/advertising/conversion incidents add checkout,
inventory, shipping and feedback as alternative explanations; fulfilment adds feedback; reputation adds shipping.
Scenario labels never enter the policy (asserted by test).

**Idempotency.** `initial` returns the existing completed collection for the same investigation and data cutoff.
`refresh` re-executes in place: same collection id, same evidence ids (overwritten), tool runs replaced, attempt
counter incremented. Concurrent requests contend on the collection lock; the loser receives
`evidence_collection_in_progress` (409). A failed or empty tool never invalidates the others (`partial` status).

### Deliverable B — unified dashboard (`src/components/normal/`, `src/app/dashboard/`)

| Route / component | Content |
|---|---|
| `/dashboard` — `AppShell`, `RunSelector`, `OperationsOverview` | Business + run (URL `?run=`), virtual time/tick/lock, 7-day KPIs from `/api/metrics/breakdown`, latest snapshot window, monitoring health (direct trigger, measured worker heartbeat, jobs, snapshots/events persisted), pipeline readiness pills, incidents with links to the workspace, recent anomalies and investigations, links to simulator/monitor/store |
| `/dashboard/architecture` — `ProcessFlow`, `PipelineStagePanel`, `CapabilityPlaceholder` | Clickable Observe → … → Learn; statuses from `/api/intelligence/capabilities`; implemented stages show measured data, I/O, backend and a working link (Retrieve lists the eight tools); future stages show a labelled placeholder with expected input/output and canonical contracts |
| `/dashboard/investigations/[id]` — `InvestigationWorkspace`, `EvidenceExplorer`, `EvidenceToolTrace` | Incident overview with related anomalies and affected entities; **Collect evidence** / **Refresh**; selected tools with roles and reasons; evidence explorer filtered by tool, data origin and category with expandable measurements, verification checks, source records (business events open in the ledger route), tool input and retrieval detail; tool execution timeline (parameters, status, duration, results, errors); disabled placeholders for Mubit investigator, solution planner (ProposedPlan/PlanHandoff), partner execution boundary and outcome verification |

The dashboard reuses the existing design tokens and classes; no component library or animation was added. All
operational data comes from real routes; empty states are honest; future controls are disabled, not fake.

### New API routes

`POST /api/dev/investigations/:id/collect-evidence`, `GET /api/investigations/:id/evidence`,
`GET /api/investigations/:id/evidence-trace`, `GET /api/intelligence/capabilities`; `GET /api/dev/simulator/events`
gained an `eventId` lookup. All use the existing development/demo guard and business/run scoping (see `docs/api.md`).

### Recovery audit and corrections

The starting working tree contained 15 modified tracked files plus the evidence module, capability API, four new
API route handlers, three dashboard pages, eleven dashboard components/helpers, and two new test specs. The audit
read all tracked diffs and the new implementation. The interrupted log `/tmp/normal-vitest2.log` was recovered:
**44 files / 231 tests passed, exit 0, 1,276.00 s**. These are prior-session results, not inferred from the report.
A dev server was already running on port 3001; no monitoring worker process was running.

Recovery fixes preserve the original implementation:

- Run cleanup now removes all four evidence collections only for the requested business/run; an Atlas regression
  checks that another run and another business survive. Existing demo records were not reset.
- New collection identities include business and run. A scoped lookup preserves pre-existing collection IDs.
  The regression creates the same investigation/run/cutoff in another business and verifies separate collections
  and traces. No data migration or index removal was needed.
- Shipping backlog queries exclude future shipment and terminal events, count distinct orders independently of the
  bounded sample, and preserve as-of semantics. A regression covers duplicate shipped events, a later delivery,
  a shipment after cutoff, and a sample smaller than the true backlog.
- Dashboard cards now shrink to mobile width, navigation does not overlap the heading, and wide tables scroll
  within their panels. The evidence expander supports keyboard activation; source links carry business scope.
- Unknown URL run IDs remain selected and show an error instead of silently displaying another run. The run selector
  now uses controlled state, so selection changes immediately and links use that same run while the URL transition
  commits. Browser back/forward reads the restored `run` parameter. Overview, process flow and investigation loaders
  use request sequence guards; previous-run content is hidden immediately and late responses cannot replace the
  selected run's data. Backend APIs continue to enforce business/run scope independently.
- Three unused imports were removed. Browser setup now restores the previously active storefront run on teardown,
  unless an operator has selected an unrelated run in the meantime.
- `docs/api.md` now distinguishes the original target API from implemented routes. The two original Mermaid
  diagrams were separated into `architecture.mmd` (implemented) and `architecture-roadmap.mmd` (future), preserving
  both graphs as independently renderable files.

### Stage 4 verification

Fresh verification in this recovery:

| Check | Command | Result |
|---|---|---|
| Contract TypeScript | `npm run contracts:typecheck` | pass, zero errors |
| Canonical contract fixtures | `npm run contracts:validate` | **15/15 valid** |
| Application TypeScript | `npx tsc --noEmit` | pass, zero errors |
| ESLint | `npm run lint` | pass, zero errors and warnings |
| Full unit/integration suite | `npx vitest run` | **46 files, 234 passed, 0 failed, 0 skipped**; sequential Atlas-backed suites |
| Change Stream capability | `npm run monitor:check` | pass, replica set verified |
| Focused rapid run-selection regression | `E2E_BASE_URL=http://localhost:3001 npx playwright test tests/e2e/dashboard.spec.ts --grep 'rapid run changes'` | **2/2 passed**, desktop Chromium and Pixel 7; includes browser back/forward |
| Full browser suite | `E2E_BASE_URL=http://localhost:3001 npx playwright test` | **26/26 passed**, desktop Chromium and Pixel 7 |
| Production build | `npm run build` in an isolated copy of the working tree | pass; Next.js 16.4.3 compiled and generated all static pages |

The first browser attempt exposed a strict Playwright locator matching two run selectors on the investigation page.
The regression now explicitly targets the header selector; its selected-run assertion remains intact. No product
assertions were weakened, and no tests were removed. The production build used a temporary local dependency tree
because Turbopack cannot resolve a `node_modules` symlink outside its build root; the existing development server
on port 3001 remained available throughout.

### Existing demonstration and data preservation

Before testing, `nike_demo.activeSimulationRunId` was `demo_nike`. A read-only SHA-256 inventory captured all
24 nonempty run-scoped collections in `/tmp/normal-stage4-recovery/demo-before.json`: 5,790 canonical events,
132 metric snapshots, 105 orders, 4,843 sessions, six anomalies, one incident, one investigation, seven evidence
records, seven detail records, one collection and eight tool traces. The run was already at tick 96, virtual
`2026-10-05T00:00:00.000Z`, so restoration of simulator data was unnecessary.

Investigation `inv_demo_nike_d07498fe5b17` was opened and collected through the existing API. Collection was reused;
evidence stayed at seven records. Revenue, advertising and checkout were selected as primary tools; inventory,
shipping and customer feedback as alternatives; historical incidents and public references as context. Six tools
returned evidence; feedback and history correctly returned empty results. All 277 source references resolved to
183 distinct records. Wrong-business and wrong-run reads returned 404. Scanning persisted evidence/details found
none of the tested hidden parameters or scenario labels. The legacy collection ID was preserved.

Isolated live demonstration via `npm run demo:stage4 -- http://localhost:3001`:

- Run `demo_stage4_1792857791331`; active storefront pointer remained `demo_nike`.
- Standalone Change Stream worker completed all **3 persisted monitoring jobs**; the detector persisted an advertising
  investigation `inv_demo_stage4_1792857791331_d07498fe5b17`.
- Evidence collection and refresh completed through the actual APIs. The collection retained one collection ID,
  reached refresh attempt 2, and returned **7 evidence records and 8 tool traces** without duplicate evidence IDs.
- All **183 source records** resolved within business/run scope. Evidence and trace output contained none of the
  checked hidden simulator labels or ground-truth fields.
- Headless browser inspection confirmed the overview links to the correct run, the investigation is visible, the
  evidence explorer displays seven records, and the timeline shows eight executions (**6 completed, 2 empty**).
- Afterward, all **24 saved `demo_nike` collection checksums matched** `/tmp/normal-stage4-recovery/demo-before.json`,
  and `nike_demo.activeSimulationRunId` was `demo_nike`.
- The first attempted isolated run (`demo_stage4_1792857559987`) exposed the script's former fixed three-job wait:
  it persisted an investigation after four jobs, then the script was stopped before evidence collection. That run
  remains isolated and inactive; no `demo_nike` records were reset or overwritten. The successful run above used the
  corrected persisted-window count. After the browser suite, the active pointer was conditionally restored from the
  E2E fixture value `e2e_run` to the saved `demo_nike` value before the demonstration.

### Repeatable isolated demonstration

```bash
npm run dev -- -p 3001
# In a second terminal:
npm run monitor:watch
# In a third terminal, after the worker has connected:
npm run demo:stage4 -- http://localhost:3001
```

`scripts/demo-stage4.ts` creates a unique run with `reset:false, makeActive:false`; it advances 36 + 36 healthy hours,
injects advertising deterioration at severity 0.8, then advances 24 hours. Direct simulator service calls bypass
Next.js `after()`, so the script waits until every monitoring window actually persisted for that run has a completed
job; it does not assume a fixed window count.
The script collects and refreshes through Next.js APIs, checks persisted traces and source references, rejects hidden
labels, verifies unchanged evidence IDs/counts, checks the active storefront pointer, and prints the new URLs.
It retains the isolated run for inspection. No Mubit reasoning or solution planning is invoked.

### Current Stage 4 limitations

- Retrieval is deterministic policy-driven orchestration, initiated by **Collect evidence** or the API. It is not
  automatically invoked when every investigation opens, and is not a Mubit investigator.
- Business/run filters provide data isolation, not production tenant authentication. Dashboard UI targets `nike_demo`;
  service APIs support validated business scope. Dev/demo endpoints require their existing guard.
- Mubit diagnosis, solution planning, approval/orchestration, outcome verification and learning remain unimplemented
  or partner-pending, with disabled controls. Existing adapters and canonical contracts are preserved.
- Evidence references and detail rows are bounded; references sample larger event sets. Shipping backlog counts are
  complete while backlog rows are sampled. Public references are dated stored/cache context, not live external research.
- The workspace loads the newest 100 evidence records and five collection histories; the read APIs expose pagination.
  Refresh replaces the same-cutoff trace attempt rather than retaining every attempt as an immutable history.
- A collection uses a 120 s lock and 25 s tool execution deadline. Process-crash recovery requires a retry/refresh
  after expiry; evidence/detail/trace writes are not an all-or-nothing transaction. Production hardening remains later work.
- Revenue product/channel attribution is order-level; review delivery mentions use a labelled keyword heuristic;
  small shipping/review cohorts are explicitly marked weak. These observations do not establish root cause.


## Earlier simulator/monitoring verification — 24 October 2026 (historical session)

This section records the state after the third agent session resumed the interrupted regression run. Nothing from
the earlier sessions was regenerated or reverted; one UI defect was fixed and the complete verification was re-run.

### Provenance of the implementation

| Stage | Author session | Content |
|---|---|---|
| Simulator stage (Milestones 0–7 below) | first session (Claude) | contracts package, reference catalogue, engine/runtime/checkout, ingestion, analytics, adapters, scenarios, storefront, control room, full-system regression |
| Detector core | first session, repaired by the second | baselines, seven rule families, correlation, severity, evaluation harness, `/dev/monitor`, canonical anomaly/investigation persistence |
| Durable monitoring (see "Recovery audit") | second session (Codex) | signed-deviance fix (`normal-detector-1.1.0`), atomic graph publication, ready windows, unique jobs, atomic claims, renewable leases, bounded retries, reconciliation, Change Stream worker, resume-token checkpoints, scoped investigation lookup, worker health in the UI, evaluation report, docs |
| Final verification | this session | regression run to completion, one UI fix, live Method A + Method B demonstration, this section |

The second session's uncommitted work (42 modified files, plus `src/intelligence/monitoring/`, `src/simulator/monitoring.ts`,
`scripts/monitor-watch.ts` and three new test files) was inspected and preserved in full. No contract schema, threshold,
test assertion or environment file was changed.

### Defects found and fixed

**1. Monitor run selector reset (Strict Mode race).** The interrupted Playwright run had left two failures (desktop and
mobile) in `tests/e2e/monitor.spec.ts › shows API-backed incidents…`: after `selectOption("e2e_monitor")` the page
still showed `e2e_run`. Cause: the run-list effect in `src/components/monitor/MonitorConsole.tsx` had no cancellation.
`next dev` runs React Strict Mode, so the mount effect executes twice; the second, slower `/api/dev/simulator/runs`
response reset `runId` to the active run after the operator had already changed the selector, and in-flight `load()`
responses could populate the page with another run's data. Fix: a cancellation flag on the mount effect, the
selected run mirrored in a ref so late responses for a run that is no longer selected are discarded, and the
status/anomaly/incident panels cleared on run change. No test was weakened; the same spec now passes on both projects.
A follow-up line-level audit confirmed the component's render tree, handlers and all original test ids are otherwise
identical to the committed version.

**2. Change Stream watcher poisoned by a deleted window (found while running the demo).** After the test suites had
reset/deleted runs, a restarted worker resumed from its stored token and replayed an `insert` for a
`monitoring_windows` document that no longer existed. `scheduleWindow` correctly refused it ("not durably
published"), but the watcher treated that as a transport failure, reconnected with the *same* resume token and hit
the same event again — forever. The checkpoint stayed at 08:37, the status API showed "no current connection", and
only the 30-second reconciliation kept jobs flowing. Fix in `src/intelligence/monitoring/watcher.ts`: when the
handoff for an event fails, the worker checks whether that `windowKey` still exists as a valid ready record. If it
does, the failure is transient and is retried as before (no checkpoint). If the window is gone or invalid, the event
can never be scheduled, so it is skipped: the resume token is checkpointed past it and `lastSkippedWindowKey`/`lastError`
record the skip for operators. New regression test `monitoring-watcher.test.ts › skips a replayed insert whose window
was deleted…` (verified to fail on the old code). Restarting the real worker against the poisoned checkpoint recovered
immediately; it then stayed connected through a full Playwright run that resets runs.

**3. Control room `+72h` always failed.** The button sent `ticks: 72`, but canonical `SimulatorTickRequest` caps a
request at 60 ticks, so the server answered 400 and the control room displayed the validation error. The component was
unchanged since the initial commit, so this predates both agent sessions; existing E2E only exercised `+24h`. Fix in
`src/components/control-room/ControlRoom.tsx`: jumps above 60 ticks are issued as sequential ≤60-tick requests, each
with its own idempotency key, and the notice sums the events. The contract was not touched. New E2E test
`control-room.spec.ts › +72h exceeds the canonical 60-tick request limit…` (both projects).

### Verification results (fresh, this session, against Atlas `normal_dev`)

| Check | Command | Result |
|---|---|---|
| Contract package typecheck | `npm run contracts:typecheck` | pass |
| Contract fixtures | `npm run contracts:validate` | 15/15 valid |
| TypeScript | `npx tsc --noEmit` | 0 errors |
| ESLint | `npm run lint` | 0 errors, 0 warnings |
| Backend suites | `npx vitest run` | **43 files, 220 tests passed, 0 failed, 0 skipped** (1 202 s; files run sequentially against Atlas); the watcher suite was re-run after fix 2 → **5/5** (221 tests in total) |
| — monitoring jobs / direct trigger | `tests/intelligence/monitoring-jobs.test.ts` | 7/7 |
| — real Change Stream watcher | `tests/intelligence/monitoring-watcher.test.ts` | 5/5 (actual Atlas cursor, restart, missed-notification recovery, deleted-window skip) |
| — crash/retry reliability | `tests/intelligence/monitoring-reliability.test.ts` | 3/3 |
| — persistence/API/scoping | `tests/intelligence/db-detection.test.ts` | 14/14 |
| — detector data boundary | `tests/intelligence/leakage.test.ts` | 7/7 |
| — scenario evaluation (15 seeds, in memory) | `tests/intelligence/evaluation.test.ts` | 8/8 |
| — simulator/ingestion/analytics/adapters/routes/full-system regression | remaining suites | all passed |
| Production build | `npm run build` | success; 25 routes (3 static, 22 dynamic), no warnings |
| Browser end-to-end | `npx playwright test` | **16/16 passed** (desktop Chromium + Pixel 7; storefront, control room incl. +72h, monitor); last run against the live demo server with the worker attached |
| Atlas Change Stream capability | `npm run monitor:check` | "Change Streams verified (replica set)" |

The earlier session's partial counts (56 focused detector tests, 17 persistence/shipping, 42 simulator, 13 direct
trigger, 4 Change Stream, 14 reliability) are all contained in the totals above.

### Product demo through the UI (`demo_nike`, active storefront run)

Driven entirely through the browser on `npm run dev` (:3001) with `npm run monitor:watch` running: **Start / reset run**
`demo_nike` seed 42 → **+72h** (now two sequential requests; 4,948 events; £11.0k revenue, 94 orders, CTR 1.96%) →
3 ready windows, 3 jobs, worker checkpoint on the latest job, 0 investigations → **Inject** Ad fatigue 0.80 → **+24h**
(838 events; CTR and paid sessions fall, CPA £27) → `/dev/monitor` auto-selects the active run and, without a manual
scan, shows *Advertising performance deterioration across 5 campaigns — critical · 89.6*, 6 canonical anomalies,
21 findings, worker *connected (recent heartbeat)*, 4 completed jobs; **Open investigation** lists 24 metric snapshots
and 89 source records. The incident job was the one both triggers converged on (`attempts: 1`); one investigation.
Resetting and replaying the run reproduced the identical investigation id (`inv_demo_nike_d07498fe5b17`).
`/demo-store` shows the active run's virtual clock.

### Live Method A + Method B demonstration

Performed against `next dev -p 3102` and the real `npm run monitor:watch` process, using the isolated run
`t_live_1792830534` in `nike_demo` (seed 42, not made active). No other data was deleted or modified. The run has
been left in the database as a reference; remove it with a `reset: true` start or `deleteRun` if it is not wanted.

| Step | Observation |
|---|---|
| 72 healthy hours (two 36-tick requests) | both ticks returned `x-normal-auto-monitor: scheduled`; two 36-hour ready windows, each citing 36 persisted complete global snapshots; two jobs completed; `lastAsOf` = watermark; 0 investigations |
| worker not running | status API and UI reported *no current connection confirmed* |
| `npm run monitor:watch` | Atlas replica set verified; worker doc `connected: true`, heartbeat and `lastReconciledAt` present; UI shows *connected (recent heartbeat)* |
| inject `ad_fatigue` 0.8, +24 h | one 24-hour ready window (24/24 snapshots); Method A header `scheduled`; the worker's `lastScheduledJobKey` equalled the job created for that window — both triggers converged on **one** job, `attempts: 1`; result: 1 incident, 1 investigation `inv_t_live_1792830534_d07498fe5b17`, 6 canonical anomalies, 21 findings. First global CTR anomaly at 04 Oct 08:00, i.e. 8 virtual hours after injection |
| hard-kill the watcher, +6 h | Method A alone processed the new window (`attempts: 1`, still 1 investigation). The crashed worker's heartbeat went stale and the status API flipped to `connected: false` within 45 s without any record update |
| restart watcher | waited for the crashed owner's 120 s lease to expire ("already running" ×3), acquired a new token, resumed from the stored BSON token, checkpointed the insert it had missed; the already-completed job stayed at `attempts: 1` |
| `NORMAL_AUTO_MONITOR=false`, +6 h | header `disabled`; the Change Stream alone scheduled and processed the window; `lastAsOf` advanced to the watermark; still 1 investigation |
| kill watcher, +6 h with direct processing disabled | durable ready window with no job (6 windows, 5 jobs) |
| restart watcher | reconciliation and resume both found it; 6 windows, 6 jobs, all `completed` with `attempts: 1`; 1 investigation |
| repeat `POST /api/dev/monitor/run` | `repeatScan: true`, 0 investigations created, 0 incidents created |
| replay a tick with the same `idempotency-key` | original receipt returned, clock not advanced, no new ready record |
| `GET /api/investigations/:id?simulationRunId=…` | bundle with incident, 22 findings, 6 anomalies, 24 metric snapshots, 111 source records, 22 bounded event queries; every cited snapshot and source record was found in MongoDB (0 missing); every event query returned records |
| scoping | `businessId=other_biz` → 404; another run's id → 404; correct run → 200 |
| SIGINT to the watcher | `connected: false`, `lock: null`, `stoppedAt` set, resume token retained |

### Detection performance (from the re-run harness; identical to `evaluation/detection-evaluation.json`)

Advertising deterioration 15/15 at 8 h; viral demand 15/15 at 9–13 h with inventory risk in 15/15; checkout
failure 15/15 at 14–28 h; delivery delays 15/15 at 70–91 h (55–59 h with 168 h of history); negative reviews 5/15
(233–301 h), limited by review volume — the harness asserts detection only where ≥5 low reviews exist within 72 h;
healthy operation produced one investigation-worthy finding across 150 run-days (seed 2024, an earlier exposed
held-out seed) and none on the fresh held-out seeds. No threshold was adjusted in this session.

### Remaining limits (in addition to "Current limits" below)

- A hard-killed worker remains *connected* in the status API for up to 45 s (heartbeat staleness) and holds its
  singleton lease for up to 120 s, so a restarted worker may log "already running" a few times before taking over.
  Graceful SIGINT/SIGTERM releases both immediately.
- `POST /api/dev/monitor/run` on a run created before the monitoring stage (no hourly global snapshots) cannot
  publish a ready window and returns an error; such runs need a fresh tick first.
- The `e2e_run`, `e2e_monitor` and `t_live_*` runs in `nike_demo` are test artefacts visible in the run selectors;
  `demo_nike` is the current active demo run.
- Skipped stream events (deleted/invalid windows) are surfaced only through the worker's `lastError`/`lastSkippedWindowKey`
  in the status API, not yet in the UI.
- Long jumps (`+72h`) are two sequential requests; a failure between them leaves the clock at the first boundary,
  which the notice and virtual-time pill show accurately.

### Commands

```bash
npm run dev                                  # app on :3000 (direct monitoring enabled in development)
npm run monitor:check                        # verify Atlas Change Stream access
npm run monitor:watch                        # standalone worker; Ctrl-C releases the lease
NORMAL_AUTO_MONITOR=false npm run dev        # demonstrate the Change Stream path alone
npm run verify                               # contracts + typecheck + lint + vitest
npm run build && npm run test:e2e            # production build; Playwright against next dev -p 3101
```

## Recovery audit — 24 October 2026

The repository was clean at `c6a780c` (one initial commit). The prior agent's work was already committed;
Git cannot distinguish its individual edits. All existing simulator, ingestion, analytics, contracts,
adapters, UI and detector files were preserved. No environment file or unrelated database records were changed.

| Component at recovery | Classification | Evidence / gap |
|---|---|---|
| Canonical contracts, TypeScript | Complete and verified | 15 fixtures valid; typecheck passed |
| Baselines, seven rule families, correlation, severity | Broken in part | Existing revenue/order and conversion decline tests failed |
| Shipping analytics | Implemented but unverified | Due-date cohort and overdue leading indicator already replaced the old event ratio |
| Canonical persistence and APIs | Partially implemented | Stable IDs/evidence existed; no atomic graph publication, renewable scan lease, or scoped detail lookup |
| Direct trigger | Partially implemented | Request-local `after()` retry loop only; no durable queue |
| Ready windows, shared jobs, reconciliation | Missing | No durable scheduling collections |
| Change Stream process | Missing | No worker/script/checkpoint |
| `/dev/monitor` UI | Implemented but unverified | Existing incident/evidence view; no measured worker health |
| Evaluation and docs | Partially implemented | Substantial evaluation tests and diagnostic probes; docs still described the previous simulator stage |

Initial sandbox test run: 25 files passed, 15 failed; 128 tests passed, 7 failed, 70 skipped after
database setup errors. Two failures were actual detector regressions; Atlas DNS was blocked by the sandbox.
The unrestricted retry initially failed TLS handshakes. After the user requested another attempt, the focused Atlas
write/read check passed (2/2). Historical results below describe the earlier simulator stage, not this recovery.

The detector fix uses signed root deviance for declining business counts/proportions while retaining
robust variance inflation, baseline uncertainty, minimum samples and exact-tail guards. Detector version:
`normal-detector-1.1.0`. The existing 56 focused detector tests and eight multi-seed evaluation tests passed.
No detection assertion or threshold was relaxed.

### Completed implementation

The retained detector uses comparable-hour or trailing historical windows, median/MAD spread estimates,
pooled rates, denominator-aware exact tails, catalogue multiplicity correction, persistence and hysteresis.
Baselines exclude the evaluated window and freeze when an episode emerges. Insufficient history/sample size
is reported explicitly. Severity combines magnitude, reliability, estimated daily business impact and persistence.
Correlation uses timing, dimensions and related business metrics; it does not identify causes.

All seven families remain in `src/intelligence/detection/rules/`: revenue/order declines and growth;
CTR/CPA/ROAS and paid acquisition; conversion/checkout failures; due-date shipping cohorts and overdue/backlog
indicators; stockouts/projected stockouts/depletion; low ratings; product/social/channel demand growth.
The recovery evaluation additionally exposed a custom depletion rule missing baseline uncertainty and
multiple-product correction. Both were added, and the original inventory assertions still pass.

Preserved modules: canonical contracts (unchanged), simulator mechanics/RNG/scenarios, ingestion, reusable MongoDB
client, analytics/cohort aggregation, partner adapters, storefront, control room and existing monitor UI.
Diagnostic probe tests were retained; their hard-coded former-agent scratch paths now use isolated OS temp directories.
There is only one detection implementation.

New structure:

```text
src/intelligence/
  baselines/                    # preserved statistics and baseline engine
  detection/                    # preserved rules/correlation/severity; atomic graph persistence
  signals/                      # persisted event aggregation; committed-window watermark
  monitoring/
    windows.ts                  # complete snapshot coverage and ready publication
    schedule.ts                 # stable job key and unique durable upsert
    jobs.ts                     # atomic claims, run ordering and renewable leases
    process.ts                  # shared detector invocation, retries and completion
    recovery.ts                 # missing-job reconciliation
    manual.ts                   # existing manual API through the same job service
    watcher.ts                  # Change Streams, checkpoints, connection health
  monitor.ts                    # shared detector orchestration and status
  auto.ts                       # bounded Next.js after() queue drain
  queries.ts                    # canonical, scoped API reads and evidence bundles
src/simulator/monitoring.ts      # producer clock/outbox recovery; no hidden inputs sent to detector
scripts/monitor-watch.ts         # separate Node process, SIGINT/SIGTERM shutdown
```

### Triggering, idempotency and recovery

Method A: after tick domain/events/clock/receipt persistence and run-lock release, publish up to 72 completed
hours of global metric snapshots. Validate every hourly snapshot, then majority-upsert a ready record. The
Next.js `after()` callback reconciles missing jobs and performs a bounded drain. Publication failure is logged
without invalidating the successful tick; its frozen batch and committed clock support later recovery.
An idempotent tick retry reuses its receipt and does not create another ready record.

Method B: `npm run monitor:watch` first opens and polls a real Atlas Change Stream to verify support. It then
watches inserts into `monitoring_windows`, validates each record and calls the same scheduler. The actual
configured Atlas deployment passed this check as a replica set. No watcher runs inside an API route.

Unique job identity includes business, run, both window boundaries and detector version. A per-run queue lease
orders scans; atomic job claims select one owner. Jobs and detector scans use 120-second leases, renewed every
40 seconds. Real processing errors retry at most three times with bounded exponential delay; contention does
not consume the failure budget. Terminal failures remain visible in the status API/UI. Detector-version changes
start a new ordered scan epoch. Earlier windows already covered by a newer successful scan are explicitly marked
`supersededBy`, without regressing incident state.

Anomaly/finding/incident/investigation IDs are deterministic. The linked graph is committed transactionally,
with a detector-lease fence. A crash after graph commit but before job completion can repeat execution, but cannot
create duplicate logical incidents. This is at-least-once processing with idempotent results, not a claim of
exactly-once execution across a process crash. Existing closed investigations are preserved.

The watcher has its own singleton lease and durable BSON resume token. It checkpoints only after the job is
durably scheduled, retries stream connections with bounded backoff, and reconciles every 30 seconds independently
of the stream. Invalid/expired resume tokens are discarded and reconciliation supplies recovery. A replayed insert
whose window has since been deleted or invalidated is skipped and checkpointed past (recorded as
`lastSkippedWindowKey`), so a reset run cannot poison the stream; transient scheduling failures are still retried
without advancing the checkpoint. Producer recovery
also finds clock commits lacking metrics/ready records. Graceful shutdown closes the cursor and releases ownership.
The monitor UI reports a connection only while a connected worker has a recent heartbeat and unexpired lease.

### Scenario evaluation for detector 1.1.0

The reproducible report is [`evaluation/detection-evaluation.json`](evaluation/detection-evaluation.json).
Fifteen fixed seeds cover 150 healthy run-days plus scenario runs. Recovery-tuning seeds 17011/28081 are labelled
as exposed; final untouched seeds 61121/73129 are reported separately. No scenario label enters production detection.

| Signal family / scenario | Observed result | Virtual detection delay |
|---|---|---|
| Advertising deterioration | 15/15 detected | 8 h |
| Delivery delays (72 h initial history) | 15/15 detected | 70–91 h |
| Delivery delays (168 h history, three seeds) | 3/3 detected | 55–59 h |
| Viral demand | 15/15 detected; inventory risk in 15/15 | 9–13 h |
| Checkout failure | 15/15 detected | 14–28 h |
| Negative reviews | 5/15 detected; sparse review volume limits the rest | 233–301 h |
| Healthy | One finding/investigation across 150 days; zero on fresh held-out seeds | n/a |

Shipping delay is measured from injection, including the time before promises fall due. Inventory shortage
coverage uses observed depletion/stockout events in demand runs and dedicated rule tests; no seventh canonical
scenario or hidden detector label was invented. Review signals require actual low-rating evidence and never
manufacture confidence to satisfy an expected scenario name.

### Exact end-to-end demo

1. In terminal A run `npm run dev`. In terminal B run `npm run monitor:check`, then `npm run monitor:watch`.
2. Open `/dev/simulator`. Create a **new unique run ID** with seed 42; select it as active. Avoid resetting an
   unrelated run. Advance 72 virtual hours of healthy operation. Open `/dev/monitor` and select the same run.
3. Wait until the monitor's analysed time matches the simulator and pending/running jobs reach zero. Healthy
   history should have no investigation; skipped checks explain any signals without sufficient history.
4. In the control room inject `ad_fatigue` at severity `0.8`, then advance 24 hours. The simulator remains the
   only place that sees the scenario setting.
5. In `/dev/monitor`, wait for the fourth-day boundary. Inspect advertising deterioration, CTR actual/baseline,
   related findings and the canonical investigation. Open its evidence bundle; snapshot/event references are
   persisted MongoDB records. No diagnosis or proposed plan is generated.
6. Click **Run anomaly scan** again. It returns the existing logical result with a repeat indication and does
   not create another investigation.
7. Stop the watcher with Ctrl-C and advance six hours. Method A still processes the ready window. Restart the
   watcher; its checkpoint/reconciliation must not duplicate the result.
8. To demonstrate Method B alone, restart terminal A using `NORMAL_AUTO_MONITOR=false npm run dev` and keep
   the watcher running. Advance another six hours; the stream schedules the same shared processor.
9. To demonstrate missed-notification recovery, stop the watcher while direct processing is disabled, advance
   six hours, then restart the watcher. The ready record remains durable and reconciliation processes it.

The status endpoint is `/api/dev/monitor/run?businessId=nike_demo&simulationRunId=YOUR_RUN_ID`. Production demo
requests require the existing `x-normal-demo-key`; do not expose that key in shared screenshots or scripts.

### Current limits

- Canonical v1 has no stock, ROAS, social-mention or checkout-failure metric names. These are retained as
  supplementary findings; a standalone inventory-only incident cannot open a canonical Investigation without
  a qualifying supported anomaly. No canonical enum was changed or misused.
- Review detection is deliberately sample-limited, and shipping cannot be judged before promises mature.
- The detector replays 14 days with up to eight additional days of baseline history. Very long incidents need
  a future persisted-baseline extension; current evaluation covers the documented finite simulation horizons.
- Direct callbacks are bounded and can be interrupted by hosting limits. The standalone worker or a later
  tick/manual request is needed to drain durable leftovers. Run the worker under a process supervisor for deployment.
- Three exhausted attempts require operator investigation; they are not silently retried forever. A malformed
  manually inserted ready record is reported as an error and needs repair.
- Real tenant authentication and Mubit reasoning remain future stages; the existing development/demo guard
  and explicit business/run scoping are preserved.

Stage: simulator, ingestion, analytics, demo interfaces. Business: **Nike — Unaffiliated Simulation** (`nike_demo`).
Repository: Next.js 16.4.3 (App Router, Cache Components), React 19.3, MongoDB driver 7.7, Atlas `normal_dev`.

Every milestone below followed implement → test → run → fix → re-run. Test counts are from the final run; see
"Final verification" for the exact commands and outcomes.

## Milestone 0 — Repository and contracts ✅

- Moved the supplied bundle into `packages/contracts/` as the npm workspace `@normal/contracts` (single source of
  truth; root tsconfig path alias `@normal/contracts` → `packages/contracts/src/index.ts`). `src/contracts.ts`,
  `src/invariants.ts`, fixtures and the validation script are byte-identical **except** two import specifiers in the
  barrel/example files (`./contracts.js` → `./contracts`), because Turbopack cannot resolve `.js`-suffixed
  specifiers to `.ts` sources. No schema, enum or field changed. The package tsconfig uses `moduleResolution: Bundler`.
- Installed `zod@3.25.76` (contract-mandated; the only remaining `npm audit` advisory is Zod 3's oversized-collection
  DoS, mitigated by `IngestBatch.max(1000)` and bounded request bodies), `vitest@5`, `tsx`, `vite-tsconfig-paths`,
  `@playwright/test`; bumped `@types/node` to 22 to match the Node 22 runtime and allow vitest 5 (which fixed two
  critical dev-only advisories in vitest 3).
- Tests: `tests/contracts/*` — all 15 fixtures validate, `plan-handoff` passes `planReferenceErrors`, unknown event
  types/keys are rejected, the 13 canonical event names are asserted, and a grep guard fails if any second
  `BusinessEvent`/`ScenarioName`/`ProposedPlan`… definition appears outside `packages/contracts`.
- Existing `getDb()` round-trip and the dev-only `db-test` 404 behaviour are covered in `tests/db`.
- Gate: `npm run contracts:typecheck`, `contracts:validate` (15/15), `tsc`, `lint`, `next build` all passed.

## Milestone 1 — Reference catalogue ✅

- `src/reference/`: Zod schemas for provenance-tagged public observations; 17 products fetched verbatim from
  nike.com/gb category/product pages on 2026-10-24 (running 4, basketball 3, lifestyle 4, football 3, apparel 3) with
  name, subtitle, GBP list price, style code, URL, retrieval method; NIKE, Inc. Q1 FY2027 results (USD) stored
  separately with `relationshipToSimulator: "context_only_not_simulated_revenue"`.
- `seedReferenceData()` upserts idempotently; `getReferenceCatalogue()` prefers MongoDB and falls back to the
  bundled cache (empty DB and unreachable DB both tested).
- `src/simulator/catalogue.ts`: synthetic cost ratios, stock, popularity, quality per product (labelled synthetic);
  `priceOrigin` is `official_public_list_price` only for verified references, else `synthetic`.
- Tests: `tests/reference/catalogue.test.ts` (11). Gate passed.

## Milestone 2 — Customer, order and inventory engine ✅

- `rng.ts` (sfc32, serialisable), `bootstrap.ts` (pure initial world), `engine.ts` (`TickEngine`, one virtual hour per
  tick), `persistence.ts`, `runtime.ts` (lease lock, idempotency keys, chunked persistence, stock-conflict
  regeneration), `checkout.ts` (transactional storefront purchase), `ingestion/service.ts`.
- Tests: `tests/simulator/engine.test.ts` (12: 48-tick determinism, divergence, resume-from-serialised state,
  arithmetic, inventory, ads, deliveries, reviews, stock exhaustion), `tests/simulator/runtime.test.ts` (7: canonical
  shapes, idempotent replay, 3 concurrent ticks → 1 proceeds, same seed in two runs → identical persisted
  observations, 1-tick-per-request restart equivalence, ground-truth isolation, validation),
  `tests/simulator/checkout.test.ts` (6: server pricing, replay, coupon, 5 concurrent buyers of 1 unit → 1 success,
  zero-stock, fulfilment pickup), `tests/ingestion/service.test.ts` (6).
- Bugs fixed along the way: a `run` getter/method name clash in the engine; `loadEnvConfig` ignoring `.env.local`
  under `NODE_ENV=test`; a test expecting `toEqual` on a result that also carries `eventIds`.
- Gate passed.

## Milestone 3 — Advertising, shipping, reviews, partner adapters ✅

- Advertising/fulfilment/review mechanics live in the engine (see `docs/simulator-state.md`); attribution is derived
  from linked orders, `ad.metrics_observed` windows are disjoint per campaign per tick.
- `src/adapters/`: `setDailyBudget`, `sendDelayNotice`, `publishBanner` with exact `ActionProposal` param schemas,
  server limits, idempotent receipts (`action_receipts`), read-back before callback events, `verifyAction`, read
  helpers (`readCampaigns`, `listDelayedOrders`, `readOrdersShipping`, `readStorefront`, `readTestInbox`).
- Tests: `tests/adapters/adapters.test.ts` (6) — including "later ticks obey the new budget" (spend ≤ new budget and
  < 65 % of prior spend while another campaign is unchanged).
- Bug fixed: `ActionProposal.options.find(...)` lost the discriminant type; switched to index + runtime assertion.
- Gate passed.

## Milestone 4 — Scenario injection ✅

- `scenarios.ts` maps `(scenario, severity)` to mechanistic parameters only. All six canonical scenarios implemented.
- Tests: `tests/simulator/scenarios.test.ts` (8) over three seeds with per-seed assertions: ad_fatigue (frequency
  ×1.5+, CTR/clicks/paid sessions/paid orders < 60 %, spend ±10 %, revenue < 80 %), delivery_delays (late rate > 0.35
  and > 3× baseline, satisfaction ↓, ratings −0.3★, ads untouched), viral_demand (mentions ×5, organic ×2, viral
  product orders ×3, revenue +15 %, stock-outs, ads untouched), negative_reviews (−1★ on target product, deliveries
  healthy), promo_checkout_failure (coupon failures ↑, orders −10 %), monotonic severity, hidden parameters absent
  from every event.
- Tuning while testing: Dunk Low Retro initial stock 240 → 110 so viral pressure shows within a week; defective
  products raise review propensity; delayed-delivery penalty strengthened; measurement windows lengthened for
  effects that lag by design (deliveries/reviews).
- Gate passed.

## Milestone 5 — APIs and analytics ✅

- `src/analytics/metrics.ts`: one `$facet` aggregation per query producing validated `MetricSnapshot`s per bucket
  (window/hour/day), dimensions (campaign/product/channel/device via `$lookup`), ad-window deduplication, null rates
  on zero denominators, partial/complete flag; `productBreakdown`, `campaignBreakdown`; per-tick hourly snapshots
  persisted (`SimulatorTickResponse.metricSnapshotIds`).
- Routes: see `docs/api.md`. Dev routes 404 outside development/demo mode; ingest requires credentials.
- Tests: `tests/analytics/metrics.test.ts` (6: counters equal an independent recount, half-open buckets sum to the
  total, partial windows, null rates, dimensions, cross-business isolation, duplicate ad windows not double counted,
  product/campaign arithmetic, idempotent persistence), `tests/api/routes.test.ts` (6: protection, start→tick→inject→
  state round-trip with canonical shapes, ingest auth/scoping, metrics/breakdown, demo-store incl. idempotent checkout,
  `GET /api/plans/plan_001` after fixture seeding).
- Bugs fixed: MongoDB `Filter<T>` typings on two routes; a test that sampled a review event before any review existed.
- Gate passed.

## Milestone 6 — Frontend ✅

- `/demo-store`: catalogue with search + category chips, provenance drawer (source link, retrieval date, synthetic
  disclaimer), cart with quantity caps by stock, server-priced checkout with idempotency key, confirmation, "your
  orders" persisted across refresh, partner banners, prominent unaffiliated/no-real-purchases notices. Original
  category-tile visuals; no Nike imagery is hotlinked.
- `/dev/simulator`: run selector, seed/run-id start-reset, +1/+6/+24/+72h ticks (with idempotency key), scenario +
  severity injection, metrics window chips, KPI tiles, four single-axis SVG charts with crosshair tooltips and table
  toggles (palette validated with the dataviz validator for light and dark), campaign table (budget, spend, CTR,
  frequency, CPA, ROAS), inventory & product revenue, shipping activity, recent reviews, filterable canonical event
  ledger. All data from the APIs; refresh preserves state.
- Playwright (`tests/e2e`, desktop + Pixel 7 projects, 10 tests): catalogue count/filter/provenance, add-to-cart →
  persisted order → API inventory decrement and ledger event → survives reload, sold-out product blocked, control
  room start → +24h → KPIs/charts/tables match the breakdown API → inject → reload preserves scenario and clock.
- Bugs fixed: Turbopack could not resolve the contracts barrel's `.js` specifiers (see M0); React hooks lint rule on
  storage hydration; a Playwright locator ambiguity.
- Gate passed (10/10 E2E).

## Milestone 7 — Full system regression ✅ (see final verification)

`tests/regression/full-system.test.ts` executes the 17-step scenario against Atlas with run `t_regression` (seed 42):
3-day healthy baseline → `ad_fatigue 0.8` → 3 days → MongoDB evidence (frequency ↑, CTR/clicks < 60 %, spend ≈,
attributed orders & revenue ↓, no hidden labels) → adapter halves `cmp_lifestyle_af1` budget → callback event → 1 day →
spend ≤ new budget and < 65 % while Pegasus spend unchanged → `delivery_delays 0.8` → 5 days → late rate > 0.25 and
> 4× baseline, customer satisfaction ↓, delayed events ↑ → storefront checkout → order/events/inventory persisted and
visible in a metrics window → fresh state load: 288 ticks, lock released, event/order/snapshot counts reconcile →
seed 42 replayed in a new run reproduces every event of the first 72 ticks.

Two assertions were recalibrated after the first run (late-delivery threshold ignored the 48 h observation lag; the
replay comparison included boundary-timestamped tick-72 events on one side). No product code changed for M7.

## Historical simulator-stage limitations (superseded where noted)

- The earlier event-window shipping ratio has been replaced with due-date cohorts and tested observation delays;
  see the recovery report above and `src/analytics/metrics.ts`.
- Channel/device metric dimensions join orders to `simulated_sessions` via `$lookup`; ad counters are zero for
  product/channel/device slices by design.
- Business scoping uses a validated `businessId` parameter (default `nike_demo`); real tenant authentication is a
  later stage. Dev routes are hidden outside development/demo mode.
- The partner's approval/orchestration/execution records are not implemented (by design). `GET /api/plans/:id`
  serves persisted plans; only the fixture can be seeded today.
- `simulated_sessions` is the largest collection (~1.2 k docs per virtual day); a 30-day run stays well inside the
  Atlas free tier but very long runs should be reset.
- Reference prices were observed on 2026-10-24 and may change; the UI states this.
- E2E uses run `e2e_run` inside `nike_demo` and makes it the storefront's active run.

## Historical simulator-stage verification (2026-10-24, against Atlas `normal_dev`)

| Check | Command | Result |
|---|---|---|
| Contract package typecheck | `npm run contracts:typecheck` | pass |
| Contract fixture validation | `npm run contracts:validate` | 15/15 fixtures valid |
| TypeScript | `npx tsc --noEmit` | 0 errors |
| ESLint | `npm run lint` | 0 errors, 0 warnings |
| Unit/integration suites | `npx vitest run` | **13 files, 99 tests passed**, 0 failed (524 s; DB-backed suites use business `nike_test`) |
| Full-system regression (M7, 17 steps) | part of the suite: `tests/regression/full-system.test.ts` | 7/7 steps passed |
| Production build | `npm run build` | success; 2 static pages + 16 dynamic routes, no prerender bail-out warnings |
| Browser end-to-end | `npx playwright test` (desktop Chromium + Pixel 7) | **10/10 passed** (1.2 min, against `next dev -p 3101`) |
| Live Atlas connectivity | `tests/db/mongodb.test.ts` | replica set, transactions supported, write/read round-trip ok |

Checks that could not be run or were not applicable: none skipped. External fetching was performed once (HTTP
requests to nike.com/gb and investors.nike.com on 2026-10-24); no bot block was encountered and no access control
was bypassed. That stage reported no Git repository. The recovery audit found a clean Git repository at `c6a780c`;
no commit was created during recovery.

## Definition of done — status

The Nike twin generates simulated purchases and advertising (engine + runtime tests); MongoDB stores canonical,
validated, deduplicated events (ingestion tests); an injected advertising problem degrades campaign mechanics and
the metrics reveal it (scenario + regression tests); a controlled budget change through the partner adapter alters
future performance (adapter + regression tests); a shopper completes a synthetic purchase in the browser and the
order, inventory and revenue changes persist (Playwright + regression). The system exposes events, metric snapshots
and `GET /api/plans/:id` for the next stage: anomaly detection → evidence → Mubit diagnosis → ProposedPlan →
partner execution.
