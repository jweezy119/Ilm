#!/usr/bin/env bash
# Start/stop the Ilm web app in the background for local checks.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${LOG:-/tmp/opencode/web.log}"
PIDFILE="${PIDFILE:-/tmp/opencode/ilm-web.pid}"

stop() {
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    sleep 2
  fi
  pkill -f "next dev" 2>/dev/null || true
  pkill -f "next-server" 2>/dev/null || true
  rm -f "$PIDFILE"
}

start() {
  mkdir -p "$(dirname "$LOG")"
  cd "$ROOT/apps/web"
  setsid npx next dev -p 3000 > "$LOG" 2>&1 < /dev/null &
  echo $! > "$PIDFILE"
  disown || true
  for _ in $(seq 1 90); do
    if curl -fsS --max-time 3 http://localhost:3000/ > /dev/null 2>&1; then
      echo "web ready (pid $(cat "$PIDFILE"))"
      return 0
    fi
    sleep 1
  done
  echo "web did not become ready; see $LOG" >&2
  tail -30 "$LOG" >&2
  return 1
}

case "${1:-start}" in
  start) start ;;
  stop) stop; echo stopped ;;
  restart) stop; start ;;
  *) echo "usage: $0 {start|stop|restart}" >&2; exit 2 ;;
esac
