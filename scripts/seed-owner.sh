#!/bin/sh
# Seat Josh once, then remove his password from deploy/.env and recreate the API
# so the password is not left in the process environment.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/docker-compose.yml}"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api npm run seed:owner
node --experimental-strip-types "$ROOT/server/env-file.ts" "$ENV_FILE"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate --no-deps api
echo "Josh is seated. BOOTSTRAP_OWNER_PASSWORD was removed from $ENV_FILE and the API was recreated."
