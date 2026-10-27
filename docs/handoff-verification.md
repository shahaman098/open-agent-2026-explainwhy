# Mac handoff verification — 27 October 2026

The handoff branch is `codex/sponsor-integrations`. Follow
[the Mac runbook](friend-mac-runbook.md) for installation and live acceptance.

## Environment and scope

Checks use a clean export of the handoff source, a fresh `npm ci`, Node.js
24.22.1 on Apple Silicon macOS, and an isolated local PostgreSQL 17.9 database.
No developer database, environment file or sponsor credentials are included.

## Recorded checks

- Fresh dependency installation completed.
- Contract type checks and all 15 contract examples passed.
- Application TypeScript checks passed.
- ESLint completed with zero errors and 20 warnings.
- Production build passed, including the current UI and database changes.
- Targeted Postgres suites passed: explicit-ID upserts, unique constraints,
  report/memory transactions, rollback, report recall and monitoring replay after
  deletion/restart.
- A new 108-hour synthetic advertising run reached `phase: prepared` using
  Postgres, without a model request.
- Zetaris CSV export produced 540 observations and five campaigns and exited
  cleanly. This verifies export, not a live Zetaris query.
- H-MEM backfill exited cleanly with zero reports in that unprocessed run and
  zero model requests. Actual saved-report recall is covered by persistence tests
  using labelled model fixtures.
- The production homepage returned HTTP 200. Its APIs read 17 persisted run
  products, 115 orders and 359 customers, and completed deterministic evidence
  collection against Postgres. The empty database correctly used bundled public
  catalogue references until reference records were seeded.
- Fixture-only execution, outcome and provider checks passed without a real
  inference credential, including when the parent environment selected local
  Nemotron. Tests isolate provider settings from the developer's real keys.

`npm run verify` completed successfully: **73 test files and 446 tests passed**,
including the long simulator evaluation and diagnostic suites. The focused
provider/execution/outcome rerun with local-model settings in the parent
environment passed **46 tests across five files**. These counts overlap and
should not be added together. No live provider request was needed for them.

## Acceptance still required on the receiving Mac

NVIDIA local-model inference, Bright Data authenticated search and Zetaris live
queries were not run here: their runtime/credentials/image entitlement were not
available. The real financial-chart render receipt from prior verification is
separate from this database check. Run every live acceptance step in the Mac
runbook, including saved-report H-MEM recall and a new chart render, before
claiming that all four integrations work together on the receiving computer.

The dependency audit reports nine inherited high-severity advisories in the
current dependency tree. Its proposed fixes include major-version dependency
changes; those upgrades are outside this database handoff and have not been
applied. This handoff verifies local installation and application behavior; it
does not clear those advisories or establish public-deployment readiness.
