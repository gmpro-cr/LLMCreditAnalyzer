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
( cd "$ROOT/frontend/artifacts/creditguard" && exec node_modules/.bin/vite --config vite.config.ts --host 127.0.0.1 --port 5173 ) &
pids+=($!)

wait
