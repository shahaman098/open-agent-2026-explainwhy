# Stage 7 acceptance — 25 October 2026

Partner approval/execution and frontend replacement are implemented and pass the isolated demonstration.
ExplainWhy's investigator, planner, canonical contracts, MongoDB and simulator adapters remain authoritative.
No wholesale merge, D1 database, independent simulator, additional Mubit request, commit or push was made.

## Source and recovery

Partner UI components and compatible orchestration patterns were adapted into this codebase without merging unrelated histories. Private environment files remain outside the repository.

Read the installed Next.js route/migration documentation before implementation. Shared contract definitions
and adapter mutation functions are unchanged.

## Integrated experience

- **Approval and execution:** `src/execution/`, `src/agents/`, the adapted partner `PlanReview`, and real Approvals
  and Activity pages. Submitted planner proposals enter exact-version human review; approval and execution are
  separate controls. Canonical `PlanApproval`, `AgentMission`, `ActionExecution` and `ActionOutcome` records are
  persisted alongside scoped agent runs and existing adapter receipts.
- **Meta Ads Manager:** the partner-derived campaign interface is now `src/components/partner/MetaAdsManager.tsx`,
  used by `/ads` and existing `/dashboard/campaigns/:id` deep links. The obsolete ExplainWhy component was removed.
  The partner layout, navigation, table, cards, chart panel, filters, search and sorting remain. The existing
  campaign API supplies actual scoped budgets/status/platform, spend, impressions, clicks, CTR, attributed orders,
  revenue, ROAS, daily history, equal-length previous-period comparisons and action receipts. Unsupported direct
  mutations are disabled; budget review routes through Approvals. GBP minor units are converted only for display.
- **Nike Storefront:** the partner storefront replaces `/demo-store`, with `/store` as an alias. Its product cards,
  filters, navigation, detail drawer, image thumbnails, bag and wishlist use the existing 17 MongoDB products.
  Product IDs, prices, inventory and descriptions come from ExplainWhy Agent records. Checkout uses the existing idempotent
  checkout endpoint and server prices; no parallel order system was introduced. Approved active banners use the
  selected run's simulation clock. The interface explicitly identifies an unaffiliated simulation.
- **Product imagery:** **17/17 products, 141 local images**. Working original reference imagery is retained;
  supplemental public Nike imagery is accepted only after exact style identity verification. Partner image
  assignments that mismatched ExplainWhy products were not reused. A stable reference-ID/style manifest joins images
  to products without altering MongoDB catalogue records. Multiple images and detail thumbnails remain available;
  missing images have a graceful fallback. No image proxy or generated product imagery was added.
- **Shopify:** the original partner synthetic orders, metrics, animation and visual presentation remain at
  `/shopify`. Its former simulator-tick request was removed; the demo is local and explicitly labelled
  “Synthetic Shopify intro demo · no live connection.” Its fixture block hash matches the partner source and
  it imports no MongoDB, simulator or execution code.
- **Navigation:** Overview → Signals → Investigation → Proposed Plan → Approvals → Execution Activity now has
  working scoped entry points. Meta and Nike links preserve the selected run. Stable campaign/product IDs are
  shared across evidence, planning, execution and the replacement frontends.

## Approval and execution guarantees

The canonical `GET /api/plans/:id?businessId=...&simulationRunId=...&planVersion=...` semantics are preserved.
New approval, execution and execution-history routes require the same explicit scope. Only a validated,
selected, submitted planner version can be approved. A decision binds the canonical plan hash, approved action
IDs, target-state digests and a server-derived reviewer; dependent actions require their prerequisites.
Decisions are immutable and expire after at most 30 minutes, bounded by plan expiry.

Execution rechecks approval, selected version, plan integrity/expiry, ownership, exact parameters and current
target state. The shared simulator run lock prevents concurrent ticks during the normal bounded execution.
A durable unique run claim prevents duplicate requests; stable action keys also use the existing adapter
idempotency receipts. Dispatch is allowlisted by agent and action. Each action is verified by reading persisted
state and its canonical callbacks. A failure stops further actions, retains successful receipts and does not
silently replay ambiguous work.

Plans remain immutable after execution; status is represented in approval/run records. A post-execution canonical
handoff correctly rejects a now-changed target. Activity renders the saved reviewed snapshot for historical review.
Outcome verification describes the applied state, not a claim about later revenue or model learning.

## Recorded isolated demonstrations

### Advertising

The final demonstration used `nike_demo / stage7_1792893488465`, an isolated copy of the genuine saved Stage 5/6
advertising investigation and plan. Source: `stage5_1792885194280 / plan_plj_c70db54aa7f98907532859f2`, version 1.
The copy retains the original expiry; no fresh diagnosis, strategy or model call was claimed.

Reviewed plan: `stage7_1792893488465_plan_plj_c70db54aa7f98907532859f2`, **version 1**.
Approval: `approval_42075282-601d-4e26-a358-390bde15dd57`.
The integrated browser workflow explicitly approved and then executed `ads.set_daily_budget` for
`cmp_basketball_search`: **9000 → 6750 GBP minor units (£90 → £67.50/day)**.
MongoDB read-back and the refreshed Meta table agree. Exactly **one durable adapter receipt** and one budget
callback were verified. Approval/execution survived page refresh. Unapproved and duplicate attempts returned
409; focused MongoDB tests also reject stale targets, tampered parameters, foreign scope, expired approval and
superseded versions.

### Nike and shipping

The replacement storefront loaded all 17 products from MongoDB. Desktop Chromium decoded every catalogue
card's actual image, exercised filtering and a second product-detail thumbnail, then purchased through the
existing checkout. One new simulated storefront order persisted in the advertising acceptance run.

Shipping used a clearly labelled **test fixture**, `stage7_shipping_1792893488698`, plan
`plan_plj_5922b64e2054da6a61cebc40`, version 1. It did not claim a fresh live investigation or Mubit diagnosis.
The UI approved and executed the ordered notice → banner actions. Two notices were saved to the demo test inbox,
then the factual banner appeared on the replacement storefront:

> Some deliveries are taking longer than usual. Check your order status for updates.

Both actions have verified durable receipts and callbacks. No real email, external store or advertising account
was changed. See [audit.json](stage7-runs/audit.json) for the saved execution IDs, read-back checks and order.

## Verification and preservation

- **31 focused tests passed across four files**, over focused runs: execution integration (11), existing planner
  validation and adapters (13 combined), and the unchanged detector leakage guard (7). Coverage includes canonical
  records, ownership/run isolation, exact versions, concurrency/idempotency, stale/expired/tampered proposals,
  shipping dependencies, partial failure, deduplicated campaign metrics/history, catalogue assets and Shopify isolation.
- **Desktop Chromium: 1/1 passed**, 15.9 seconds for the case (17.0 seconds total), against a clean production
  build. It checked real approval/execution, refresh persistence, actual campaign updates, catalogue image loading,
  detail browsing, checkout, the ordered shipping proposal, visible banner and Shopify rendering. No page errors.
- **TypeScript, contract typechecking and all 15 contract examples passed.** Production build passed.
  ESLint has **0 errors, 14 unused-code warnings** in retained partner UI code (3 Meta, 11 Shopify).
  `git diff --check` passed.
- Development verification was not entirely green on the first attempt: an image-manifest test ran while PNG
  assets were being converted to WebP and was rerun after the manifest settled. The first browser attempt needed
  the banner's existing “Notice:” prefix in its locator. The second completed functional checks but detected stale
  development-server hydration markup after hot reload. A clean production build passed the unchanged page-error
  assertion. Earlier isolated acceptance copies and their receipts are retained; no failed run was represented as
  the final result. Obsolete “integration pending” assertions in existing e2e files were updated for the implemented
  entry points; safety assertions were retained.
- **Before/after hashes match for all 39 original collections**, excluding only new `stage7_`-scoped records.
  All `businesses` and reference records were included. `demo_nike`, active selection, original Stage 5/6 reports,
  model-call ledger and saved plans are unchanged; active selection remains **`demo_nike`**. The original plan hash
  also matches the isolated-copy manifest. Canonical contracts, original adapter logic and existing test files
  remain available.
- No full regression, mobile/tablet test, multi-seed simulator evaluation or additional Mubit request was run.

Artifacts: [browser.json](stage7-runs/browser.json), [audit.json](stage7-runs/audit.json),
[acceptance.json](stage7-runs/acceptance.json), [shipping fixture](stage7-runs/shipping-fixture.json),
[preservation before](stage7-runs/preservation-before.json), [preservation after](stage7-runs/preservation-after.json),
[Meta before](stage7-runs/meta-before.png), [Meta after](stage7-runs/meta-after.png),
[approval/execution](stage7-runs/approval-execution.png), [Nike storefront](stage7-runs/nike-storefront.png),
[Nike banner](stage7-runs/nike-banner.png), and [Shopify](stage7-runs/shopify.png).

Read-only re-audit, without approving, executing or requesting a model:

```sh
node --conditions=react-server --import tsx scripts/audit-stage7.ts
node --conditions=react-server --import tsx scripts/stage7-preservation.ts
```

`scripts/prepare-stage7.ts` and `scripts/prepare-stage7-shipping.ts` create fresh isolated demonstration copies;
they do not change active selection. The advertising preparer deliberately fails once its source plan expires.
The focused browser case performs real simulated writes and requires unused, eligible acceptance copies.

## Remaining limits

This is a working development/demo workflow. Production user identity and RBAC are not implemented; approval
routes use the existing development/demo-key gate. Execution is synchronous with durable records and a bounded
run lock, not an always-on recovery worker. A process interruption can leave a running/needs-review record that
requires manual reconciliation; it is never automatically replayed. Later business-impact measurement and learning
are not implemented. Planner workers and provider price configuration remain existing operational work.

Unmodelled ad-set/ad actions, store sizes and other unsupported controls are disabled or labelled. Local bag and
wishlist state are presentation state; completed checkout orders persist in MongoDB. Shopify remains intentionally
synthetic. No commit or push was made.
