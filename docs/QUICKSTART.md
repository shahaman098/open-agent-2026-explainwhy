# Quick start: run ExplainWhy on your Mac with a local model

Everything runs on your Mac: the app, a Postgres database in Docker and NVIDIA
Nemotron through Ollama. No cloud keys are needed.

## 1. Install three things (once)

- **Node.js 24**: `brew install node@24` (needs [Homebrew](https://brew.sh/))
- **Docker Desktop**: [download](https://docs.docker.com/desktop/setup/install/mac-install/), then open it
- **Ollama**: [download](https://ollama.com/download/mac), then open it

## 2. Get the project and set it up (once)

```sh
git clone --branch codex/sponsor-integrations https://github.com/shahaman098/open-agent-2026-explainwhy.git
cd open-agent-2026-explainwhy
./scripts/local/setup.sh
```

Setup installs dependencies, starts the database, downloads the Nemotron model
(about 3 GB) and writes `.env.local`. It ends with a model check. Safe to re-run.

## 3. Start it (every time)

```sh
./scripts/local/start.sh
```

It opens the Business control room in your browser at http://127.0.0.1:3000.
Press Ctrl-C in that terminal to stop everything.

## 4. First run: give the agent something to investigate

1. In **Control room**, click **Start / reset run**, then **+72h** to build normal
   history (wait until the charts fill in).
2. Under **Inject incident**, pick a scenario (the default *Ad fatigue* works), click
   **Inject scenario**, then **+24h**.
3. Open **Anomaly monitor**. The monitor detects the incident by itself within a few
   seconds and opens an investigation.
4. Go to **Overview → Investigations** and open that investigation.
   - Click the **Evidence** step, then **Collect evidence**.
   - Click the **Signal** step, then **Start AI investigation**. The local Nemotron
     model now reasons over the evidence and writes a cited diagnosis.
   - When it finishes, use **Decision / Plan → Generate solution plan**, then review
     it under **Approvals**.

Investigations on a small local model take several minutes.

## If something goes wrong

| Problem | Fix |
|---|---|
| `Docker is installed but not running` | Open Docker Desktop, wait until it says running, re-run |
| `Ollama … not answering` | Open the Ollama app, re-run |
| `Port 3000 is already in use` | `PORT=3100 ./scripts/local/start.sh` |
| Model check failed | The app still runs, but reports may say "insufficient evidence"; try a larger Nemotron model (see the message setup prints) |
| Anything else | Check the logs in `.local/logs/` |

Optional sponsor services (Bright Data research, Zetaris, the Nemotron verifier and
chart animation) are off by default. To turn them on, follow
[the full runbook](friend-mac-runbook.md).
