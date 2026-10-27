# Normal — Nike Simulator Handoff

This bundle contains the **actual** shared Normal v1 Zod/TypeScript schemas, invariants, examples, original architecture and REST contract, plus a new annotated Nike simulator integration guide.

**Give the implementing coding model the entire `normal_full_contracts_v1` folder**, alongside the one master prompt. Ask it to install the schema package as the **single** source of truth rather than retyping types in the prompt.

Read in this order:
1. `docs/NIKE_SIMULATOR_IMPLEMENTATION_GUIDE.md` — Nike-specific reference-to-simulation boundaries, detailed field semantics, exact event type mapping, tests.
2. `src/contracts.ts` — authoritative v1 executable Zod schemas.
3. `src/invariants.ts` — additional cross-record invariant checks.
4. `docs/architecture.mmd`, `docs/api.md`, `docs/build-flow.md`, `docs/mongodb.md` — existing Normal architecture and handoff.
5. `examples/*.json` — sample validated payloads.

**Compatibility:** schemas target Zod v3.25.x. Integrating model must run package TypeScript checks and example validation *in the actual project*. The bundle's original README documents that generation-time full runtime testing was unavailable. It is not proof that these checks passed already.

**Do not commit `.env.local` or expose MongoDB credentials.** The code model must preserve your existing Next.js and MongoDB setup.
