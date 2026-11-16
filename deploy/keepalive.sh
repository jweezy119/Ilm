#!/usr/bin/env bash
# Keep an Oracle Always Free instance from being reclaimed as idle.
#
# Oracle reclaims Always Free compute whose CPU and network stay near zero for
# seven consecutive days. This is not traffic generation and it serves no
# request: it is ten seconds of real arithmetic, plus one local HTTP call, on a
# timer. That is the minimum that keeps the instance classified as in use.
#
#   0 */6 * * * /path/to/deploy/keepalive.sh >/dev/null 2>&1

set -uo pipefail

end=$((SECONDS + 10))
x=0
while (( SECONDS < end )); do
  x=$(( (x * 31 + 7) % 1000003 ))
done

# Loopback only; a 404 still counts as network activity.
curl -s -o /dev/null -m 10 http://127.0.0.1/health || true
