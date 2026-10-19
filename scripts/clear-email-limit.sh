#!/bin/sh
# Clear the sign-in, signup, and invite locks for one email.
#
# Five bad attempts lock the normalized address for a minute. Further
# attempts double that wait, up to 16 minutes. Dots and a plus tag are the
# same lock: a.b+tag@example.com and ab@example.com.
#
#   ./scripts/clear-email-limit.sh 'person@example.com'
#
# CLEAR_MODE=docker (default) runs psql in the compose Postgres.
# CLEAR_MODE=psql runs psql on PATH against DATABASE_URL. Tests use that.
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: clear-email-limit.sh <email>" >&2
  exit 1
fi

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
CLEAR_MODE="${CLEAR_MODE:-docker}"
POSTGRES_USER="${POSTGRES_USER:-avouch}"
POSTGRES_DB="${POSTGRES_DB:-avouch}"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/docker-compose.yml}"

key="$(node --experimental-strip-types "$ROOT/server/clear-email-limit.ts" "$1")"
case "$key" in
  *[!a-z0-9_@.-]*|"")
    echo "Enter an email address." >&2
    exit 1
    ;;
esac

sql="delete from \"rateLimit\" where \"key\" in ('sign-in:email:${key}', 'signup:email:${key}', 'invite:email:${key}');"

case "$CLEAR_MODE" in
  docker)
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "$sql"
    ;;
  psql)
    if [ -z "${DATABASE_URL:-}" ]; then
      echo "Set DATABASE_URL for CLEAR_MODE=psql." >&2
      exit 1
    fi
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "$sql"
    ;;
  *)
    echo "CLEAR_MODE must be docker or psql." >&2
    exit 1
    ;;
esac

echo "Cleared the limit for ${key}."
