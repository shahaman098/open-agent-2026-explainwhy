# Automatic local Nemotron analysis

The overview now has an **ExplainWhy analysis** card. The same current-run analysis is available in an investigation's Signal details. It updates automatically when operational source records change. Existing charts continue their normal refresh.

## Start

With local Postgres and Ollama already running, use `npm run dev:analysis` to start Next.js at `http://localhost:8772` and the dashboard analysis, investigation and planning workers together. Alternatively, keep the existing app running and start `npm run analysis:watch -- --business=nvidia_demo` separately. The business option registers that business's active run; opening an overview or investigation also registers its selected run. Each registration stays scoped to one business and simulation run.

Use the existing server settings `NVIDIA_INFERENCE_MODE=local`, `NVIDIA_BASE_URL=http://127.0.0.1:11434/v1`, and `NVIDIA_LOCAL_MODEL=explainwhy-nemotron`. This alias runs the installed Nemotron Nano model. The worker refuses cloud mode and non-Nemotron model settings. Credentials are never sent to a cloud model by this feature.

## Update behavior

The worker checks source revisions every three seconds, waits for three seconds of quiet, then assembles a new operational snapshot. The browser polls saved analysis status every five seconds. Model inference time is additional. The worker continues with the browser closed; it must remain running for automatic updates.

Watched sources are canonical business events, orders, campaigns, shipments, products, the run clock, incidents and investigations. PostgreSQL tuple-version fingerprints detect inserts, edits without an `updatedAt` field, and deletes. Changes to a different business or run do not invalidate the selected analysis. Internal analysis tables are excluded, preventing feedback loops.

The analysis compares the latest observed window, up to a day, with the preceding equal-length window when a full baseline exists. Metric arithmetic comes from canonical events. Current campaign budgets, inventory and shipment records provide additional context. Public NVIDIA quarterly USD results are excluded from the synthetic GBP operational interpretation. The operational run clock defines the observation boundary; future-dated records outside that boundary are not silently treated as completed observations.

Nemotron receives observable summaries and chooses the focus, cited metrics and next checks. Source IDs are constrained by the JSON schema. Code renders the exact metric values and comparison/check wording. A short qualitative model note is used only if it contains no numeric assertions or causal-certainty wording; the receipt records whether it was accepted. No model result is labelled as an accepted causal diagnosis. Scenario names, planted causes, private simulator parameters and customer identities are excluded from the prompt.

Reports are keyed by the actual input, model and analysis version. Repeated polling of unchanged data does not make another model call. An edited database row that leaves all analysis inputs unchanged reuses the matching report. Bursts coalesce; queued older inputs are superseded. A response completed for an older snapshot is retained in history and cannot overwrite the current analysis. While a replacement runs, the UI marks the previous result as stale.

A leased worker and job claims prevent concurrent copies from duplicating inference. Provider failures keep the previous result and have one delayed automatic retry; invalid structured decisions have one repair attempt and otherwise remain failed. The UI offers an explicit retry. Request IDs, model, token counts, latency, input fingerprint and source snapshot are persisted in `dashboard_analysis_reports` and exposed through **Data snapshot and model receipt**.

## API and persistence

`GET /api/dev/dashboard-analysis?businessId=…&simulationRunId=…` reads saved state. Same-origin `POST` with `{"action":"watch"}` registers a run, and `{"action":"retry"}` retries a failed target. Both methods use the existing dev/demo access guard. No request to this API directly invokes inference; the background worker owns it.

State lives in `dashboard_analysis_watches`, `dashboard_analysis_reports`, and `dashboard_analysis_workers`. Restarting the worker preserves reports and registrations. Stop the worker with Ctrl+C. Existing investigation diagnosis, planning, approval and execution gates are independent; this feature does not execute business actions or unlock an unsupported plan.

## Verification

`npx vitest run tests/dashboard-analysis.test.ts tests/investigator/provider-nvidia.test.ts` covers model boundaries, exact source snapshots, changes without timestamps, invalid references, stale responses, unchanged-input deduplication, tenant isolation and competing workers. Database cases use a temporary isolated Postgres schema and injected model responses, with no cloud calls. Live local-inference receipts are separately retained in the running demo database.

A live local check on 27 October also created a separate `nvidia_auto_update_verify_20261027` run, waited for a Nemotron report, advanced the database by one observed hour, and received a second report automatically. The input fingerprint and source window changed, both model requests stayed on loopback, the active main demo selection was preserved, and unchanged data did not produce another report. The receipt is `.local/nvidia/automatic-update-proof.json`.
