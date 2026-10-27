# Stage 5 continuation verification

This report records continuation of the existing implementation on 24 October 2026. It does not supersede the original implementation report or claim that Stage 6 is implemented.

**Latest acceptance, 25 October 2026:** the final external source-card integration check passed using the two genuine persisted Nike source records in a read-only browser fixture. Focused tests passed **64/64**, desktop Chromium **1/1**, TypeScript passed, and ESLint passed with the existing 37 campaign-component warnings. Recommend **qualified Stage 5 demonstration sign-off under the explicitly permitted isolated-integration fallback**. Spontaneous research delegation and incorporation into a source-relevant live AI report remain unverified; the current full regression remains pending. The 307/307 full-suite result below is the previous baseline. Exact method, artifacts and limitations are recorded in the final section.

## Scope and preservation

The checkout was already dirty. Existing campaign UI, Signals grouping, investigator modules, scripts and tests were retained, including the prior deletion of `CampaignWorkspace.tsx`. No architecture replacement, reset, commit, or deployment was performed. Credentials were not copied into reports.

The original failed investigation and successful advertising artifacts remain in `docs/stage5-runs/`. New scenario evaluations use unique `nike_eval/s5eval_*` scopes; `--cleanup` removes only the newly created evaluation scope after saving its report and metrics. The browser demonstration uses a unique `nike_demo/stage5_*` run with `makeActive: false`. The demonstration script hashes every existing `demo_nike` record, by collection, and checks the active selection separately. The general Playwright fixtures temporarily select their own storefront run and restore the prior active selection in global teardown. These two checks must run sequentially: the initial concurrent preparation correctly detected the temporary selection change and stopped, with all previously scoped `demo_nike` collection hashes unchanged. A final preservation pass corrected the ground-truth collection's distinct key shape and found its one `demo_nike` record; all 36 other collection hashes, simulator state and active selection matched the pre-browser baseline. The old pre-browser ground-truth hash is unavailable because its original filter returned no rows. The refreshed full baseline then matched the post-investigation database exactly, with `active: demo_nike`.

## Changes made during continuation

- Verified the existing run-ID projection fix; the focused Signals/database suite passed all 14 tests.
- Kept unsupported Mubit request metadata out of provider requests. Added persisted task fingerprints over task/version/system/schema/tool definitions, separate from per-call input checksums. Changing sessions or evidence does not change the task fingerprint.
- The live browser job's two reasoning calls persisted the same task fingerprint (`84c6043a92ececbce8b80021b81109388bcc15b2a6f3dbac0cba3cd524216d98`) with different input checksums. The final diagnosis task had its own fingerprint. No unsupported fingerprint field was sent to Mubit.
- Refreshed internal evidence during investigation progress, exposed external claim links and claim-support status, and added report validation, evidence-gap and planner-readiness details in the existing workspace.
- Replaced the overview's stale “Awaiting Mubit integration” text with the implemented entry point and saved-diagnosis count.
- Fixed a real fallback failure found during evaluation: older assessments could put an evidence ID in both support and contradiction. The fallback now preserves counterevidence, removes overlapping support, and remains an insufficient-evidence report. New reasoning decisions must use disjoint roles and retain previously recorded contradictions.
- Tightened source timestamp checks so impossible calendar dates and inconsistent publication/update metadata cannot establish temporal eligibility. Publisher is explicitly the retrieved HTTPS host, not an independently authenticated corporate identity.
- Corrected evaluation publication windows to comply with the 72-hour contract, then added daily monitoring throughout the documented scenario duration. End-only scans can find an episode after it has resolved and therefore never open an investigation. Scenario names are confined to setup and post-inference selection/scoring, never supplied to the investigator.
- Added opt-in real-provider Playwright coverage and a scoped worker invocation for an isolated demonstration. Updated stale browser assertions to the existing dashboard and disclaimer text.

## Implemented boundaries

The investigator uses persisted queue state, leases and fencing, scoped canonical observations, bounded reasoning/repair rounds, server-validated tool selection, internal source resolution, separately checked research candidates, and one validated diagnosis to derive the report, brief, impact and non-executable handoff. Publication of the diagnosis/report/job state is transactional. Refreshes reuse the saved report. Pending requests recovered after a crash are not automatically replayed because their billing outcome is unknown.

The workspace shows job progress, hypothesis revisions, tool parameters/outcomes, internal evidence, public-source checks, citations, the complete report, impact, and planner readiness. A separately running investigator worker is required; clicking Start queues durable work. For an isolated run:

```sh
node --conditions=react-server --import tsx scripts/demo-stage5.ts --prepare
node --conditions=react-server --import tsx scripts/investigator-worker.ts --once --run=RUN --investigation=INVESTIGATION
```

Use the workspace Start button before the scoped worker command. The opt-in browser test performs both actions. The general worker command is `npm run investigator:work`; it is not scoped and was not used for the preservation demonstration.

## Verification results

The isolated live browser demonstration passed both desktop and mobile. The desktop test observed queued and running states, successive hypothesis and tool activity, and internal evidence rising from zero to three records while the Mubit worker ran. It resolved all three cited evidence links, opened the complete report and handoff, and confirmed that the same report and call ledger survived refresh. Mobile reopened that persisted report, checked its citations and layout, and also passed. The browser traces and screenshots are `stage5-runs/stage5_1792875248236_{desktop,mobile}-chromium_browser.json` and matching PNG files. The workspace path is `/dashboard/investigations/inv_stage5_1792875248236_d07498fe5b17?run=stage5_1792875248236`.

This live job used three actual Mubit requests (`mreq_01a16fc74bb177d0a4771451180ca1a1`, `mreq_01a16fc7ae6b7070964fdca449dd570a`, `mreq_01a16fc7f9757342bf555468825264c1`), three internal tools, three verified canonical evidence records, and 9,559 reported tokens. Its final diagnosis request returned HTTP 503. The fenced deterministic fallback therefore persisted an **insufficient-evidence** report with an `unknown` primary cause, three resolvable citations, seven sections, four claims, an observed business-impact measurement, `validation.passed: true`, and `handoff.ready: false`. It did not mislabel the gateway failure as a supported cause. `stage5-runs/stage5_1792875248236.json` records the full report, request metadata and preservation check.

A separate earlier, still preserved live Mubit evaluation (`stage5-runs/s5eval_1792874205409_0_0.json`) produced a **completed** advertising diagnosis: ad fatigue was the qualified primary cause after seven tools, six verified evidence records, four hypothesis revisions, four resolved citations and five Mubit calls (30,068 reported tokens). Its seven report sections, three claims, six ledger entries, measured impact and read-only handoff agree with the same validated diagnosis. This demonstrates the supported-diagnosis branch; the new browser run demonstrates the provider-failure and insufficient-evidence branch end to end.

The six-scenario continuation evaluation (`stage5-runs/evaluation_1792875702318.json`) used one held-out seed per documented window and daily monitoring: healthy produced no incident; advertising, shipping and viral demand each opened an investigation and persisted an honest insufficient-evidence report with zero invalid internal citations (5, 3 and 8 citation references respectively); reviews opened an investigation but encountered a provider HTTP 503 and persisted an unknown-cause report; checkout produced a detector incident but did not open an investigation because checkout and coupon failure signals had no canonical Anomaly metric under the then-current contract. This was a genuine eligibility gap, not a fabricated no-incident result. The run made 19 Mubit calls, used 86,769 reported tokens, and returned no external research delegation. Research connectivity and source verification were therefore checked separately below. Model costs remain unestimated.

| Scenario | Detector / investigation | Report result | Internal evidence / citations | Mubit calls | Elapsed |
| --- | --- | --- | ---: | ---: | ---: |
| Healthy | No incident | No report expected | 0 / 0 | 0 | 36.9 s |
| Advertising fatigue | Incident / eligible | Insufficient evidence | 5 / 5 | 6 | 288.5 s |
| Delivery delays | Incident / eligible | Insufficient evidence | 3 / 3 | 5 | 146.5 s |
| Viral demand | Incident / eligible | Insufficient evidence | 5 / 8 | 5 | 255.6 s |
| Negative reviews | Incident / eligible | Provider error; insufficient evidence | 0 / 0 | 3 | 162.2 s |
| Promo checkout failure | Incident / ineligible | No investigator run; canonical contract gap | 0 / 0 | 0 | 33.6 s |

The saved-artifact audit in `stage5-runs/report-audit.json` passed 13 consistency checks for each of six reports, covering the shared diagnosis and brief, report ID, hypothesis history, claim and citation links, impact link, read-only handoff, status, and Mubit request attribution. A read-only MongoDB check confirmed that both the earlier supported advertising diagnosis and the new browser-demonstrated insufficient-evidence report remain persisted with their validation status. Four orphan diagnoses from this continuation's cleaned evaluation fixtures were removed using exact `nike_eval` run IDs; `deleteRun` now includes diagnoses so subsequent cleanup is complete.

The general desktop/mobile Playwright suite passed all 32 tests after stale test selectors were brought into line with the current dashboard. The first complete Vitest run passed 302 of 303 tests; the simulator restart case timed out at 60 seconds while evaluation and browser workloads shared the Atlas cluster. That same file passed all seven tests when rerun alone. The clean, complete rerun passed **303 of 303 tests across 51 files** in 1,179.92 seconds.

Already established in this continuation:

- Focused Signals/MongoDB suite: 14 passing tests.
- MongoDB investigator workflow suite: 11 passing tests, including active cancellation, bounded repair, crash recovery and research provenance fixtures.
- Provider, source and diagnosis unit checks: 52 passing tests after the source-date and fallback fixes.
- Desktop/mobile Playwright: 32 passing tests, including two live-report browser checks.
- TypeScript and contract typechecking passed; all 15 contract examples validated. The contract runner required sandbox escalation for its local IPC socket.
- Lint and production build passed after the application edits. The final script change passed a subsequent TypeScript check; `git diff --check` is clean.
- Real structured output: `mreq_01a16fadcd6879b3bb6aebebf1316cba`.
- Real function call: `mreq_01a16fadd11d7af2a395166d1e2131eb`.
- Invalid model correctly returned HTTP 400: `mreq_01a16fadd41c7540a85f3bc58d9c5dfe`.
- Real Gemini Search grounding: `mreq_01a16fadd4367f02804ac7fba187f05a`.
- Separate research/retrieval check: `mreq_01a16fb34e43712080b07821010c8e0a`, saved in `stage5-runs/research_1792875388729.json`. Both grounded redirect candidates were unavailable under the robots/retrieval policy. Neither became accepted evidence.
- Production research function call: `mreq_01a16fcb684c7ed2af98ac57f61d9cf4`, saved in `stage5-runs/research_1792876963753.json`. Mubit returned successfully but provided no grounding metadata or candidates; the function accepted no external source.

## Limits that remain explicit

- Search grounding is discovery. It is not independent verification of accessibility, publisher identity, event chronology, claim support, or causation.
- External page dates and authors are metadata; unavailable, undated, inconsistent, unsupported or later sources are retained with their failed/unknown status. Semantic passage support is model assessed, not deterministic proof. Public sources cannot establish the cause of a synthetic incident.
- The financial impact is a deterministic observed hourly revenue difference where a unique comparable aggregate exists. It is not a causal financial loss estimate.
- Model probabilities are not calibrated. Provider rates are not configured, so costs are unknown rather than reported as zero.
- Provider timeouts and ambiguous outcomes are not automatically retried. Invalid structured decisions have one bounded repair; retries and recovered pending requests have separate durable records.
- The application retains its development/demo access boundary. Production authentication/deployment and an always-on worker service are not established by a successful build.
- Stage 6 planning/execution, executable plans, approval execution and business mutations remain unimplemented and outside this work. The handoff is read-only with `executable: false`.

## Engineering disposition

| Status | Feature or gate | Evidence and remaining work |
| --- | --- | --- |
| Completed and verified | Durable investigator, bounded Mubit reasoning, canonical internal evidence, validated diagnosis/report/brief/impact/handoff, and live workspace progress | MongoDB workflow tests, saved positive and insufficient-evidence diagnoses, report audit, and desktop/mobile live browser run above. |
| Completed and verified | Signals run-ID projection and source-verification boundaries | Focused Signals suite passed; source fixtures cover safe URLs, retrieval failure, impossible and inconsistent dates, duplicates, contradictory claim support, and lack of automatic trust from grounding. |
| Verification blocked by live source outcomes | An independently accepted external source in a live investigation | Real Mubit Gemini Search grounding and the production research route worked, but one retrieval set was unavailable and another returned no candidates. No external source was accepted or cited as verified in the live runs. |
| Repaired and verified in follow-up | Checkout/coupon incident investigation eligibility | The earlier evaluation correctly declined to start. The follow-up contract and snapshot repair produced a canonical anomaly and queued investigation in a fresh detector run; see below. |
| Operationally unestablished | Always-on worker, production authentication/deployment, and provider cost accounting | The local worker, scoped demo worker, and production build work; service deployment, production access controls, provider prices, and cost totals were not established. |
| Unimplemented by scope | Stage 6 planning, executable approval and business changes | The current handoff is read-only and explicitly non-executable. |

Stage 5 is **not declared complete** here. The positive diagnosis and browser-demonstrated insufficient-evidence paths are both persisted and internally validated. The checkout eligibility gap was repaired in the follow-up below; live external-source acceptance remains open.

## Follow-up repair on 24 October 2026

The checkout gap recorded above describes the earlier evaluation artifact. The contract now accepts `checkout_failure_rate` and `coupon_failure_rate` as canonical Anomaly metrics. Global MetricSnapshots calculate matching failure counters and rates from persisted `checkout.failed` events; old snapshots remain parseable, and global windows missing the new rates are refreshed before a new anomaly cites them. A fresh seed-11 checkout scenario, monitored daily across its documented 96-hour incident window, produced a conversion incident, canonical checkout anomaly, and queued investigation. The anomaly values reconciled with their cited current and baseline snapshots. This test used the detector's output and did not insert an incident.

A final-diagnosis provider error now leaves the job in `failed` with its error and request ledger, while preserving a validated, provisional unknown-cause report for review. A reasoning-stage provider error followed by an accepted but unknown final diagnosis also remains a provider failure, with a distinct error explaining that sequence. A genuine insufficient-evidence decision without provider failure remains `insufficient_evidence`. A Mubit HTTP 503 with `x-should-retry: true` remains marked retryable and ambiguous, and is **not automatically replayed**; the focused provider test observed exactly one outbound request. The MongoDB workflow tests confirmed persisted failed states, provisional reports, request IDs and no second claim. The workspace labels such a report as a provider-failure provisional report.

Follow-up gates passed: source/provider unit tests 45/45 (including 31 source-verification cases), investigator MongoDB workflow 13/13 after the final reasoning-stage edit, checkout compatibility 1/1, analytics metrics 6/6, canonical anomaly/database 14/14, detector rules and scenarios 25/25, existing detector-to-investigation workflow 9/9, TypeScript, lint, contract typechecking and all 15 contract examples, and production build. The complete Vitest suite passed **307/307 tests across 52 files** in 1,221.91 seconds. The saved-report audit passed all 13 checks for each of seven artifacts. The prior live external-source outcome remains unchanged: no independent source was accepted in the saved live runs.

A separate real Mubit checkout evaluation used a new `nike_eval/s5eval_1792881375759_0_0` scope, held-out seed 11, the documented 96-hour scenario window and daily scans. The detector found an eligible conversion incident. The investigator made three actual Mubit calls (`mreq_01a1700f53ac70538018c9ad42a5dd69`, `mreq_01a1700f8e8677a1b3a0752933309808`, `mreq_01a1700fd38f733396050620e07b83ae`), reported 11,735 tokens, revised hypotheses twice, and completed with a qualified `discount_failure` primary cause. The seven-section report passed validation, cited two internal evidence records four times with zero unresolved references, and produced a ready, non-executable handoff. No external research was delegated. The model cost remains unknown because provider rates are not configured. The isolated database scope was removed after saving `stage5-runs/s5eval_1792881375759_0_0.json` and `stage5-runs/evaluation_1792881375759.json`; `demo_nike` was not selected or modified by this evaluation.

## Final acceptance continuation on 25 October 2026

### External source audit and positive/negative check

The earlier live failures had two concrete boundaries. Gemini Search sometimes returned `vertexaisearch.cloud.google.com/grounding-api-redirect/...` URLs; the safe retriever refused them because the redirect host's robots policy was unavailable or restrictive, and did not bypass it. A separate production research request returned no grounding metadata or candidates. The verifier also read publication dates only from HTML meta tags, while the accessible Nike newsroom page stores its publication and modification times in JSON-LD. Original URLs printed in provider answer text were not previously considered candidates. These are distinct discovery, retrieval and metadata failures; none makes a grounded summary independently verified.

The verifier now reads bounded JSON-LD as data, validates calendar dates, retains the original HTTPS URL, records the retrieved host, and accepts a source-provided `og:image` only from the same host or its subdomain. Original URLs in Mubit answer text are discovery candidates; malformed, private and grounding redirect URLs are dropped before independent retrieval. The investigator exposes only separately assessed, time-eligible public context to its next reasoning round. Claim support, host identity and incident relevance remain separate recorded states. A recognized official domain indicates host attribution, not historical archival proof.

An isolated `nike_eval/source_acceptance_1792885169199` acceptance run used real Gemini Search through Mubit (`mreq_01a170489d8b7320a4f6e0cce4d9b774`) to discover the original [Nike operating-model announcement](https://about.nike.com/en/newsroom/releases/nike-inc-corporate-announcement-october-1-2026). The safe retriever returned HTTP 200 from `about.nike.com`; the document title, publication time (`2026-10-01T20:20:00Z`), modification time (`2026-10-05T20:30:16Z`), retrieval time and content hash were stored. Its actual 16-word passage was: “NIKE, Inc. today shared the following note with employees regarding changes to its operating model.” A separate Mubit source-support call (`mreq_01a17048cae175c0b135a31cce2a17a3`) assessed “NIKE shared an employee note about changes to its operating model” as supported by that passage. It assessed “The operating model change was caused by a Google Ads outage” as insufficient on the same page. Both claim records persisted in `external_sources` with distinct IDs under the isolated scope; the second is marked as a duplicate source URL, not independent corroboration. The supported result is **public context**, not evidence of the synthetic advertising incident's cause. Full records and request IDs are in `stage5-runs/source_acceptance_1792885169199.json`.

An independent HEAD check returned HTTP 200 for both the original article and its source-provided JPEG preview (16,615 bytes). The preview URL belongs to `nmp.about.nike.com`, a subdomain of the retrieved publisher host. The app does not proxy the image through its server.

The direct production research route was also called after the adapter change (`mreq_01a17046657a7aa286b40ac2f10cc1b8`). It returned no grounding metadata and no candidate for the requested advertising-platform disruption window. A separate targeted diagnostic Mubit request (`mreq_01a1704699bd7161ab20ac6b5b4f5d51`) did return a Nike original URL, establishing that the provider can supply original URLs when a suitable official source exists. Another search attempt returned one nonexistent slug and one Markdown-suffixed real URL; the extractor now removes terminal Markdown punctuation, while the nonexistent URL still requires an HTTP check. These outcomes are recorded separately and are not counted as verified incident evidence.

### Desktop workspace and real investigator output

The existing Investigation Workspace now places the persisted executive brief near the incident header and shows business/run, affected anomaly metrics, timeframe, investigator state and evidence count. It labels the run “Nike — Unaffiliated Simulation.” The brief, hypothesis comparison, revision history, tool timeline, report sections, impact, claim matrix and read-only handoff continue to use saved investigator records. The timeline shows persisted start times, durations, statuses and evidence links. Citations navigate to scoped evidence details; report findings show up to three cited cards. The Evidence Explorer filters internal/external records, verification and support role. Source cards expose the original link, publication and retrieval times, passage, claim-support status and limitations; failed candidates appear as unverified. Card presentation models validate values before rendering. Internal metric cards use actual measurements and saved daily revenue values when available; campaign cards use retrieved CTR/ROAS/spend/orders and resolve names/platforms from campaign records in the same business/run; operational records retain source details. External article cards use the source-provided image when validated; document, status, community and unverified variants have distinct text-first presentations. No campaign creative is shown as source-associated evidence because the current campaign evidence records do not link a specific creative asset. Visual inspection found an Overview `.metric` CSS rule affecting investigation cards; evidence variant classes are now prefixed and the final desktop screenshot shows values at the intended card scale.

A new detector-generated `nike_demo/stage5_1792885194280` advertising incident was opened in desktop Chromium. The browser saw queued/running progress, hypotheses and evidence arrivals, inspected the saved brief, internal cards, hypothesis details, all seven report sections and the handoff, followed a citation to its detail, and confirmed persistence after refresh. The worker made five actual Mubit requests (`mreq_01a1704a2da17a43bcdbc66d3a46f3d2`, `mreq_01a1704a5a4b7133ba6501a4451c390d`, `mreq_01a1704a8c8378108d91eee06fcbf883`, `mreq_01a1704ac9fc7db188efc2e1ea4c73e6`, `mreq_01a1704af83475c1acdc2ba82919b228`) and reported 30,477 tokens. It used seven internal tools, collected six verified evidence records, revised hypotheses four times, and saved a qualified `ad_inefficiency` diagnosis with four resolved citations, three claims, measured observed impact and a ready, non-executable handoff. It did not delegate external research; no external source is attributed to this report. The saved result is `stage5-runs/stage5_1792885194280.json` and the desktop browser record is `stage5-runs/stage5_1792885194280_desktop-chromium_browser.json`.

The isolated demo was prepared with `makeActive: false`. After the browser run, the preservation script compared every existing `demo_nike` collection hash and the active selection to its pre-run baseline and passed; the active selection remains `demo_nike`. The original `demo_nike` state was not reset or rewritten.

The desktop project ran 17 cases. Sixteen passed on the first project run; the remaining Stage 5 case failed only because its new timeline selector matched nested disclosure summaries. The selector was narrowed and the affected case passed on rerun. The final card-sizing change was also rerun through that focused desktop case. No tablet or mobile project was run for this acceptance continuation. The real source URL was opened separately in desktop Chromium and returned HTTP 200 with the expected title and heading.

### Acceptance decision

**Stage 5 is not yet declared complete.** Genuine Mubit-assisted external discovery, independent original-page retrieval, publication metadata, a supported narrow claim, an unsupported claim, persistence, typed card rendering and a new live desktop investigator report have been demonstrated. The missing combined acceptance path is an investigation in which the model warrants external research, its independently verified, contextually relevant source is incorporated into the persisted report, and a desktop user opens that verified source card from the same investigation. The real advertising run had no research delegation, and the official Nike announcement was intentionally kept out of its causal report. Campaign creative association, richer status-event timelines and an always-on production worker also remain unestablished. Provider cost is unknown because rates are not configured.

### Focused verification policy and latest results

The previous successful full regression remains **307/307 across 52 files**. It is historical baseline evidence, not a result for the current working tree. A later full run finished at **319/320 across 54 files**: the data-boundary guard rejected a campaign display-metadata query inside intelligence evidence retrieval. The query was moved into the operator-facing API enrichment helper, scoped by business/run with a limited projection; the guard was retained unchanged. Its focused leakage/evidence/card checks passed 25/25. The subsequent full rerun was gracefully interrupted with SIGINT (exit 130) after no useful progress. **The latest full regression was not completed and remains pending.** No full suite will block Stage 5 development; long simulator/MongoDB scenario suites are reserved for changes to their affected code or a focused regression. No tests were removed, weakened or permanently skipped to avoid execution.

Current verification after that repair:

| Check | Latest outcome |
| --- | --- |
| Focused source verification, evidence-card model/rendering, report-source, leakage and evidence tests | **62/62 across five files**, 51.70 seconds. |
| Desktop Chromium actual Investigation Workspace | **1/1 passed**, 5.7 seconds; reopened the saved live report without new provider requests. Verified scoped campaign labels/platform/link, clickable internal citations and evidence details, hypothesis/report/timeline disclosures, no horizontal overflow, identical report and call count after reload. |
| Campaign card destination after JSX repair | **Passed** in desktop Chromium at 1440×900: followed the scoped campaign href, waited for the actual named campaign, verified all five campaign rows and matching totals, and observed zero browser errors. See `stage5-runs/campaign-desktop-check.json` and `stage5-runs/stage5_1792885194280_campaign-desktop.png`. |
| Saved report audit | **13/13 consistency checks passed** for `stage5_1792885194280`; four cited evidence records resolve. See `stage5-runs/report-audit-final.json`. |
| External-source persistence | Read-only MongoDB check found both isolated positive and negative claim records, HTTP 200, supported/contextual versus insufficient/insufficient-evidence. `contextRelevance` remains `not_assessed`; these are separate acceptance records. Card rendering tests verify the original-source href and unsupported-state presentation. Opening a verified external card from the same live incident remains pending as described above. |
| TypeScript | **Passed** after repairing the incomplete campaign component's closing JSX. |
| ESLint | **Passed with 0 errors and 37 unused-code warnings** in `MetaAdsManager.tsx`. Corrected six `prefer-const` errors and scheduled/cancelled its initial fetch alongside the polling effect without suppressing rules. |
| `demo_nike` preservation | **Passed** again after the desktop workspace and campaign destination checks; all captured collection hashes and active selection match the baseline (`demoPreserved: true`). |
| Full regression | **Pending / latest rerun interrupted**, separate from the 307/307 previous baseline. |

During final verification `MetaAdsManager.tsx` was temporarily truncated mid-JSX. TypeScript and ESLint failures were recorded, and the user authorized repairing its ending. The missing outer closing element was restored; the final TypeScript and ESLint outcomes above supersede those temporary failures. The campaign API's backend scenario logic was not changed by that syntax/lint repair.

## Final external source-card integration acceptance — 25 October 2026

### Association and method

The accepted source `src_425e21019b7bed98dc2afc2c` and rejected assessment `src_aa8f07f021135a2a564c1abd` both remain persisted, unchanged, under `nike_eval / source_acceptance_1792885169199 / official_source_check`. Inspection found **zero investigations, jobs or AI reports** associated with that scope. The live advertising report has no research delegation and is not a suitable place to attach the announcement.

The production read path requires an investigation in the exact business/run and then a job before returning its report and sources: AI GET ownership gate → `readInvestigation` scoped Mongo queries → `AIInvestigation` → report citations/research details → `ExternalEvidenceCard`, with the same source data passed to `EvidenceExplorer`. Existing report composition restricts the External research section to time-eligible, passage-matched, supported, nonduplicate public context; rejected claim assessments stay in the claim/source ledger.

The user-permitted fallback was therefore used. `scripts/prepare-stage5-card-check.ts` reads the original Mongo records directly and passes them unchanged into the production report composer. It writes a **local integration report fixture**, explicitly labelled “no live AI run,” with an unknown cause and no internal evidence, model calls or research rounds. Playwright intercepts only the workspace's read responses for this isolated context and exercises the actual dashboard route/components. The report fixture is file-backed test data; it is **not a newly persisted Mongo AI report or a provider response**. Neither a synthetic incident nor a model research delegation was inserted. The original research and passage-assessment request IDs remain historical provenance only. No new provider requests were made.

### Presentation changes and exact checks

The small UI repair deduplicates repeated source IDs after checking exact business/run/investigation ownership. It preserves distinct claim assessments on the same URL and visibly marks the second as not independent corroboration. Rejected-status records remain unverified even if other stored fields appear positive. The supporting/verified filters require an HTTP-200, passage-matched, within-cutoff, supported, contextual, nonduplicate source. Source cards display a publication year and machine-readable date, and a visible public-context/noncausal limitation. The report no longer adds an uncited fallback source card when its external section has no source references; cards follow the report's actual references. Autonomous investigation decisions, provider calls, report persistence and backend source records were not changed.

The single desktop Chromium acceptance test `tests/e2e/stage5-source-card.spec.ts` passed **1/1 in 11.8 seconds** (test body 10.4 seconds), at 1280×720. It verified:

- The original title, `about.nike.com` attribution and recognized-official-host label; publication date **1 October 2026, 20:20 UTC**; the exact supported employee-note claim and retrieved passage; `supported`, HTTP 200, `contextual` and incident relevance `not assessed` statuses.
- The original validated preview URL loaded a real image (`complete` and positive natural width); the unsupported Google Ads claim had no preview, stayed visibly “Unverified research / insufficient,” and could not pass supporting or verified filters.
- Clicking **Original source** opened the actual [Nike announcement](https://about.nike.com/en/newsroom/releases/nike-inc-corporate-announcement-october-1-2026) in another Chromium tab with **HTTP 200**, the expected original URL and operating-model heading/title. The link uses `noopener noreferrer`.
- The production-composed External research section included only the supported source and claim. Both claim assessments had the correct source-anchor links; the unsupported claim stayed `insufficient evidence` in the claim ledger. The original source remains public context and is not promoted into a business-cause hypothesis.
- Refresh reloaded the same local report fixture and rendered exactly two claim cards. Deliberate repeated IDs and foreign-business/run/investigation source rows in the browser payload were filtered; distinct same-page claim records remained visible. Changing to a different run removed the cards and showed not-found. Separate requests to the real AI API returned **404** for the wrong business and wrong run.
- Only GET requests were made by the fixture UI, with zero browser errors and zero new provider calls.

Artifacts:

- `stage5-runs/source-card-integration-browser.json`: exact browser outcome and fixture disclosure.
- `stage5-runs/source-card-integration-desktop.png`: visually inspected workspace, accepted image card and visibly unverified negative claim.
- `stage5-runs/source-card-integration-fixture.json`: original source records, association counts and explicitly local report fixture.
- `stage5-runs/source-card-preservation.json`: successful preservation result.

### Verification and sign-off recommendation

Focused source, card, report-source, leakage and evidence checks passed **64/64 across five files in 51.10 seconds**. The added unit cases cover exact three-part ownership, duplicate IDs versus distinct same-page claims, and rejection of unsupported/unchecked/duplicate/unavailable/late sources from the supporting filter. TypeScript passed; ESLint passed with **0 errors and the existing 37 unused-code warnings in `MetaAdsManager.tsx`**; `git diff --check` passed. No mobile/tablet or full Vitest run was performed for this change. **307/307 remains the previous complete regression baseline; the current full regression is still incomplete/pending.** No tests were removed, weakened or permanently skipped.

Before/after hashes across every collection for `demo_nike` and the saved `stage5_1792885194280` advertising scope matched. The `nike_demo` business record/active selection and both original source records also matched. Active selection remains **`demo_nike`**. This harness performs no database writes.

**Accept the external-card integration and recommend qualified Stage 5 demonstration sign-off under the user's isolated-test fallback.** This supersedes the earlier card-integration blocker, not the historical live-run facts. Spontaneous external research delegation and verified source incorporation into a genuinely source-relevant, persisted live AI report remain **unverified**. Refresh here proves the file-backed integration report view; the earlier desktop live-report check proves Mongo report persistence separately. `contextRelevance: not_assessed` remains visible and unchanged. Production worker deployment, authentication and cost accounting remain outside this acceptance; Stage 6 has not begun. A sign-off that specifically requires spontaneous live external delegation should remain open until such a relevant investigation occurs naturally.
