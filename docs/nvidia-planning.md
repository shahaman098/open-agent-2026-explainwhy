# NVIDIA diagnosis and planning flow

The disabled planning button was reporting a genuine missing prerequisite: the NVIDIA investigation had no saved Stage 5 diagnosis. An automatic dashboard summary is a separate artifact and cannot authorize planning.

The planning view now reads the investigation prerequisite status. When a report is missing, its primary button offers **Run diagnosis and generate plan**. It starts the scoped investigation, shows progress, then queues strategy comparison after the existing planning eligibility checks pass. If the model remains uncertain or fails, the page provides **Review diagnosis** and its limitations. It does not mark the report accepted merely to enable the button. Closing the view leaves the saved diagnosis available; reopen it to generate strategies if automatic continuation did not run.

Local Nemotron uses compact evidence-decision schemas for investigation and diagnosis. It selects competing causes, support strength, actual evidence references and read-only tools. The application renders narrative fields from those decisions, retains known contradictions, and caps local assessments at moderate strength. The original canonical diagnosis, evidence, cutoff, contradiction and handoff validators still run. Raw local decisions and rendering versions are retained alongside the normal model call receipts. Cloud-mode schemas remain unchanged.

For local planning, the server builds alternatives from actual supported capabilities and validates them before presenting them to Nemotron for ranking. Action references are restricted to the accepted primary diagnosis's supporting evidence. Options without a justified target or required efficiency comparison are excluded; this can correctly leave observation and investigation choices. The existing planner validates the expanded result again against fresh state. Human selection and exact-version approval remain separate from generation.

The recorded NVIDIA case completed on local `explainwhy-nemotron`, selected a qualified `ad_inefficiency` diagnosis, and produced two validated strategies awaiting selection. The model recommended continued observation. No strategy was selected, submitted, approved or executed by this repair.

Start the local app and all three workers with `npm run dev:analysis`, after Postgres and Ollama are running. Existing separate commands remain `npm run investigator:work`, `npm run planner:work` and `npm run analysis:watch`.

Regression coverage: `tests/local-planning-flow.test.ts`, the planner validation/persistence suites, and the investigator validation/persistence suites. Live proof is retained in `.local/nvidia/planning-button-check.json` and the application’s scoped call/report records.
