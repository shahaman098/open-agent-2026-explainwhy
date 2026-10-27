# Run ExplainWhy + Animation Studio on your Mac

This guide verifies NVIDIA Nemotron, Bright Data, Zetaris and Meterless H-MEM,
then checks financial-chart animation. Run commands from the ExplainWhy project
root unless a step says otherwise. Keep each long-running service in its own
Terminal tab.

Follow this guide's database/model settings when older project documents mention
MongoDB or Mubit: those sections describe an earlier setup.

## 1. Get the updated project

Ask Aman for the updated **ExplainWhy project**, including its integration changes.
The standalone `gtrg55/animation_studio` repository is not enough. At the time this
guide was written, the latest integration changes were still uncommitted locally;
cloning the existing remote alone would not include those files.

Check your copy before continuing:

```sh
test -f scripts/check-friend-mac.ts
test -f scripts/smoke-financial-animation.ts
test -f src/integrations/brightdata/search.ts
test -f apps/animation-studio/server.py
```

Each command must exit successfully. Get the complete updated folder if any file
is missing. Do not transfer someone else's `.env.local`, databases or credentials.

## 2. Install prerequisites

Use an Apple Silicon Mac for the simplest local-model setup. Check **About This
Mac** and note its chip and RAM. Model capacity is not established by installation
alone; the live investigation below must also pass.

Install:

- Node.js 24, Python 3.12 or newer, Git and FFmpeg.
- Docker Desktop for Mac, running, with Compose **2.24.4 or newer**. Our local
  Zetaris port override uses `!override`, which needs that version.
- Ollama from its official Mac distribution.
- Blender, preferably the Animation Studio README's supported 5.1 version, in
  `/Applications/Blender.app`. The chart subset was also tested on Blender 4.5.1.
- PostgreSQL 17, provided by the Docker container in step 4. This working copy
  uses a Postgres document store; the older MongoDB setup is no longer sufficient.

Install [Homebrew](https://brew.sh/) first if `brew` is unavailable. For a Mac with
Homebrew, these install the command-line dependencies:

```sh
brew install node@24 python ffmpeg
export PATH="$(brew --prefix node@24)/bin:$PATH"
```

Repeat the PATH command in new terminal tabs if `node` otherwise resolves to an
older installation. Verify:

```sh
node --version
python3 --version
git --version
ffmpeg -version
ffprobe -version
docker compose version
/Applications/Blender.app/Contents/MacOS/Blender --version
```

Sources: [Node 24 Homebrew formula](https://formulae.brew.sh/formula/node@24),
[Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/),
[Docker Compose override requirement](https://docs.docker.com/reference/compose-file/merge/),
[Ollama download](https://ollama.com/download/macOS).

## 3. Install the project dependencies

From the updated ExplainWhy root:

```sh
npm ci
mkdir -p .local/sponsor-verification
```

Install the separate Python renderer dependencies:

```sh
cd apps/animation-studio
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cd ../..
```

## 4. Start local Postgres

Open Docker Desktop. For a **new** local demo database, from the project root:

```sh
umask 077
test -f .local/postgres.env || printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" > .local/postgres.env
docker volume create explainwhy-friend-pgdata
docker run -d --name explainwhy-friend-postgres \
  --restart unless-stopped \
  -p 127.0.0.1:54329:5432 \
  --env-file .local/postgres.env \
  -e POSTGRES_USER=explainwhy -e POSTGRES_DB=explainwhy \
  -v explainwhy-friend-pgdata:/var/lib/postgresql/data \
  postgres:17
```

Wait until ready, then run:

```sh
docker exec explainwhy-friend-postgres pg_isready -U explainwhy -d explainwhy
docker exec explainwhy-friend-postgres psql -U explainwhy -d explainwhy -c 'select 1;'
```

**Pass:** it accepts connections and SQL returns `1`. Keep the password from
`.local/postgres.env` for step 7. On later launches, use
`docker start explainwhy-friend-postgres`; do not recreate its password or delete
its volume. The application creates its collection tables and indexes itself.

An existing Supabase Postgres database also works: use its actual connection URL
and a separate test schema. Supabase Auth is optional for this local development
workflow. An old `MONGODB_URI` alone will not configure this version.

Source: [Official Postgres Docker image](https://hub.docker.com/_/postgres).

## 5. Start Nemotron locally

Open the Ollama Mac app. It normally starts its local server. Download the small
Nemotron model:

```sh
ollama pull nemotron-3-nano:4b
```

If Ollama is not already serving, run `ollama serve` in a separate terminal tab.
Do not start a second server when port 11434 is already in use.

Give the project a model alias with an explicit starting context budget:

```sh
cat > .local/Nemotron.Modelfile <<'EOF'
FROM nemotron-3-nano:4b
PARAMETER num_ctx 16384
EOF
ollama create explainwhy-nemotron -f .local/Nemotron.Modelfile
curl -fsS http://127.0.0.1:11434/v1/models
```

**Pass:** the models response includes `explainwhy-nemotron`. This proves model
availability, not JSON reliability or diagnosis quality. Step 10 tests JSON output;
step 12 tests the actual investigation. A larger model/context may need more RAM.

Sources: [Nemotron Nano model](https://ollama.com/library/nemotron-3-nano:4b),
[Ollama Modelfile and context settings](https://docs.ollama.com/modelfile).

For LM Studio instead: load a Nemotron model, start the local server, and use its
advertised model ID with `NVIDIA_BASE_URL=http://127.0.0.1:1234/v1`. Set
`NVIDIA_LOCAL_API_KEY` only if that server requires authentication.

## 6. Obtain Bright Data and Zetaris access

**Bright Data:** create an API token and a **SERP API zone**. Note the exact zone
name. A Web Unlocker zone is a different product. The app runs on the Mac; Bright
Data itself is a cloud API. The live test makes a public search request and uses
the account's allowance/billing.

Source: [Bright Data SERP API](https://docs.brightdata.com/api-reference/rest-api/serp/serp-api).

**Zetaris:** obtain Docker Hub entitlement to the official Zetaris images through
the hackathon/provider. Then, with Docker Desktop running:

```sh
npm run zetaris:prepare
docker login
npm run zetaris:start
```

The project starts only the four data-platform services. Do not replace this with
an unrestricted `docker compose up` of the entire upstream stack; that also defines
optional AI services and another Ollama server.

Check the services:

```sh
docker compose -p explainwhy-zetaris \
  -f .local/zetaris-freemium/docker-compose.yml \
  -f .local/zetaris-freemium/explainwhy.override.yml ps
```

**Pass:** `zetaris-db`, `zetaris-server`, `zetaris-api` and `zetaris-gui` stay running.
Open `http://localhost:9001`. Use the development-account procedure in the pinned
`.local/zetaris-freemium/README.md`, then obtain the numeric organisation ID and
API token from that instance. The API endpoint is `http://127.0.0.1:8888`.

If image pulls return `denied`/`unauthorized`, access is not activated. If Docker
reports an unsupported architecture, confirm the supported Mac deployment with
Zetaris. Do not call either condition a successful installation.

Source: [Zetaris Docker access guidance](https://kbase.zetaris.com/knowledge/docker-installation-on-docker-desktop).

## 7. Create the local configuration

Create/edit `.env.local` in the ExplainWhy root. If it already exists, merge the
settings rather than overwriting it. Replace the credential placeholders with your
own values. Leave Zetaris disabled until its data registration in step 9.

```dotenv
DATABASE_URL="postgresql://explainwhy:REPLACE_WITH_LOCAL_POSTGRES_PASSWORD@127.0.0.1:54329/explainwhy"
DATABASE_SCHEMA="explainwhy_friend_demo"

EXPLAINWHY_MODEL_PROVIDER="nvidia"
NVIDIA_INFERENCE_MODE="local"
NVIDIA_BASE_URL="http://127.0.0.1:11434/v1"
NVIDIA_LOCAL_MODEL="explainwhy-nemotron"
NEMOTRON_INVESTIGATOR_MODEL="explainwhy-nemotron"
NEMOTRON_DIAGNOSIS_MODEL="explainwhy-nemotron"
NEMOTRON_PLANNER_MODEL="explainwhy-nemotron"
NVIDIA_STRUCTURED_OUTPUT="json_schema"
EXPLAINWHY_NEMOTRON_VERIFIER="false"

EXPLAINWHY_EXTERNAL_RESEARCH_ENABLED="true"
EXPLAINWHY_RESEARCH_PROVIDER="brightdata"
BRIGHTDATA_API_KEY="REPLACE_WITH_YOUR_KEY"
BRIGHTDATA_SERP_ZONE="REPLACE_WITH_YOUR_SERP_ZONE"

EXPLAINWHY_ZETARIS_ENABLED="false"
ZETARIS_BASE_URL="http://127.0.0.1:8888"
ZETARIS_API_KEY="REPLACE_WITH_YOUR_TOKEN"
ZETARIS_ORG_ID="REPLACE_WITH_YOUR_NUMERIC_ORG_ID"
ZETARIS_ADS_RELATION="REPLACE_AFTER_REGISTRATION"
ZETARIS_CAMPAIGNS_RELATION="REPLACE_AFTER_REGISTRATION"

EXPLAINWHY_ANIMATION_ENABLED="true"
ANIMATION_STUDIO_BASE_URL="http://127.0.0.1:8765"
```

Local inference needs no NVIDIA cloud key. H-MEM needs no API key or separate
server. The independent verifier is optional and is not required to prove Nemotron
is doing the primary investigation. No OpenRouter or Gemini key is required for
this connected chart workflow. The three stage overrides above prevent old cloud
model names in an existing file from overriding the local alias. Keep Supabase
Auth settings unset unless configured; do not copy the example project URL/key
placeholders into your file. The local Postgres password is the value after
`POSTGRES_PASSWORD=` in `.local/postgres.env`, without that prefix.

## 8. Prepare one populated synthetic run and export its advertising data

From the ExplainWhy root:

```sh
npm run demo:stage5 -- --prepare
```

This generates data and detects an advertising incident without a model request.
Copy `simulationRunId` and `investigationId` from its final `phase: prepared` output.
In your verification terminal, set:

```sh
export CHECK_RUN='REPLACE_WITH_simulationRunId'
export CHECK_INV='REPLACE_WITH_investigationId'
```

For this newly generated, unadvanced default demo, export the enclosing window:

```sh
npm run zetaris:export -- --business nike_demo --run "$CHECK_RUN" \
  --from 2026-10-01T00:00:00.000Z --to 2026-10-06T00:00:00.000Z
```

**Pass:** output reports a positive observation count and writes
`.local/zetaris-data/ads.csv`, `campaigns.csv` and `manifest.json`. These dates apply
to this default demo, whose virtual clock starts on 1 October 2026; they are not
today's dates. For an existing/custom/advanced run, use its actual observed window.

## 9. Register both sources in Zetaris

Copy the exported files into the container-mounted shared directory:

```sh
cp .local/zetaris-data/ads.csv .local/zetaris-freemium/customer_data/shared/explainwhy/
cp .local/zetaris-data/campaigns.csv .local/zetaris-freemium/customer_data/shared/explainwhy/
```

In the Zetaris UI, register both files as separate relations. Their path inside
the containers is `/home/zetaris/data/shared/explainwhy/`.

- Keep the CSV header names unchanged.
- Register IDs, `window_start` and `window_end` as **strings**, preserving the full
  UTC ISO text, including `.000Z`.
- Register `impressions`, `clicks`, `spend_minor`, `attributed_orders` and
  `attributed_revenue_minor` as nonnegative integer measures.
- Ensure campaign catalogue keys `(business_id, simulation_run_id, campaign_id)`
  are unique.
- Use named JSON result objects for the API result format.

Put the actual fully qualified relation names in `.env.local`, for example
`my_source.ads` and `my_source.campaigns`. Set
`EXPLAINWHY_ZETARIS_ENABLED="true"`. The names must match the instance; the example
names are not automatically created by our script.

## 10. Start the apps and run connectivity checks

Terminal A, from `apps/animation-studio`:

```sh
./start.sh --port 8765
```

Terminal B, from the ExplainWhy root:

```sh
npm run dev -- --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000` and `http://127.0.0.1:8765` on this Mac. If either
service reports a different port because of a conflict, resolve the conflict or
update the corresponding configuration/commands consistently.

In your verification terminal, from the ExplainWhy root:

```sh
npm run integrations:preflight
npm run integrations:preflight -- --live
```

**Expected:** `nemotron`, `brightdata`, `meterless_hmem`, `animation_studio` and
`supabase_postgres` show `verified`; `zetaris` shows `configured`. That database
check name also covers our local Postgres container. The live model test must
return the validated JSON acknowledgement, not just a reachable `/models` endpoint.
H-MEM's check here is explicitly an in-memory fixture. `endToEndVerified: false`
is intentional: the remaining steps establish stronger evidence.

## 11. Verify a real Zetaris query and canonical evidence

In the same verification terminal where `CHECK_RUN` and `CHECK_INV` are set:

```sh
npm run sponsors:check -- --live --business nike_demo --run "$CHECK_RUN" \
  --from 2026-10-01T00:00:00.000Z --to 2026-10-06T00:00:00.000Z
```

**Pass:** `zetaris.liveQueryVerified` is `true`, the status is `queried`, receipt
row count is positive and `receipt.closed` is `true`. The saved report is
`docs/sponsor-integrations/latest-check.json`. Its
`canonicalEvidenceVerified: false` means this connectivity check does not itself
compare every metric against the canonical source events.

Save the live result before another sponsor check replaces `latest-check.json`:

```sh
cp docs/sponsor-integrations/latest-check.json .local/sponsor-verification/zetaris-live.json
```

Now perform that comparison through the real evidence tool:

```sh
curl -fsS -X POST \
  "http://127.0.0.1:3000/api/dev/investigations/$CHECK_INV/collect-evidence" \
  -H 'Content-Type: application/json' \
  --data "{\"businessId\":\"nike_demo\",\"simulationRunId\":\"$CHECK_RUN\",\"collectionMode\":\"refresh\"}" \
  > .local/sponsor-verification/evidence-collection.json

curl -fsS \
  "http://127.0.0.1:3000/api/investigations/$CHECK_INV/evidence-trace?businessId=nike_demo&simulationRunId=$CHECK_RUN" \
  > .local/sponsor-verification/evidence-trace.json

curl -fsS \
  "http://127.0.0.1:3000/api/investigations/$CHECK_INV/evidence?businessId=nike_demo&simulationRunId=$CHECK_RUN&tool=zetaris_campaign_analysis" \
  > .local/sponsor-verification/zetaris-evidence.json
```

**Pass:** the trace includes a **completed**, nonempty `zetaris_campaign_analysis`
tool run. Its evidence contains `detail.provider: Zetaris`, positive
`detail.verifiedObservations`, the real query receipt and successful evidence
verification. A completed collection can contain a failed individual tool, so
inspect the Zetaris result rather than relying only on the HTTP status.

## 12. Verify Nemotron on a real investigation

Keep the web and renderer running. Before starting the background investigator
worker, process the prepared run directly:

```sh
npm run demo:stage5 -- --run="$CHECK_RUN"
```

**Pass:** the saved report exists, the investigation is `completed` or honestly
`insufficient_evidence`, accepted model calls have request metadata pointing to
the local endpoint/model, and citation checks pass. A provider-error fallback is
not a successful Nemotron demonstration. Check the returned model-call statuses
and errors, not just whether a report object exists.

Save the API result:

```sh
curl -fsS \
  "http://127.0.0.1:3000/api/investigations/$CHECK_INV/ai?businessId=nike_demo&simulationRunId=$CHECK_RUN" \
  > .local/sponsor-verification/investigation.json
```

Bright Data is already live-tested by preflight. To claim it contributed to this
particular investigation, also require a completed `external_research` call whose
metadata provider is `brightdata`, plus source-verification records. The model may
choose not to request research; that is not a Bright Data connectivity failure,
but it is not proof of its use in that investigation either.

For subsequent UI-driven investigations, start these in separate root terminals:

```sh
npm run investigator:work
```

```sh
npm run planner:work
```

Restart the web app and workers whenever `.env.local` changes.

## 13. Verify H-MEM against an actual saved report

First run the offline engine check:

```sh
npm run sponsors:check
```

**Pass:** `meterless.passed` is true. That result is labelled `fixture: true` and
is not proof of persistent report recall.

After step 12 has published a valid report, run this from the root, in the same
terminal with `CHECK_RUN` set. It reads actual saved report memories and invokes
the real engine without another model request:

```sh
node --conditions=react-server --import tsx --input-type=module <<'JS'
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { DocClient, poolConfigFromUrl } from './src/lib/docstore/client.ts';
import { getDbName } from './src/lib/mongodb.ts';
import { recallHistoricalMemories } from './src/integrations/meterless/history.ts';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
if (!process.env.CHECK_RUN) throw new Error('Set CHECK_RUN first');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in .env.local');
const client = new DocClient(poolConfigFromUrl(process.env.DATABASE_URL));
try {
  const db = client.db(getDbName());
  const scope = {businessId:'nike_demo', simulationRunId:process.env.CHECK_RUN};
  const memories = await db.collection('meterless_memories').find(scope)
    .sort({availableAt:-1}).limit(50).toArray();
  if (!memories.length) throw new Error('No published report memory; fix/complete the investigation first');
  for (const memory of memories) {
    const source = await db.collection('investigation_reports').findOne({
      ...scope, investigationId:memory.investigationId, reportId:memory.reportId
    });
    if (!source) throw new Error('Memory source report is missing');
  }
  const cutoff = memories.map(m=>m.observedThrough).sort().at(-1);
  const recall = recallHistoricalMemories({...scope,
    investigationId:'manual_hmem_verification', cutoff,
    availableBefore:new Date().toISOString()}, memories[0].title, memories);
  const passed = recall.memories.length > 0 && recall.ledger.some(e=>e.action==='read');
  const result = {passed, fixture:false, check:'saved-report engine recall', recall};
  await writeFile('.local/sponsor-verification/hmem-live.json', JSON.stringify(result,null,2));
  console.log(JSON.stringify({passed, fixture:false, recalled:recall.memories.length}));
  if (!passed) process.exitCode = 1;
} finally { await client.close(); }
JS
```

**Pass:** `passed: true`, `fixture: false`, at least one recalled source and read
ledger entry. This checks persistence plus engine recall. To additionally prove
automatic prompt reinjection, create a later investigation in the **same run**
after the first report was published, then inspect its `historical_incidents`
detail for `hmem.memories`, report provenance and read ledger entries. Starting a
different simulation run intentionally does not recall the first run's memory.

## 14. Verify financial animation

From the root:

```sh
npm run animation:smoke -- --render
```

**Pass:** final status is `complete`; `.local/animation-check/receipt.json` contains
the job ID, video URL and Blender URL. Open the video and play it. This is a
labelled fixture render, not an additional model call.

Then open the investigation workspace printed in step 12, using
`http://127.0.0.1:3000` plus its `/dashboard/investigations/...?...` path. In the AI
report, find **Animate this comparison**, choose a verified baseline/current
measurement and click **Create chart animation**.

**Pass:** the displayed values match the evidence; progress reaches complete;
video playback and the `.blend` download work. Repeating the same chart request
should reuse its saved render. After an ambiguous submission, inspect Studio's
job history rather than repeatedly starting new renders.

## Final verification checklist

| Item | Required evidence |
| --- | --- |
| NVIDIA Nemotron | Live JSON preflight plus accepted local-model investigation calls |
| Bright Data | Live authenticated SERP response; for workflow-use claims, a completed Bright Data research call and checked publisher sources |
| Zetaris | Positive real query, closed cursor, completed evidence tool and canonical metric matching |
| Meterless H-MEM | Offline engine pass plus actual persisted report recall with source lineage and read ledger; later same-run investigation for prompt-reinjection proof |
| Animation Studio | Completed render, working MP4/Blender outputs and chart figures matching the evidence |

Keep `.local/sponsor-verification/`, the Zetaris check JSON, render receipt and the
saved investigation result. Share redacted results and screenshots, not
`.env.local` or API tokens. A configured service, a running container or an HTTP
200 alone does not establish that its integration passed.

## Common blockers

| Symptom | Action |
| --- | --- |
| Missing integration command/file | Get the complete updated ExplainWhy source folder |
| Database configuration/connection error | This version requires `DATABASE_URL`; check Postgres is accepting connections and the password, port and schema are correct |
| Nemotron timeout, invalid JSON or context error | Confirm the configured model is installed; check RAM, context and local-runtime logs; a larger model may be needed |
| Bright Data 401/403 | Correct the API token and SERP-zone access |
| Bright Data 429 | Check the account's rate limit/allowance before retrying |
| Zetaris image `denied` | Obtain Docker Hub image entitlement |
| Zetaris no matching manifest/architecture | Confirm the supported Mac image/runtime with Zetaris |
| Zetaris empty or mismatched results | Recheck run, dates, column types, catalogue uniqueness and CSV registration; re-export if the run advanced |
| H-MEM recalls nothing | Publish a non-provider-failure report first; use the same business/run and eligible time boundary |
| Chart option unavailable | It needs verified evidence with a finite baseline/current measurement |
| Renderer unavailable | Check Studio, Blender/FFmpeg paths and port 8765; keep its terminal open |

All local browser links assume the browser is running on this same Mac. Bright
Data still requires internet access. No full four-sponsor live run on this Mac is
claimed until the checklist has actually passed.
