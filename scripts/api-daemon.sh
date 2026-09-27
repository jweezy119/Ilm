#!/usr/bin/env bash
# Start/stop the Ilm API in the background for local checks.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${LOG:-/tmp/opencode/api.log}"
PIDFILE="${PIDFILE:-/tmp/opencode/ilm-api.pid}"

stop() {
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    sleep 2
  fi
  pkill -f "tsx src/index.ts" 2>/dev/null || true
  rm -f "$PIDFILE"
}

start() {
  mkdir -p "$(dirname "$LOG")"
  cd "$ROOT/apps/api"

  # The app reads configuration from the environment, and loads apps/api/.env on
  # top of it outside production. Nothing is forced here: an empty export would
  # count as "set" and shadow the key in .env, so only real values are passed on.
  [[ -n "${DATABASE_URL:-}" ]] && export DATABASE_URL || true
  [[ -n "${TYPESAFE_API_KEY:-}" ]] && export TYPESAFE_API_KEY || true
  [[ -n "${OPENROUTER_API_KEY:-}" ]] && export OPENROUTER_API_KEY || true
  [[ -n "${CORS_ORIGIN:-}" ]] && export CORS_ORIGIN || true
  [[ -n "${LOG_LEVEL:-}" ]] && export LOG_LEVEL || true

  setsid npx tsx src/index.ts > "$LOG" 2>&1 < /dev/null &
  echo $! > "$PIDFILE"
  disown || true
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 2 http://localhost:4000/health > /dev/null 2>&1; then
      echo "api ready (pid $(cat "$PIDFILE"))"
      return 0
    fi
    sleep 1
  done
  echo "api did not become ready; see $LOG" >&2
  tail -20 "$LOG" >&2
  return 1
}

case "${1:-start}" in
  start) start ;;
  stop) stop; echo stopped ;;
  restart) stop; start ;;
  *) echo "usage: $0 {start|stop|restart}" >&2; exit 2 ;;
esac
