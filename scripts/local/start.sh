#!/usr/bin/env bash
# Starts ExplainWhy locally: the web app plus the monitor, investigator and planner workers.
# Ctrl-C stops all of them. Logs: .local/logs/<name>.log
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/local/common.sh

PORT="${PORT:-3000}"
[ -f .env.local ] && [ -d node_modules ] || die "Run ./scripts/local/setup.sh first."
use_node
require_docker
require_ollama
docker container inspect "$CONTAINER" >/dev/null 2>&1 || die "Database container $CONTAINER is missing. Run ./scripts/local/setup.sh first."
docker start "$CONTAINER" >/dev/null
wait_for_postgres
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then die "Port $PORT is already in use. Stop that app, or run: PORT=3100 ./scripts/local/start.sh"; fi

mkdir -p .local/logs
names=""
run() {
  local name="$1"; shift
  "$@" > ".local/logs/$name.log" 2>&1 &
  names="$names $name:$!"
  note "$name started (log: .local/logs/$name.log)"
}
# Stop every process this script started, including npm's children.
trap 'trap - EXIT INT TERM; printf "\nStopping ExplainWhy…\n"; kill 0 2>/dev/null; exit 0' INT TERM EXIT

say "Starting ExplainWhy"
run web npm run dev -- --hostname 127.0.0.1 --port "$PORT"
run monitor npm run monitor:watch
run investigator npm run investigator:work
run planner npm run planner:work

URL="http://127.0.0.1:$PORT"
for i in $(seq 1 120); do curl -fsS -o /dev/null "$URL/" 2>/dev/null && break; sleep 1; done
curl -fsS -o /dev/null "$URL/" 2>/dev/null || die "The web app did not start. See .local/logs/web.log"
say "ExplainWhy is running at $URL  (Ctrl-C to stop)"
note "First time? Open $URL/dev/simulator, click 'Start / reset run', then inject an incident."
[ -n "${NO_OPEN:-}" ] || open "$URL/dev/simulator" >/dev/null 2>&1 || true

# bash 3.2 has no `wait -n`: poll, and stop everything if any process exits.
while true; do
  for entry in $names; do
    if ! kill -0 "${entry#*:}" 2>/dev/null; then
      printf '\n%s stopped unexpectedly. Last lines of .local/logs/%s.log:\n' "${entry%%:*}" "${entry%%:*}"
      tail -20 ".local/logs/${entry%%:*}.log" || true
      exit 1
    fi
  done
  sleep 3
done
