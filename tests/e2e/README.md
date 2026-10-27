# Browser regression tests

Run `npm run test:e2e` from the application directory. The suite starts Next.js on
port 3101 with a separate `.next/e2e` cache, and exercises desktop Chromium and a
Pixel 7 viewport. The usual development server can remain running.

The default database is `normal_e2e`; use `E2E_MONGODB_DB=normal_e2e_my_run` to
choose another isolated database. Fixture setup refuses other database names. A
working `MONGODB_URI` is required. An explicit `E2E_BASE_URL` must point to a server
using the same isolated database.

Setup regenerates deterministic simulator observations, checks evidence against
those records, and replays the committed investigation and strategy artifacts.
Approval, execution, receipts and outcome measurements use the actual services.
Each approval test starts from a fresh proposal, so reruns do not reuse decisions
or depend on an expired historical approval. No new model requests run by default.
Set `E2E_LIVE_MODELS=1` and the `STAGE5_LIVE_RUN`/`STAGE5_LIVE_INV` variables only
when intentionally testing a prepared live-provider run.

Form interactions use the installed `react-form-fill` skill and require both its
dry-run and committed-state reports to pass. The default script is
`~/.codex/skills/react-form-fill/scripts/form-fill.mjs`; set
`REACT_FORM_FILL_SCRIPT` to use another installation of the same script.

Screenshots, traces and refreshed acceptance evidence go to the temporary
`normal-e2e-artifacts` directory, or `E2E_ARTIFACT_DIR` when set. They do not replace
the committed demonstration records. The source-card test also verifies the
original source rows and the selected demo run remain unchanged.
