#!/usr/bin/env bash
# Ship the prebuilt images to a host that cannot build them.
#
# A 2 GB VPS has no room for `npm ci` plus `next build` (roughly 3-4 GB). Build
# here, where there is memory, and stream the images over SSH.
#
#   ./ship-images.sh user@203.0.113.10
#
# The two machines must share an architecture. Check before running:
#
#   docker info | grep Architecture     # here
#   ssh user@host 'docker info | grep Architecture'
#
# x86_64 here will not run on an ARM host. If they differ, build on the host
# instead, with a swap file (see deploy/README.md).

set -euo pipefail

HOST="${1:?usage: ./ship-images.sh user@host}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ARCH="$(docker info --format '{{.Architecture}}')"
echo "==> local architecture: $ARCH"

echo "==> building images"
docker compose -f "$HERE/docker-compose.prod.yml" build api web

echo "==> streaming ilm-api and ilm-web to $HOST"
docker save ilm-api:latest ilm-web:latest | gzip | ssh "$HOST" 'gunzip | docker load'

echo "==> done. On the host, start them with:"
echo "    docker compose -f deploy/docker-compose.prod.yml up -d"
echo ""
echo "    (no --build: the images are already there, and building is what this"
echo "     script was avoiding)"
