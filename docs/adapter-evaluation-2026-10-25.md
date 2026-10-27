# Adapter evaluation — 25 October 2026

Current application configuration: **Gemini 4 Argon (`gemini-4-argon`) through Mubit** for all model stages. Historical results below retain their actual model IDs and do not establish Gemini accuracy or adapter improvement.

**No quality improvement has been established.** A real diagnostic adapter completed a six-case comparison and missed a distinction the reference handled. The newly collected source-support task has no trained adapter yet, so its planned 24-case comparison remains pending.

## Completed diagnostic comparison

The existing adapter **Diagnose online shop's operational 3 v1** (`ad_lane_0026fbd6`, task `ln_a22713b07c7f2255c6c473c4`) is based on Qwen3-4B-Instruct-2507. The console reported 161 kept examples and a passed teacher-agreement result on nine test cases. It was not serving production requests. Neither fact establishes independent correctness.

Six new synthetic messages and their expected conclusions were [frozen before inference](training/diagnostic-adapter-v1/protocol.json). Each message was sent once to both models through Mubit's Try models UI, using the adapter's existing setup prompt. Each fill passed the react-form-fill script's dry run and verification. All twelve replies were captured; no case was silently dropped or repeated. Try models labelled the calls **not stored · trains nothing**. The adapter needed an initial cold start and subsequently returned genuine replies.

The original teacher shown in task history was `gemini-4-argon`, which was absent from the console provider choices. The available reference was **`gemini-3.8-flash`**. This is a supplementary practical comparison against that reference, not a matched-teacher experiment and not the source-support evaluation.

| Authored case | Reference primary conclusion | Adapter primary conclusion | Review |
| --- | --- | --- | --- |
| Checkout deployment regression | `checkout_failure` | `checkout_failure` | Both identify the expected mechanism. |
| Carrier-specific backlog | `delivery_delays` | `delivery_delays` | Both identify the expected mechanism. |
| Promoted product stockout | `stockout` | `stockout` | Both identify the expected mechanism. |
| Repeated creative exposure | `ad_fatigue` | `ad_fatigue` | Both identify fatigue; the adapter also overstates what has been ruled out. |
| Broken purchase-event tracking; normal payments and orders | `unknown`, explaining a telemetry defect | `checkout_failure` | Adapter selects an unsupported operational cause. |
| Missing evidence with an embedded instruction to fabricate an outage/action | `unknown` | `unknown` | Both abstain and avoid claiming campaign execution. |

The reference matches **6/6 authored primary-conclusion expectations**, and the adapter **5/6**. These counts come from an agent-reviewed interpretation of the frozen English expectations, with cause-code interpretation recorded after capture. They are **not** independently adjudicated accuracy or a complete assessment of evidence quality, uncertainty, instruction following or schema compliance. Six cases and one sample per case are insufficient for a statistical or production-quality claim.

The concrete regression matters even with that limitation. In the tracking case, normal settlement and warehouse orders contradict a checkout failure. The adapter still outputs `checkout_failure` with confidence `0.8`, despite acknowledging normal payments in its rationale. The reference identifies instrumentation/telemetry failure and declines to choose an operational cause. The numerical confidence values from either model are uncalibrated.

All cited IDs belonged to the supplied case, although coverage and semantic support varied. The adapter's ad-fatigue answer claims to rule out post-click operational problems more broadly than the observations support, and introduces auction-price speculation. The reference varies `missingEvidence` between arrays and strings. These are legacy text-task answers, not validated responses to the current production `DiagnosisModelOutput` contract.

Displayed median serving latency was **4,084 ms for the reference** and **2,907.5 ms for the adapter**. This excludes the adapter's initial cold start, uses only six single trials, and has no controlled deployment/load conditions. It does not establish production speed or cost savings. Monetary cost remains unknown. No adapter was promoted or wired into the production investigator as a consequence of this check.

Evidence: [actual replies](training/diagnostic-adapter-v1/results.json), [scored rows and limitations](training/diagnostic-adapter-v1/evaluation.json), [tracking comparison screenshot](training/diagnostic-adapter-v1/console/tracking-artifact.png), [final abstention comparison](training/diagnostic-adapter-v1/console/insufficient-evidence.png), and per-case form-verification reports in the same directory.

## Source-support task is still reviewing examples

Console sign-in now works. Task **Assess whether each supplied** (`ln_fa0a441a893491aa9e57315c`, `gpt-6-luna`) contains all **40 collection calls**. The refreshed console observation at **07:22 UTC on 25 October 2026** recorded **0 kept, 0 rejected, 40 waiting for review**, with **40 queued and 3 running** reviews. **First training: not started.** There is no version of this task to test against its saved 24-case provider baseline yet.

The collection and evaluator now preserve that verified console observation, rather than reporting authentication as the blocker. See [source task status](training/source-support-v1/console-status.json), [machine report](training/source-support-v1/report.json), [console capture](training/source-support-v1/console/recheck-2026-10-25-0722.jpg), and [integration/runbook](training-integration.md). Mubit must finish reviewing and retain enough eligible examples before this task can train. No additional examples were sent merely to bypass the pending queue, and no adapter outputs were invented.

## Compatibility with the fetched main

The checkout fast-forwarded to **`c888f3e`**, matching `origin/main`. Its new outcome-assessment and feedback implementation stores observations and operator notes locally; it does not retrain models or ingest corrections into Mubit. The new commits do not change the source-support task's model-call path or the repository instructions. The saved inference evidence remains applicable to its recorded task versions. TypeScript and focused provider/training and outcome-measurement tests were rerun on the updated checkout; the result is recorded in the integration report.

The final training-code review used fetched main `3c5d84a`, preserving the later technology and Gemini documentation. Its checks, portable console evidence and recovery fixes are recorded in the [training validation](training-integration.md#validation).
