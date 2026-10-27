# Gemini 4 Argon source-support training and evaluation

The live Gemini 4 Argon (`gemini-4-argon`) teacher/baseline runs completed. **Adapter improvement is still unmeasured: Mubit has not started either task's first training.** No source-support adapter version or adapter response exists in these runs.

| Run | Teacher calls, full recording | Held-out baseline, metadata only | Valid outputs | Macro F1 | Median gateway latency |
| --- | --- | --- | --- | --- | --- |
| Native Gemini, current app route | 40/40 | 18/24 rubric matches (75%) | 24/24 | 0.7062 | 3,254 ms |
| Gemini OpenAI-compatible diagnostic | 40/40 | 18/24 rubric matches (75%) | 24/24 | 0.7062 | 3,546 ms |

These are 40 unique training inputs sent once through each transport, plus the same 24 held-out inputs evaluated separately on each transport: 128 task calls in total. Two additional synthetic capture probes and five compatible-route connectivity/schema probes were run during diagnosis; the connectivity script also checked an invalid-model error. Monetary rates were not available, so costs remain null. The sequential transport measurements do not establish a controlled latency advantage.

The native experiment is [source-support-gemini-4-argon-v1](source-support-gemini-4-argon-v1/manifest.json). The compatible experiment is [source-support-gemini-4-argon-compat-v1](source-support-gemini-4-argon-compat-v1/manifest.json). Each contains its own actual calls, request IDs, output text, frozen inputs and report. The earlier model experiment remains separate and was not replayed or relabelled.

## Hosted training state

The native task is [Assess whether each supplied 2](https://app.mubit.ai/console/projects/ws-31028979027c7c75/workloads/ln_a328d88258f6df01151561dc). Its saved console observation shows 40 calls usable for training, 0 kept, 0 rejected, 40 waiting, 40 queued, 3 running, no review-cap overflow, and first training not started. See its [status](source-support-gemini-4-argon-v1/console-status.json) and [screenshot](source-support-gemini-4-argon-v1/console/submission-queue.png).

The compatible task is [Assess whether each supplied 3](https://app.mubit.ai/console/projects/ws-31028979027c7c75/workloads/ln_270abbb4ba2db3dc8779bae5). Its final saved observation at 08:25 UTC shows 40 calls usable for training, 0 kept, 0 rejected, 40 waiting, 40 queued and 3 running, with first training not started. Earlier snapshots had lagging summary counters; the final counters have caught up. See its [status](source-support-gemini-4-argon-compat-v1/console-status.json) and [screenshot](source-support-gemini-4-argon-compat-v1/console/submission-queue.png).

Both tasks were discovered after a delay. The native request page displayed no messages, reply or token usage, although its calls later became a task marked usable for training. That empty display did not prove lost capture. The compatible route displayed complete content and usage and was tested to distinguish a display/normalization issue from inference failure. It also became a separate task. Both reach the same hosted review dependency; changing transports did not complete review. No supported restart/force-review control was exposed, no queue settings were weakened, and no support email was sent.

The public queue screenshots were clipped at capture time to exclude the account sidebar; the task counts and status are unchanged. Full screenshots remain local.

The app stays on native Gemini 4 Argon. Compatible transport remains an explicitly selectable, validated alternative. Both long-running workers were gracefully restarted on the native transport after the diagnostic. The provider preserves gateway IDs and recording headers on both routes, rejects invalid/refused/truncated outputs, validates the original local schema, and performs no automatic inference replay. TypeScript, focused ESLint and 58 provider/investigator/planner/training tests passed; compatible-route live acknowledgement, forced-function and all three production schema probes passed.

## What the result means

The 75% score is agreement with agent-assisted synthetic labels, not independently validated production accuracy. Both routes made the same six label mismatches: five of six authored `context_only` cases, plus one `supported` case. The context-only/insufficient boundary needs independent adjudication. The test contains six held-out scenes with related claim variants, rather than 24 independent real incidents. Teacher outputs matched 30/40 native and 31/40 compatible training labels; Mubit distils those outputs, including their mistakes. Local labels were never uploaded as corrections.

The dataset, labels and comparison rule were frozen before either run's baseline or adapter outputs. They were reused from the earlier pilot, so this is not an independently designed benchmark. Held-out calls used `x-middleware-record: metadata`; only training calls used `full`. No held-out label file was sent to Mubit.

When a version for one of these exact tasks passes and is available in Try models, pin it and submit only that experiment's `heldout-inputs.json` messages with storage/training disabled. Keep the two task/version identities separate and reuse each route's matching saved baseline. Improvement requires positive paired rubric accuracy delta with a positive lower whole-scene bootstrap bound, valid output on every case, and no increase in false-supported errors. Do not tune labels, substitute a different task's adapter, claim cost savings from missing prices, or promote an adapter automatically.

The integration supports `--experiment=versioned-name`; transport drift is rejected during collection, and Gemini adapter-result imports must declare the matching `transport`. Example report commands:

```sh
npm run training:source -- report --experiment=source-support-gemini-4-argon-v1
npm run training:source -- report --experiment=source-support-gemini-4-argon-compat-v1
```

Actual adapter comparison, once available:

```sh
npm run training:source -- compare /absolute/path/to/adapter-results.json --experiment=source-support-gemini-4-argon-v1
```

The import must include `transport: "native"` for the first experiment or `transport: "openai"` for the second, alongside actual model/task/adapter IDs, input hashes, replies and console evidence. Successful teacher calls and a passing Mubit agreement test alone do not establish adapter improvement. Mubit documents the [native and compatible Gemini routes](https://docs.mubit.ai/guides/connect-gemini) and the [kept-example training dependency](https://docs.mubit.ai/guides/first-adapter).
