#!/usr/bin/env bash
# One-time bootstrap: schema, corpus, index, then start the whole stack.
#
# Safe to re-run. Migrations are idempotent, ingestion upserts on the passage
# key, and the index rebuilds from what is already in Postgres.
#
#   cd deploy && ./bootstrap.sh
#
# Takes roughly 20-40 minutes on a 4-core ARM instance: ingestion is about 15
# of that (Enoch is a few seconds), and the index run is CPU-bound local
# scoring.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$HERE/docker-compose.prod.yml}"
COMPOSE="docker compose -f $COMPOSE_FILE"

# shellcheck disable=SC1091
set -a; . "$HERE/.env"; set +a

cd "$HERE/.."

echo "==> starting Postgres"
$COMPOSE up -d postgres

echo "==> waiting for Postgres to accept connections"
for _ in $(seq 1 60); do
  if $COMPOSE exec -T postgres pg_isready -U "${POSTGRES_USER:-ilm}" -d "${POSTGRES_DB:-ilm}" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "==> applying migrations"
$COMPOSE run -T --rm api npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

echo "==> ingesting the corpora (about 15 minutes)"
$COMPOSE run -T --rm api npx tsx apps/api/scripts/ingest.ts

echo "==> ingesting the Book of Enoch"
$COMPOSE run -T --rm api npx tsx apps/api/scripts/ingest-enoch.ts

echo "==> indexing the original-language text (Arabic, Hebrew, Greek)"
$COMPOSE run -T --rm api npx tsx apps/api/scripts/index-original-text.ts

echo "==> scoring themes and building the search index"
$COMPOSE run -T --rm api npx tsx apps/api/scripts/index.ts

echo "==> building and starting api, web and caddy"
$COMPOSE up -d --build

echo
echo "==> done. Check:"
echo "    curl https://$ILM_API_HOST/health"
echo "    curl -sS -o /dev/null -w '%{http_code}\n' https://$ILM_HOST/"
echo
echo "A real search, to prove the corpus is there:"
echo "    curl -sS -X POST https://$ILM_API_HOST/api/search -H 'content-type: application/json' -d '{\"query\":\"mercy\"}' | head -c 400"
