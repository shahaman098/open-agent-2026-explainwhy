# ExplainWhy + Animation Studio on a Mac

ExplainWhy investigates business observations. Animation Studio renders an animated
comparison of a verified measurement and its baseline. Both apps run on the same
Mac. The current animation is a deterministic five-second chart, not a model-created
financial forecast or a general-purpose animated story.

For a fresh installation, follow the complete [Mac handoff runbook](friend-mac-runbook.md),
including Postgres setup, source registration and the live acceptance checklist.

| Integration | Role | Runtime |
| --- | --- | --- |
| NVIDIA Nemotron | Investigation, diagnosis, planning and optional source assessment | Local Ollama/LM Studio endpoint, or NVIDIA's hosted API |
| Bright Data | One bounded public-topic SERP query per research delegation | Bright Data cloud API, called from the Mac |
| Zetaris | Read-only join of registered advertising observations and campaign catalogue | Local authorized Zetaris installation or configured HTTPS instance |
| Meterless H-MEM | Recall prior published investigation reports with provenance | Vendored reference engine in ExplainWhy; durable snapshots in Supabase Postgres |
| Animation Studio | Validates scene data, renders Blender frames and encodes MP4 | Local Python/Blender/FFmpeg service |

No credentials or business records go into the animation prompt. The bridge uses
Studio's existing `POST /api/jobs/from-scene` API, which requires no OpenRouter key
and makes no model calls. Its original DeepSeek generation mode remains available
for the standalone creative workspace. Nemotron runs in ExplainWhy.

## Start the renderer

The upstream source is bundled in `apps/animation-studio`, imported from
`gtrg55/animation_studio` at commit `5b63441816224d913e655fbcd4575fbc6c9fea22`.
Read its README for supported versions and the macOS Blender sandbox. The launcher
currently supports macOS only.

From the repository root:

```sh
cd apps/animation-studio
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
./start.sh --port 8765
```

Keep that terminal open. Blender and FFmpeg must be installed at the locations
described in the Studio README (or set `ORBIT_BLENDER`, `ORBIT_FFMPEG`,
`ORBIT_FFPROBE`). Nothing disables Blender's sandbox.

## Configure ExplainWhy

Merge these values into `.env.local`; keep the existing database and authentication
settings. `DATABASE_URL` must point at local Postgres or Supabase Postgres; see `docs/mongodb.md`. Do not copy
placeholder Supabase credentials into a working configuration.

```dotenv
NVIDIA_INFERENCE_MODE="local"
NVIDIA_BASE_URL="http://127.0.0.1:11434/v1"
NVIDIA_LOCAL_MODEL="nemotron-3-nano:4b"
NVIDIA_STRUCTURED_OUTPUT="json_schema"
EXPLAINWHY_NEMOTRON_VERIFIER="false"

EXPLAINWHY_EXTERNAL_RESEARCH_ENABLED="true"
EXPLAINWHY_RESEARCH_PROVIDER="brightdata"
BRIGHTDATA_API_KEY="YOUR_PRIVATE_BRIGHT_DATA_KEY"
BRIGHTDATA_SERP_ZONE="YOUR_SERP_ZONE"

EXPLAINWHY_ZETARIS_ENABLED="true"
ZETARIS_BASE_URL="http://127.0.0.1:8888"
ZETARIS_API_KEY="YOUR_PRIVATE_ZETARIS_TOKEN"
ZETARIS_ORG_ID="YOUR_NUMERIC_ORG_ID"
ZETARIS_ADS_RELATION="YOUR_SOURCE.ads"
ZETARIS_CAMPAIGNS_RELATION="YOUR_SOURCE.campaigns"

EXPLAINWHY_ANIMATION_ENABLED="true"
ANIMATION_STUDIO_BASE_URL="http://127.0.0.1:8765"
```

Use a model actually installed on the Mac. Nano 4B is a starting point for testing;
it has not been evaluated here for full investigation quality. Larger models need
more memory, and the renderer, database and Zetaris also consume memory. Avoid
loading multiple large models simultaneously. Set a suitable context length in the
local runtime; the investigation schema, evidence and output must all fit.

For Ollama, after installing it from its official distribution:

```sh
ollama pull nemotron-3-nano:4b
ollama serve
```

If the Ollama app already serves port 11434, use that instance. For LM Studio,
load a Nemotron model, start its local server and use its advertised model ID and
`http://127.0.0.1:1234/v1`. Set `NVIDIA_LOCAL_API_KEY` if local authentication is
enabled. Cloud NVIDIA keys are never sent to a local inference server.

Local mode accepts only loopback endpoints. Cloud mode requires HTTPS and an
NVIDIA key; there is no automatic paid fallback. The optional verifier defaults to
the same model in local mode and is disclosed as a self-check. Its large reward
model is disabled locally unless explicitly configured.

Bright Data requires an API key and **SERP API zone**, not a Web Unlocker zone.
Only validated public topics, geography and dates leave ExplainWhy. Search snippets
are discovery candidates; existing safe publisher retrieval, passage checks,
publication-time checks and source assessment still apply. A Bright Data outage
records failed research and leaves the internal investigation usable.

Zetaris needs authorized images/access, a running instance and two registered
sources. Follow `docs/sponsor-integrations/README.md`; setting environment variables
alone does not establish a successful query. H-MEM needs no additional service or
API key, but it needs an earlier successful published report to recall.

From the root, start the application and its workers in separate terminals:

```sh
npm ci
npm run dev -- --hostname 127.0.0.1
npm run investigator:work
npm run planner:work
```

The browser should also run on the host Mac: returned video links point to the
local Studio. A separately hosted ExplainWhy instance cannot reach the friend's
loopback services. Remote access would require a separately designed connection.

## Check before the demonstration

```sh
# Configuration and an in-memory H-MEM check; no model/search calls:
npm run integrations:preflight
# Explicit live connectivity: includes one model acknowledgement and one public SERP query:
npm run integrations:preflight -- --live
# Real Zetaris query for the exported/registered run:
npm run sponsors:check -- --live --business nike_demo --run YOUR_RUN --from 2026-10-23T00:00:00.000Z --to 2026-10-24T00:00:00.000Z
# Real renderer check using labelled synthetic numbers; no model calls:
npm run animation:smoke -- --render
```

Preflight distinguishes configured, verified and blocked checks. It never claims
end-to-end sponsor acceptance. The render receipt is saved immediately in
`.local/animation-check/receipt.json`; inspect its job ID after interruptions before
starting another render. The separate smoke command intentionally creates a fresh
fixture render when invoked again.

In ExplainWhy, open a completed investigation's AI report and find **Animate this
comparison**. Select a verified measurement and create the chart. Progress, MP4
playback and the editable Blender download appear in the report.

## Data and failure behaviour

- Values, units, source records and business/run/investigation IDs come from the
  server's verified evidence. Client-submitted replacement figures are rejected.
- Both bars use one zero-based scale. Negative values extend below zero; zero
  has no invented bar. Synthetic observations remain labelled synthetic.
- The chart records an observed comparison. Bar growth is presentation and is
  explicitly not a measured time series or causal financial-loss estimate.
- Render submissions have a database ledger keyed by the evidence packet. Concurrent
  clicks reuse one submission. Definite pre-submit failures can be retried; an
  uncertain POST outcome is never submitted automatically again. Check Studio
  manually if it was accepted but no response reached ExplainWhy.
- Scope checks, response limits, timeouts and relative artifact validation constrain
  the integration. Renderer errors do not modify the investigation or its figures.
- Historical successful submissions stay attached to their saved figures. A changed
  observation produces a new packet; it cannot silently reuse the earlier render.

## Verification performed here

The compiler's packet passed the upstream Python scene validator. A real HTTP
submission rendered a five-second, 120-frame MP4 and an editable Blender project
on this Mac, using Blender 4.5.1 LTS. This verifies the chart subset on that version;
the upstream project recommends Blender 5.1 for the full creative feature set.
The upstream unit suite ran 115 tests successfully (114 passed, one optional test skipped).

New automated tests cover local provider routing, credential separation, Bright
Data errors, untrusted URLs, chart precision/negative values, scoped API requests,
duplicate submissions and uncertain outcomes. The regression run passed 426 tests
in 56 files against an isolated local database; ad hoc `tests/intelligence/_*`
diagnostic probes were excluded. TypeScript, production build and ESLint's error
check passed. Browser checks covered chart submission, completion, MP4 playback,
download links, repeated-request reuse and a mobile width without horizontal
overflow. Temporary QA routes and servers were removed/stopped afterward.

No live Bright Data/Zetaris/Nemotron
investigation on the friend's computer has been performed. Those require the
friend's runtime, credentials and registered data, followed by a recorded full run.

Official references: [Bright Data SERP API](https://docs.brightdata.com/api-reference/rest-api/serp/serp-api),
[Ollama Nemotron Nano](https://ollama.com/library/nemotron-3-nano:4b),
[Ollama API](https://docs.ollama.com/api/openai-compatibility),
[Zetaris API](https://kbase.zetaris.com/knowledge/rest-api).
