# Stage 6 acceptance — 25 October 2026

Implemented the Mubit solution planner on the existing Investigation Workspace. Canonical contracts and the partner execution adapters are unchanged. Planning writes only planning jobs, model-call traces and proposed plan versions; it never executes an adapter.

## Working path

- `src/planner/`: eligibility/context, stable structured strategy task, deterministic validation, durable queue/leases, idempotent selection, immutable versions and canonical handoff checks. Kept outside the detector's canonical-observation-only boundary; read adapters expose current target state without latent simulation controls.
- `GET/POST /api/investigations/:id/planning?businessId=...&simulationRunId=...`: eligibility, progress, alternatives, validation, selection, history and preparation for approval. POST actions: `generate`, `select` (`strategyKey`), `submit`; bounded `repair` after completed-but-invalid strategies; `refresh` only when inputs changed. Neither errors nor ambiguous billable requests replay automatically.
- `GET /api/plans/:id?businessId=...&simulationRunId=...&planVersion=...`: exact canonical `{ plan, diagnosis, evidence }`, with current-state/expiry/action-consistency checks for planner records. Legacy example handoffs remain supported.
- `npm run planner:work` / `scripts/planner-worker.ts`: durable worker; `--once --run=... --investigation=... --business=...` restricts a demonstration. A worker must be running for queued generation.
- `SolutionPlanning.tsx`: real strategy cards, recommendation, safeguards, exact parameters, evidence cards, history, usage and refresh. Approval intake is absent, so the working button prepares a review-ready handoff and explicitly labels integration pending.

Executable proposals require a completed, non-provisional Stage 5 report, canonical diagnosis agreement, verified scoped evidence and ready handoff. Targets must exist in the same run. Budget changes are capped at 25% and require a cited campaign efficiency comparison; notice recipients, template, prior messaging, shipment status and caps are checked; banners use factual server-approved copy and bounded simulation-clock dates. Dependencies, duplicate targets, currency, numeric targets and unsupported actions are checked. Selection, submission and handoff recheck current state. All actions require approval; safeguards/rollback/partial-failure guidance also travel in canonical rationale strings.

## Genuine Mubit demonstrations

The saved advertising investigation `nike_demo / stage5_1792885194280 / inv_stage5_1792885194280_d07498fe5b17` produced three strategies: a targeted reduction, a broad reduction, and further investigation with no changes. The targeted strategy was recommended, selected and persisted as **`plan_plj_c70db54aa7f98907532859f2`, version 1, awaiting approval**. Its action proposes `cmp_basketball_search`, **9000 → 6750 GBP minor units (£90 → £67.50/day)**, citing `evd_f7788889a1db104f`. Its current-state values, zero observed attributed orders and ROAS comparison come from that campaign's verified comparison window. The broad reduction was blocked because not every targeted campaign had a qualifying deterioration. The real canonical handoff passed and the selected plan/call ledger survived desktop refresh. The budget stayed 9000.

Request history is retained honestly:

| Request ID | Result | Reported tokens |
| --- | --- | ---: |
| `mreq_01a1709b795f78c183811ab9fc88a3e0` | Initial comparison; unrelated shipping action rejected, no plan | 6,194 |
| `mreq_01a1709ce9f57110a533816c09e3d9b5` | Bounded correction; model identified missing campaign-specific input | 6,478 |
| `mreq_01a170a09c2c775184fffe17575bd54c` | Fresh generation with existing verified campaign details; recommended valid targeted budget proposal | 14,103 |
| `mreq_01a170a089347992a28b32b637d4f5a2` | Saved checkout diagnosis; three advisory strategies, zero executable actions | 3,103 |

All used the configured Mubit base model. Prompt version changed from initial `solution-planner-v1` to `solution-planner-v2` during implementation; v2 fingerprints remain independent of changing inputs. Request IDs, input checksums, task fingerprints, output, checks and usage are persisted in the existing model-call ledger. Cost remains unknown because provider rates are unconfigured. No training/improvement claim is made.

During development an overbroad numeric-prose check also rejected an operational “25% budget reduction” as a forecast. It was corrected to distinguish action parameters from precise performance/probability forecasts. The final validator additionally requires campaign-specific efficiency deterioration, rather than treating aggregate advertising evidence as sufficient to target every campaign.

Checkout reused `docs/stage5-runs/s5eval_1792881375759_0_0.json`, the genuine completed `discount_failure` diagnosis. Its original run was cleaned after Stage 5. Only its saved validated report was imported into a **planning-only archive**, with original artifact hash and archived evidence references; no Stage 5 investigation/source data was recreated. Archive planning is always advisory and cannot create a canonical executable plan or handoff. Mubit recommended investigating the coupon path, with monitoring/no change and broader checkout investigation as alternatives. No coupon-repair adapter was invented.

Shipping acceptance uses clearly labelled test fixtures: a supported delivery-delay diagnosis yields an ordered default notice → factual banner proposal, exact recipients, canonical handoff, rollback and partial-failure guidance. Already-notified, already-shipped or unrelated recipients and unsafe promises are rejected. A new live shipping diagnosis/Mubit run was not created.

## Verification

- Focused Vitest/MongoDB: **21/21 across three files** (`tests/planner/validation.test.ts`, `persistence.test.ts`, existing detector leakage guard). Covers contracts, shipping coordination, advisory checkout, unsafe/unknown actions, ownership, duplicate/conflicting actions, stale state, immutable versions, concurrency, idempotency, malformed output, provider 503, unknown request recovery, bounded correction, stable fingerprints, handoff integrity and no business mutations.
- Desktop Chromium planning acceptance: **1/1 passed in 47.0 seconds** after the input/validation repairs. The same focused acceptance case was used during development; it did not silently weaken assertions or rerun the backend scenario suites. It generated through real Mubit, selected the recommended proposal, prepared/retrieved canonical `PlanHandoff`, checked isolation and confirmed persistence after refresh.
- TypeScript and ESLint passed; ESLint retains the existing 37 campaign-component unused-code warnings. Canonical contract typechecking and all **15 examples** passed. Production build passed. `git diff --check` passed.
- Before/after collection hashes confirm **`demo_nike`, active selection, business state and original Stage 5 records unchanged**. New planner jobs, planning model-call traces and plan versions are the only expected additions in the advertising scope. No receipts, notices, banners or callback events were created by planning. Active selection remains `demo_nike`.
- The previous complete full regression remains **307/307**; the current full regression is still pending. No full-suite, mobile/tablet or multi-seed simulator run was performed for Stage 6. Existing tests were retained; stale assertions for the previously unimplemented planner now assert its real gated entry point and readiness.

Artifacts: `docs/stage6-runs/advertising-plan.json`, `checkout-advisory.json`, `planning-browser.json`, `planning-desktop.png`, and preservation snapshots/results. Run `node --conditions=react-server --import tsx scripts/demo-stage6.ts` to re-audit the saved result without a model request.

**Stage 6 demonstration acceptance passes.** Partner approval intake, authentication/permissions and execution orchestration remain partner dependencies. The partner must approve the exact version and recheck the explicit business/run and current-state preconditions before calling an adapter; planning does not authorize execution. An always-on production planner worker and provider price configuration remain operational work. No automatic commit was made.
