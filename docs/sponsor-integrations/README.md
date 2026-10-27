# Zetaris and Meterless integration

This checkout connects sponsor capabilities to the investigation workflow. **A complete live sponsor demonstration is not yet verified.** Meterless engine conformance and offline application checks pass. Zetaris's local software is prepared, but its container images require Docker Hub access. No successful Zetaris query, combined live investigation, or organizer acceptance is claimed by these checks.

## What runs in the product

### Meterless H-MEM

The actual [Meterless H-MEM reference engine](https://github.com/Meterless/Meterless/tree/1742dec56a66e58eef9dda2d2b865823758ca8cd/engines/hmem/reference) is vendored under `src/vendor/meterless-hmem`. The Apache 2.0 license and per-file upstream hashes are included. Only `.ts` import suffixes were removed to match the host TypeScript configuration; engine behavior is unchanged.

When a validated investigation report is published successfully, the same MongoDB transaction saves an immutable per-report memory snapshot in `meterless_memories`. It carries the business, run, investigation, source report, virtual observation cutoff and original report availability time. Model-provider failure reports are not captured. Existing successful reports can be backfilled without a new model request:

```sh
npm run meterless:backfill -- --business nike_demo --run YOUR_RUN
```

The existing `historical_incidents` tool loads eligible snapshots and calls H-MEM's real capture, hybrid ranking and reinjection functions. It restricts recall to the same tenant and simulation run, excludes the current investigation, and applies two independent time boundaries: virtual observations cannot exceed the incident cutoff, and report availability cannot exceed the current job's wall-clock creation time. Reused historical evidence generated after that knowledge boundary is not reinjected.

H-MEM recall, source lineage, ranking scores and create/read ledger entries are persisted in the evidence detail. Expand a historical evidence item to inspect `hmem`. The investigator receives this in a separate `historicalMemory` context field. Prior reports are excluded from the current causal evidence ID set, so they can suggest checks but cannot independently justify the current diagnosis.

The reference engine uses deterministic hash embeddings. Confidence is an explicit capture default, not a measured probability. MongoDB stores the durable source snapshots; the reference engine is rehydrated per bounded retrieval. There is no shared in-memory tenant cache or concurrent JSON-file store. This integration does not claim Nightshift inference, learned embeddings, production-grade semantic retrieval, automatic memory promotion or model improvement.

### Zetaris

The new `zetaris_campaign_analysis` tool issues a server-built, read-only SQL join between two registered relations: hourly advertising observations and the campaign catalogue. It is available to deterministic evidence collection and the model's tool selection when `EXPLAINWHY_ZETARIS_ENABLED=true`. Disabled installations do not advertise it to the model.

All scopes, window boundaries, identifiers and relation names are validated. The model cannot submit SQL or choose a database endpoint. The client uses the documented SQL start/page/close endpoints, Bearer authentication, organization and request headers, a shared deadline and streaming response limits. Every accepted observation must match its immutable canonical event. Missing, duplicate, changed, cross-scope or stale rows fail the tool. A partial export cannot silently masquerade as an observed sales decline.

Successful evidence includes the query text, relation names, request ID, pagination count, cursor-close result, canonical event references and verified metrics. No credential or cursor token enters the evidence record. Equivalent MongoDB and Zetaris observations refer to the same events and must not be counted as independent corroboration. The data remains explicitly synthetic.

## Chosen setup: local Docker

Zetaris Cloud's Hobby software tier is free, but its instances run in your AWS account and incur AWS compute charges. Following the user's zero-cost preference, this setup uses local Docker. [Current Cloud pricing](https://www.zetaris.com/cloud) · [Free self-managed Air](https://www.zetaris.com/zetaris-air).

The official [Freemium setup](https://github.com/zetaris/Freemium) is prepared at `.local/zetaris-freemium`, pinned to `9dd4fe943afebca6b204b6ed5eccdca91b831e6c`. The generated override binds published ports to loopback and publishes no PostgreSQL port. Only the four data-platform services are started; optional AI/GPU services are not needed.

```sh
npm run zetaris:prepare
# Once your Docker Hub account has access to the Zetaris images:
docker login
npm run zetaris:start
```

**External prerequisite:** the official `zetaris/lightning-server:v2.4.1.0-latest` image returned `denied` / `unauthorized` during setup. Obtain image entitlement through the hackathon's Zetaris resources or [request free Air access](https://www.zetaris.com/zetaris-air). The [official Docker guide](https://kbase.zetaris.com/knowledge/docker-installation-on-docker-desktop) says container access must be activated and may take up to 24 hours. This repository cannot grant that access. Do not mistake preparation of Compose files for a running Zetaris installation.

After startup, follow the pinned Freemium README's development-user creation procedure. The local UI is `http://localhost:9001`; API is `http://127.0.0.1:8888`. The provided development credentials are for the isolated local stack only. Obtain the organization ID and an API token from your running instance; never put secrets in a `NEXT_PUBLIC_` variable or commit them.

## Register the demonstration's two data sources

The application still requires the existing `MONGODB_URI`, `MONGODB_DB` and `MUBIT_API_KEY` settings. This checkout currently has no `.env.local`. Configure those server-side values to run a fresh investigation or export existing data. The offline engine checks need none of them.

1. Choose a populated synthetic run and a bounded advertising window. Export it from the canonical store:

   ```sh
   npm run zetaris:export -- --business nike_demo --run YOUR_RUN --from 2026-10-23T00:00:00.000Z --to 2026-10-24T00:00:00.000Z
   ```

2. Copy `.local/zetaris-data/ads.csv` and `campaigns.csv` into `.local/zetaris-freemium/customer_data/shared/explainwhy/`. In the containers that directory is `/home/zetaris/data/shared/explainwhy/`.
3. In Zetaris, register the two CSVs separately using its data-source/catalogue UI. Retain their header names. Advertising columns are `event_id`, `business_id`, `simulation_run_id`, `campaign_id`, `window_start`, `window_end`, `impressions`, `clicks`, `spend_minor`, `attributed_orders`, `attributed_revenue_minor`. Catalogue columns are `business_id`, `simulation_run_id`, `campaign_id`, `campaign_name`, `platform`.
4. **Register IDs and the UTC ISO `window_start`/`window_end` columns as strings**, preserving values such as `2026-10-23T00:00:00.000Z`. Register the five numeric measures as nonnegative integers. The client expects named JSON objects with the exact exported column names, not positional arrays. If your Zetaris version returns another shape or timestamp representation, adjust the source view explicitly before using it.
5. Keep each catalogue key `(business_id, simulation_run_id, campaign_id)` unique. Test a join in Zetaris. Set the fully qualified registered relation names in `.env.local`:

   ```dotenv
   EXPLAINWHY_ZETARIS_ENABLED="true"
   ZETARIS_BASE_URL="http://127.0.0.1:8888"
   ZETARIS_API_KEY="YOUR_PRIVATE_TOKEN"
   ZETARIS_ORG_ID="YOUR_NUMERIC_ORG_ID"
   ZETARIS_ADS_RELATION="YOUR_SOURCE.ads"
   ZETARIS_CAMPAIGNS_RELATION="YOUR_SOURCE.campaigns"
   ```

The export excludes customers, contact details, session records, hidden simulator controls, and non-synthetic data. It is a fixed snapshot; refresh/register it again as the run advances. A CSV join proves integration with registered data, not continuous federation of real advertising accounts or live MongoDB tables.

## Verify and record the demonstration

```sh
# Actual H-MEM engine, labelled fixture, no provider calls or DB writes:
npm run sponsors:check

# Actual Zetaris network query after activation and source registration:
npm run sponsors:check -- --live --business nike_demo --run YOUR_RUN --from 2026-10-23T00:00:00.000Z --to 2026-10-24T00:00:00.000Z

# Focused application checks:
npm test -- tests/integrations tests/investigator/provider.test.ts tests/investigator/validation.test.ts tests/planner/validation.test.ts
```

`docs/sponsor-integrations/latest-check.json` distinguishes a fixture engine result, actual query connectivity, and canonical evidence verification. A nonempty live schema check still does not prove that each metric matches its canonical event; that verification happens in the investigation evidence tool.

Restart the app and workers after configuration changes. Open a fresh advertising investigation, collect or refresh evidence, and expand `zetaris_campaign_analysis` in the tool trace. Then run a later same-run investigation and inspect `historical_incidents` for recalled memory and its source report. Keep the Zetaris request receipt, H-MEM trace and source records in the updated demo and deck. Failures remain visible; there is no fallback that labels a MongoDB-only result as Zetaris.

`GET /api/integrations/status` exposes guarded configuration/capability status only. It does not claim service health or live acceptance.

## Checked during implementation

- Actual vendored H-MEM: **13/13 upstream conformance checks passed**.
- Offline sponsor check: one sourced fixture memory recalled; create/read ledger recorded.
- Application tests cover SQL construction, injection rejection, pagination/cleanup, streamed size limits, canonical reconciliation, incomplete exports, tenant/run isolation, separate simulation/availability clocks, and history-to-prompt boundaries.
- Generated official Compose stack validates.
- **89 focused application tests passed:** 65 offline checks and 24 database-backed checks against a new, isolated local MongoDB 8 replica set. The latter exercise the actual investigation publication transaction, per-report memory capture/idempotent replay, cancellation/provider-failure boundaries and the evidence workflow. Model responses in those tests are fixtures; no paid provider calls were made. The temporary database container was removed after testing.
- Production build and TypeScript check passed. ESLint returned zero errors and 14 pre-existing warnings in the partner demo components. An independent reviewer found no remaining blocking code issue.
- No live Zetaris query, fresh real-model investigation, full regression, organizer acceptance or updated submission video was established. These remain follow-up acceptance work after the missing instance/credentials are available.

Official references: [Meterless H-MEM specification](https://github.com/Meterless/Meterless/blob/1742dec56a66e58eef9dda2d2b865823758ca8cd/engines/hmem/AGENTS.md), [Zetaris authentication](https://kbase.zetaris.com/knowledge/accessing-zetaris-using-api), [SQL API specification](https://api.saas.enterprise.zetaris.com/redoc/index.html), [SQL query guide](https://kbase.zetaris.com/knowledge/rest-api).
