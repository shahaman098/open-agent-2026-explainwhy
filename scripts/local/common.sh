# Shared helpers for scripts/local/setup.sh and scripts/local/start.sh (macOS bash 3.2 compatible).

CONTAINER="explainwhy-friend-postgres"
VOLUME="explainwhy-friend-pgdata"
PG_PORT=54329
MODEL_ALIAS="explainwhy-nemotron"
OLLAMA_URL="http://127.0.0.1:11434"

say() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

# Prefer a working Node 24 (Homebrew's node@24 is keg-only, and a default `node` may be a different, even broken, install).
use_node() {
  local dir
  for dir in "$(brew --prefix node@24 2>/dev/null)/bin" /opt/homebrew/opt/node@24/bin /usr/local/opt/node@24/bin; do
    if [ -x "$dir/node" ] && "$dir/node" --version >/dev/null 2>&1; then PATH="$dir:$PATH"; export PATH; break; fi
  done
  command -v node >/dev/null 2>&1 && node --version >/dev/null 2>&1 \
    || die "Node.js 24 is not installed or does not start. Install it with: brew install node@24"
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 22 ] || die "Node.js $(node --version) is too old. Install Node 24 with: brew install node@24"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install Docker Desktop for Mac, open it, then re-run."
  docker info >/dev/null 2>&1 || die "Docker is installed but not running. Open Docker Desktop, wait for it to start, then re-run."
}

# Ollama's Mac app runs the local server; start it if it is installed but not serving yet.
require_ollama() {
  command -v ollama >/dev/null 2>&1 || die "Ollama is not installed. Install it from https://ollama.com/download/mac, open it, then re-run."
  if ! curl -fsS "$OLLAMA_URL/api/version" >/dev/null 2>&1; then
    note "Starting Ollama…"
    open -a Ollama >/dev/null 2>&1 || (ollama serve >/dev/null 2>&1 &)
    local i
    for i in $(seq 1 30); do curl -fsS "$OLLAMA_URL/api/version" >/dev/null 2>&1 && return 0; sleep 1; done
    die "Ollama is installed but its server is not answering on $OLLAMA_URL. Open the Ollama app, then re-run."
  fi
}

wait_for_postgres() {
  local i
  for i in $(seq 1 60); do
    docker exec "$CONTAINER" pg_isready -U explainwhy -d explainwhy >/dev/null 2>&1 && return 0
    sleep 1
  done
  die "Postgres did not become ready. Check: docker logs $CONTAINER"
}
