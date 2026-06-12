#!/usr/bin/env bash
# Start all three CreditGuard AI dev servers locally.
#   Python engine  -> http://localhost:8000
#   API server     -> http://localhost:3001
#   Vite SPA       -> http://localhost:5173  (open this one)
# Ctrl+C stops all three.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Supabase creds + provider config for the api-server
set -a; source "$ROOT/.env.local"; set +a
export SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
export PYTHON_SERVICE_URL="http://127.0.0.1:8000"
export PORT=3001
export NODE_ENV=development

# Preflight: refuse to start if any required port already has a listener on
# EITHER stack. A half-free port is worse than a busy one — another dev server
# can bind the free half (e.g. [::1]:5173) and "localhost" then splits between
# two apps per connection, breaking API calls silently.
for port in 8000 3001 5173; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "ERROR: port $port is already in use:" >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2
    echo "Stop that process (old dev session or another project), then re-run ./dev.sh" >&2
    exit 1
  fi
done

pids=()
cleanup() { echo; echo "stopping dev servers..."; kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "→ Python engine  http://localhost:8000"
( cd "$ROOT/python-service" && exec venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 ) &
pids+=($!)

echo "→ API server     http://localhost:3001"
( cd "$ROOT/frontend" && exec node --enable-source-maps artifacts/api-server/dist/index.mjs ) &
pids+=($!)

echo "→ Vite SPA       http://localhost:5173   ← open this"
# --host :: binds dual-stack (IPv4 + IPv6) so this Vite owns the WHOLE port;
# with 127.0.0.1 only, another project's dev server can squat [::1]:5173.
( cd "$ROOT/frontend/artifacts/creditguard" && exec node_modules/.bin/vite --config vite.config.ts --host :: --port 5173 ) &
pids+=($!)

wait
