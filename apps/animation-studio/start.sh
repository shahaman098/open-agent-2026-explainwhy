#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
runtime="${ORBIT_PYTHON:-.venv/bin/python}"
if [[ ! -x "$runtime" ]]; then
  echo 'Create the local environment first: python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt' >&2
  exit 1
fi
if [[ "$(uname -s)" != 'Darwin' ]]; then
  echo 'The current Blender sandbox requires macOS. Other platforms are not supported by this launcher.' >&2
  exit 1
fi
exec /usr/bin/caffeinate -i "$runtime" -u server.py "$@"
