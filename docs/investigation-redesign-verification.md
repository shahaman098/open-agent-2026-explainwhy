# Investigation decision canvas — 25 October 2026

The default Investigation page is now a compact **Signal → Evidence → Decision / Plan → Outcome** board. Its white surface, Poppins typography, charcoal outlines, navigation, buttons and restrained green accents follow Overview. The supplied reference informed the connected four-column layout; no sample figures, creative imagery or invented actions were copied.

Only the incident heading, a short summary, actual signal deltas, one campaign comparison preview, the readable action change and a concise outcome state appear by default. Full reports and working tools are no longer permanently visible below the board.

Clicking any block opens a native modal panel on the right with an entrance animation, backdrop, close control, Escape support, focus containment and focus restoration. Panel tabs expose exact anomalies and investigation controls; internal/external evidence, source previews and tool traces; selected/alternative strategies, exact parameters, safeguards and approval links; and the original execution receipt, Stage 8 comparisons, criteria, limitations and feedback. Citations switch to the evidence panel and resolve to their source record. Reduced-motion preferences are respected.

Implementation: `InvestigationCanvas.tsx` supplies the board and panel; `InvestigationStory.tsx` joins existing scoped read APIs; `InvestigationWorkspace.tsx` supplies the existing tools inside panels; the advisory archive uses the same canvas. The existing Stage 8 assessment detail is reused in the Outcome panel. No backend logic, canonical contract, validator or execution behavior changed.

## Saved examples

- **Stage 7 advertising:** Basketball Shoes — Search (Google), executed **£90.00 → £67.50/day**; its own business outcome remains **pending measurement**, with 0/30 post-action hours. [Desktop canvas](investigation-redesign/advertising-desktop.png), [Outcome sidebar](investigation-redesign/outcome-sidebar-desktop.png).
- **Separate controlled Stage 8 run:** completed 30-hour comparison, CTR **0.60% → 0.49%**, **criteria not met**. The panel includes spend **£122.31 → £91.92** and the unchanged zero attributed orders/ROAS. [Desktop canvas](investigation-redesign/controlled-desktop.png).
- **Checkout archive:** advisory-only canvas, three saved strategies inside the Decision panel, archived evidence references and no executable action. [Desktop canvas](investigation-redesign/checkout-advisory-desktop.png).

## Verification

TypeScript, ESLint (0 errors; 14 existing partner UI warnings), production build and `git diff --check` passed. Focused desktop Chromium passed **4/4 canvas checks**, covering every panel, animation, Escape/focus restoration, real source navigation, exact parameters and receipt, refresh, scope separation, unavailable-status handling and zero API write requests from viewing. The existing Stage 8 desktop test also passed **1/1**. Existing investigation browser tests were updated to open the appropriate panels while retaining their data and behavior assertions. No mobile/tablet run, long regression, provider request, commit or push was made by this work.

An additional source-card browser test completed its source attribution, filtering, citation, navigation and isolation assertions, then **failed its unchanged-data guard**. Separately launched monitor, investigator and planner worker processes appeared during verification; the monitor changed detection/monitoring records while the test was running. That guard was retained. The later historical Stage 8 global hash audit also reports a mismatch.

The audit still matches **32 of 44 historical collection hashes**, including business events, products, campaigns, orders, messages, original evidence/reports/model-call records, plans, approvals, executions and receipts. `demo_nike` remains the active selection. The changed collections are monitoring/detection state, investigations, metric snapshots and simulator bookkeeping. The canvas browser checks independently confirm identical approval and assessment responses before/after viewing and **zero API mutations**. Full global preservation cannot be claimed while that concurrent activity is present. Details: [audit summary](investigation-redesign/preservation-audit.json), [observed snapshot](investigation-redesign/preservation-current.json). Historical Stage 5/8 passing artifacts were retained; the new audit is stored separately.
