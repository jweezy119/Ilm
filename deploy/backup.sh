#!/usr/bin/env bash
# Dump the database to deploy/backups/, keep the last 14 days.
#
#   ./backup.sh
#   0 3 * * * /path/to/deploy/backup.sh
#
# Restoring: gunzip -c ilm-20260101T000000Z.sql.gz | docker compose \
#   -f deploy/docker-compose.prod.yml exec -T postgres psql -U ilm -d ilm

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
set -a; . "$HERE/.env"; set +a

OUT="$HERE/backups"
mkdir -p "$OUT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

docker compose -f "$HERE/docker-compose.prod.yml" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-ilm}" --clean --if-exists "${POSTGRES_DB:-ilm}" \
  | gzip -9 > "$OUT/ilm-$STAMP.sql.gz"

find "$OUT" -name 'ilm-*.sql.gz' -mtime +14 -delete

echo "wrote $OUT/ilm-$STAMP.sql.gz ($(du -h "$OUT/ilm-$STAMP.sql.gz" | cut -f1))"
