#!/usr/bin/env bash
#
# dev.sh — start the backend (Go + Fiber) and frontend (Vite) together in dev mode.
#
# Backend serves the content API on :8080 with CORS for the Vite dev server.
# Frontend runs Vite on :5173 and proxies/points at the backend.
# Ctrl-C stops both.
#
#   ./scripts/dev.sh
#
# Env overrides:
#   PORT          backend port            (default: 8080)
#   FRONTEND_PORT vite port               (default: 5173)
#   CONTENT_DIR   content tree            (default: ../content, relative to backend/)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"

PORT="${PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

# Pick a JS package runner: prefer bun (repo uses bun.lock), fall back to npm.
if command -v bun >/dev/null 2>&1; then
  JS_RUN="bun run"
elif command -v npm >/dev/null 2>&1; then
  JS_RUN="npm run"
else
  echo "error: neither bun nor npm found on PATH" >&2
  exit 1
fi

command -v go >/dev/null 2>&1 || { echo "error: go not found on PATH" >&2; exit 1; }

pids=()
cleanup() {
  echo
  echo "shutting down..."
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "starting backend  -> http://localhost:$PORT  (go run ./backend)"
( cd "$BACKEND_DIR" && PORT="$PORT" go run . ) &
pids+=($!)

echo "starting frontend -> http://localhost:$FRONTEND_PORT  ($JS_RUN dev)"
( cd "$FRONTEND_DIR" && $JS_RUN dev -- --port "$FRONTEND_PORT" ) &
pids+=($!)

echo
echo "both running. press Ctrl-C to stop."

# Exit (and trigger cleanup) as soon as either process dies.
wait -n
