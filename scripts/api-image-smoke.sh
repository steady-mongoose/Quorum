#!/bin/sh
# Build the API image, apply migrations to a throwaway Postgres, and boot it.
# Fails unless GET /api/health returns 200. That is how a missing src/lib
# module is caught: the process exits before it can listen.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to boot the API image." >&2
  exit 1
fi

IMAGE="${API_IMAGE:-avouch-api-smoke:ci}"
PG="${API_SMOKE_PG:-avouch-api-smoke-pg}"
API="${API_SMOKE_API:-avouch-api-smoke-api}"
# Share Postgres' network namespace. 127.0.0.1:5432 is that database, and the
# check does not depend on bridge firewall rules between containers.
DB_URL="postgres://avouch:postgrespass@127.0.0.1:5432/avouch"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    docker logs "$API" 2>/dev/null || true
    docker logs "$PG" 2>/dev/null || true
  fi
  docker rm -f "$API" "$PG" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

docker rm -f "$API" "$PG" >/dev/null 2>&1 || true

echo "Building the API image"
docker build -f deploy/Dockerfile --target app -t "$IMAGE" "$ROOT"

docker run -d --name "$PG" \
  -e POSTGRES_USER=avouch \
  -e POSTGRES_PASSWORD=postgrespass \
  -e POSTGRES_DB=avouch \
  postgres:16-bookworm

echo "Waiting for Postgres"
# The image starts a temporary server, shuts it down, then starts the real one.
# A check during that first start is not a database the API can use.
ready=0
i=0
while [ "$i" -lt 60 ]; do
  if docker logs "$PG" 2>&1 | grep -q "PostgreSQL init process complete"; then
    if docker exec -e PGPASSWORD=postgrespass "$PG" \
      psql -h 127.0.0.1 -U avouch -d avouch -c "select 1" >/dev/null 2>&1; then
      ready=1
      break
    fi
  fi
  i=$((i + 1))
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "Postgres did not become ready." >&2
  exit 1
fi

echo "Applying migrations"
docker run --rm --network "container:${PG}" \
  -e DATABASE_URL="$DB_URL" \
  -e MEDIA_WORKER_DB_PASSWORD=mediaworkerpass1 \
  "$IMAGE" \
  node scripts/migrate.mjs

echo "Starting the API"
docker run -d --name "$API" --network "container:${PG}" \
  -e DATABASE_URL="$DB_URL" \
  -e BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef \
  -e BETTER_AUTH_URL=http://127.0.0.1:8787 \
  -e WEB_ORIGINS=https://avouchsocial.com \
  "$IMAGE"

echo "Waiting for /api/health"
healthy=0
i=0
while [ "$i" -lt 40 ]; do
  running="$(docker inspect -f '{{.State.Running}}' "$API" 2>/dev/null || echo false)"
  if [ "$running" != "true" ]; then
    echo "The API process exited before /api/health returned 200." >&2
    exit 1
  fi
  if docker exec "$API" node --input-type=module -e '
const response = await fetch("http://127.0.0.1:8787/api/health");
const body = await response.text();
if (response.status !== 200) {
  console.error(response.status, body);
  process.exit(1);
}
console.log(body);
'; then
    healthy=1
    break
  fi
  i=$((i + 1))
  sleep 2
done
if [ "$healthy" != 1 ]; then
  echo "/api/health did not return 200." >&2
  exit 1
fi
