# How we evaluate ExplainWhy

We test different parts of the system separately. Finding an unusual pattern, producing a valid diagnosis, executing an approved action, and improving a business outcome are different claims.

## What the checks cover

| Area | What we check | Where to look |
| --- | --- | --- |
| Detection | Healthy runs, injected incidents, held-out seeds, detection delay, and off-target alerts. | [Detector evaluation](detection-evaluation.json), [evaluation tests](../../tests/intelligence/evaluation.test.ts) |
| Evidence | Source resolution, arithmetic, date cutoffs, business/run isolation, and exclusion of hidden simulator data. | [Evidence tests](../../tests/intelligence/evidence.test.ts), [data-boundary guard](../../tests/intelligence/leakage.test.ts) |
| Diagnosis | Structured decisions, valid citations, competing hypotheses, contradiction retention, bounded repairs, and honest provider failures. | [Local decision tests](../../tests/local-planning-flow.test.ts), [investigator tests](../../tests/investigator/) |
| Planning | Supported capabilities, justified targets, current state, and refusal of unsupported or stale proposals. | [Planner tests](../../tests/planner/), [local NVIDIA example](../nvidia-planning.md) |
| Human control | Exact-version approval, changed-target rejection, duplicate handling, execution receipts, and read-back verification. | [Execution tests](../../tests/execution/), [recorded approval/execution audit](../stage7-runs/audit.json) |
| Automatic analysis | Database updates without timestamps, tenant separation, stale responses, unchanged-input reuse, and exclusion of private fields from the model packet. | [Dashboard analysis tests](../../tests/dashboard-analysis.test.ts) |
| Animation | Snapshot values, missing observations, units, and deterministic rendering. | [Presentation tests](../../tests/presentation.test.ts), [export behavior](../dashboard-presentations.md) |

## Live calls and fixtures

Most regression tests inject labelled model responses. They exercise validation and persistence without consuming model credits, but they do not measure model reasoning quality.

The [NVIDIA snapshot](../demo/nvidia-local-proof.json) records a real local Nemotron investigation and planning comparison. It reached a qualified advertising-inefficiency diagnosis and offered two advisory strategies. It is one synthetic case, not an accuracy benchmark.

The [false-lead scenario](../proof-moments/README.md) tests a harder question: can the investigator distinguish a checkout fault from a simultaneous advertising problem? Its deterministic evidence and scenario tests are recorded separately. They do not establish that the current local model correctly diagnosed that case.

Earlier provider experiments and their individual results remain in the [evidence index](../evidence.md). Their model names, dates, and scope belong to those runs.

## Run the checks

```sh
npm run contracts:typecheck
npm run contracts:validate
npm run typecheck
npm run lint
npm test
```

Database suites need Postgres. Use a dedicated `DATABASE_SCHEMA`; optional live sponsor services should be disabled for fixture-driven runs. `npm run verify` combines the contract, TypeScript, lint, and test commands. Browser flows use `npm run test:e2e` with the setup described in their [configuration](../../playwright.config.ts).

Useful focused checks:

```sh
npx vitest run tests/local-planning-flow.test.ts tests/dashboard-analysis.test.ts tests/intelligence/leakage.test.ts
```

## What these results cannot tell us yet

Passing schemas and resolved references establish consistency and provenance. They do not prove a causal explanation. A successful action receipt proves a recorded change; a later revenue increase alone would not prove that the action helped.

General diagnosis accuracy, commercial impact, and improvements from model training remain unestablished. The prototype deliberately retains uncertainty, insufficient-evidence outcomes, and failed requests so those limits remain inspectable.

[Back to the project](../../README.md)
