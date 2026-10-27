# Stage 8 acceptance — 25 October 2026

Normal now links approved execution records to subsequent observations and persists separate business-outcome
assessments. The selected run's Outcomes page shows operational verification, measurement coverage, plan criteria,
source records, uncertainty and assessment history. Stage 7's canonical `ActionOutcome` retains its original
meaning: immediate adapter read-back verification. Stage 8 does not turn an executed API call into a claimed
business improvement.

## Implementation

- `src/outcomes/schema.ts`, `measurement.ts`, `service.ts`: scoped assessment schema, deterministic campaign
  observations, exact source validation, durable on-demand evaluation and bounded history retrieval.
- `business_outcome_assessments`: one unique record per business/run/plan version/action/post-action window.
  Statuses are pending measurement, ready to evaluate, evaluating, completed, insufficient data and failed.
  A two-minute claim lease permits safe recovery after an interrupted read-only evaluation. Completed and
  insufficient assessments are retained; a later window gets a new ID instead of rewriting history.
- `GET /api/outcomes?businessId=...&simulationRunId=...&investigationId=...` returns the scoped execution list,
  assessments, receipts, human feedback and counts. `POST /api/outcomes/evaluate` accepts an exact plan/version/
  action/run and optional later `windowStartAt`. `POST /api/outcomes/feedback` stores one separate, immutable
  human note/rating per assessment. Existing development/demo access gating and same-origin mutation checks apply;
  production user identity and RBAC remain future work.
- `src/components/normal/Outcomes.tsx` replaces the prior general metrics panel at `/dashboard/outcomes` with
  a desktop action list and detail dossier. The detail shows the exact reviewed plan and investigation links,
  original execution receipt, applied before/after values, observed metric chart, criterion results, source
  references, limitations and saved window history. No observed post data renders as unavailable, not zero.
  The Investigation Workspace now includes a compact scoped outcome section. Pipeline Verify/Learn entries point
  to the implemented retrieval interface. Learning here means inspectable outcome history and operator feedback;
  it does not mean model training or automatic strategy adaptation.

## Measurement rules

Evaluation reads the approved stored `PlanHandoff`, current immutable plan hash, successful non-dry execution,
canonical immediate `ActionOutcome`, exact adapter receipt and all its scoped callback events before assessing
an action. The callback's simulation timestamp anchors the pre window. A post window starts there, or at an
explicit later simulation timestamp; its duration is the plan's longest success criterion. Each criterion also
uses its own stated duration. The baseline ends at the action timestamp and has the same duration. Windows are
half-open and comparisons use the same campaign and GBP minor units.

Advertising metrics come from actual `ad.metrics_observed` events, deduplicated by campaign and observation
window. A completed comparison requires contiguous, nonoverlapping full coverage in both windows, a post
observation received after the action receipt, and a simulation clock past the post window. Spend, impressions,
clicks, CTR, attributed orders, attributed revenue, ROAS and cost per acquisition use the recorded counters;
zero denominators produce unavailable rates. The assessment references matching persisted snapshots when they
exist and always stores the exact callback and observation event IDs. It does not persist fabricated snapshots.

Criterion directions compare exact values or the plan's explicit target, with no invented percentage tolerance.
Campaign `orders` means **campaign-attributed** orders in this evaluator. “Observed improvement” requires ROAS
to rise without a decline in attributed orders or attributed revenue. Lower ROAS or fewer attributed orders
is deterioration. Other complete results are unchanged; missing spend/coverage yields inconclusive. These are
observational comparisons, not causal or statistically significant claims. The simulator uses budget for ad
pacing, but subsequent clicks and orders also depend on audience, scenario and random variation.

Delay notices report the intended/reached simulated cohort and duplicate suppression from exact callbacks and
test-inbox records. Banners report their persisted content, schedule and visibility at the run's virtual time.
Neither action receives an inferred shipping or conversion benefit without a comparable linked cohort. When
their measurement clock expires without such evidence, the result is **insufficient data**, while verified
operational delivery remains visible. Assessment writes never call adapters, reapprove plans, tick a run or
change business state.

## Recorded Stage 7 outcomes

`scripts/demo-stage8.ts` assessed the existing isolated executions without a provider request or business action.
Its [saved result](stage8-runs/demonstration.json) has three durable records:

| Run / action | Applied state | Business assessment |
| --- | --- | --- |
| `stage7_1792893488465` / `cmp_basketball_search` | Budget **9000 → 6750 GBP minor units**, receipt and callback verified | **Pending measurement.** Before: 30/30 h, £122.31 spend, 8,730 impressions, 52 clicks, zero attributed orders and £0 attributed revenue. After: 0/30 h. No ROAS, profit or sales improvement claimed. |
| `stage7_shipping_1792893488698` / delay notice | **2/2 intended recipients** in the demo inbox, zero duplicates | **Pending measurement**; no linked recipient cohort to assess later shipping/support effect. |
| Same shipping run / factual banner | Publication, persisted schedule and virtual-time visibility verified | **Pending measurement**; no exposed conversion cohort to assess downstream impact. |

The original advertising investigation, approved plan, execution receipt and simulation clock were reused.
The shipping diagnosis is the explicitly labelled Stage 7 test fixture.

A **separate controlled simulator run**, `stage8_1792895970876`, copied the saved genuine Stage 5/6 advertising
plan without a model call. It received its own explicit demo approval and adapter receipt, then advanced 30
virtual hours through the unchanged simulator. The [saved observation](stage8-runs/controlled-observation.json)
has complete 30/30 h windows on both sides: campaign spend **£122.31 → £91.92**, impressions **8,730 → 6,558**,
clicks **52 → 32**, CTR **0.60% → 0.49%**, attributed orders **0 → 0**, attributed revenue **£0 → £0** and
ROAS **0 → 0**. The assessment is **completed, no observed return improvement**; its spend-decrease and
order-maintenance criteria are met, while the CTR-increase criterion is **not met**. This is an observed
comparison, not evidence that the budget change caused the CTR decline. The controlled run did not alter Stage 7
records or active selection. Test-only positive and negative outcome classifications also use clearly labelled
synthetic metric fixtures. No positive result was manufactured in the saved live demonstration.

## Verification

- Focused Vitest/MongoDB: **27 passed** across Stage 8 measurement (4), Stage 8 integration (5), existing Stage 7
  execution (11) and unchanged detector leakage guard (7). Covers pending results, supported improvement and
  deterioration, complete coverage and gaps, duplicates/conflicts, exact business/run, absent execution, zero
  denominators, shipping notice/banner verification, feedback isolation, historical windows and no business
  mutations during evaluation. The positive/negative metric cases are synthetic test fixtures.
- Canonical contract typechecking and all **15 contract examples passed**. TypeScript passed. ESLint passed with
  its existing **14 retained partner UI unused-code warnings** and no errors. Production build passed.
- Desktop Chromium against a clean production build: **1/1 passed**. It inspected the saved advertising
  assessment and actual receipt, verified unavailable post metrics, re-evaluated idempotently, followed the
  reviewed plan and investigation links, inspected both shipping actions and the completed controlled
  comparison, and refreshed the page with zero page errors. Screenshots:
  [advertising](stage8-runs/outcomes-advertising.png), [controlled comparison](stage8-runs/outcomes-controlled.png),
  [shipping](stage8-runs/outcomes-shipping.png), [investigation](stage8-runs/outcomes-investigation.png).
  Machine-readable browser checks: [browser.json](stage8-runs/browser.json).
- Before/after hashes matched for **all 44 pre-existing collections**, including Stage 7 approvals, executions,
  receipts and original Stage 5/6 records. The three Stage 7 assessments live in the new outcome collection;
  the controlled copy and its assessment are scoped under `stage8_`. `demo_nike` and active run selection are
  unchanged. See
  [preservation before](stage8-runs/preservation-before.json) and
  [after](stage8-runs/preservation-after.json).
- No full regression, mobile/tablet run or multi-seed evaluation was performed. No commit or push was made.

Read-only re-audit of the saved assessments and preservation:

```sh
node --conditions=react-server --import tsx scripts/demo-stage8.ts
node --conditions=react-server --import tsx scripts/stage8-preservation.ts
```

The on-demand evaluator is not a scheduled worker. It will report pending results until new simulated
observations exist, and its window-level associations should not be interpreted as controlled causal effects.
Future planners can inspect `GET /api/outcomes` for bounded history; the Stage 6 prompt/context fingerprint is
unchanged, so there is no automatic outcome-to-planner adaptation or Mubit training claim.
