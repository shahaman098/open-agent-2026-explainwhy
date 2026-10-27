# @normal/contracts

Normal v1 shared contracts: executable Zod 3.25.x schemas (`src/contracts.ts`) and
cross-record invariants (`src/invariants.ts`). This package is the **only**
authoritative implementation of every canonical schema in the repository. Import
it from the Next.js app as `@normal/contracts` (tsconfig path alias + npm workspace).

- `npm run typecheck -w @normal/contracts` — type-checks the schemas and scripts.
- `npm run validate -w @normal/contracts` — validates every `examples/*.json` fixture.

Do not fork, retype or "lightly adapt" these schemas elsewhere. If a contract change
is unavoidable, document the issue and the exact proposed change in
`docs/implementation-report.md` before touching this package.
