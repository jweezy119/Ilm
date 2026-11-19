#!/usr/bin/env bash
# Start Ilm in Docker and expose it through a free Cloudflare quick tunnel.
#
#   cd deploy
#   ./tunnel.sh                       # start or restart the stack
#   ./tunnel.sh --bootstrap           # schema, ingest and index first, then start
#   docker compose -f docker-compose.tunnel.yml logs -f cloudflared
#
# Safe to re-run: migrations are idempotent, ingestion upserts on the passage
# key, and the index rebuilds from Postgres.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/.env.tunnel.local"
COMPOSE_FILE="$HERE/docker-compose.tunnel.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$HERE/.env.tunnel.example" "$ENV_FILE"
  echo "==> created $ENV_FILE — edit it before a public deployment"
fi

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

COMPOSE=(docker compose -f "$COMPOSE_FILE")

if [[ "${1:-}" == "--bootstrap" ]]; then
  echo "==> starting Postgres and building the API image"
  "${COMPOSE[@]}" up -d --build postgres api

  echo "==> waiting for Postgres"
  for _ in $(seq 1 60); do
    if "${COMPOSE[@]}" exec -T postgres pg_isready >/dev/null 2>&1; then break; fi
    sleep 2
  done

  echo "==> migrations"
  "${COMPOSE[@]}" run -T --rm api npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

  echo "==> ingesting the corpora (about 15 minutes)"
  "${COMPOSE[@]}" run -T --rm api npx tsx apps/api/scripts/ingest.ts
  "${COMPOSE[@]}" run -T --rm api npx tsx apps/api/scripts/ingest-enoch.ts

  echo "==> original-language search vectors"
  "${COMPOSE[@]}" run -T --rm api npx tsx apps/api/scripts/index-original-text.ts

  echo "==> theme scores and search index"
  "${COMPOSE[@]}" run -T --rm api npx tsx apps/api/scripts/index.ts
fi

echo "==> building and starting the stack"
"${COMPOSE[@]}" up -d --build

echo "==> waiting for the quick tunnel URL"
URL=""
for _ in $(seq 1 30); do
  URL=$("${COMPOSE[@]}" logs cloudflared 2>&1 | grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' | tail -1 || true)
  if [[ -n "$URL" ]]; then break; fi
  sleep 2
done

if [[ -n "$URL" ]]; then
  echo
  echo "    Ilm: $URL"
  echo "    API health: $URL/health"
else
  echo
  echo "    No URL yet. Watch it with:"
  echo "      docker compose -f $COMPOSE_FILE logs -f cloudflared"
fi

echo
echo "    Stop with:  docker compose -f $COMPOSE_FILE down"
