#!/bin/sh
# Clear the sign-in, signup, and invite locks for one email.
#
# Five bad attempts lock the normalized address for a minute. Further
# attempts double that wait, up to 16 minutes. Plus tags share a lock.
# Dots share a lock only for gmail.com and googlemail.com, which are one
# domain: first.last+tag@googlemail.com and firstlast@gmail.com.
#
#   ./scripts/clear-email-limit.sh 'person@example.com'
#
# The key helper uses node --experimental-strip-types, which needs Node
# 22.6 or newer on the host. The API image is Node 22. On an older host,
# derive the key inside that container (see deploy/README.md).
#
# CLEAR_MODE=docker (default) runs psql in the compose Postgres.
# CLEAR_MODE=psql runs psql on PATH. The password goes in a pgpass file,
# not on the command line, and the key is a psql variable.
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

if ! node -e 'const p=process.versions.node.split(".").map(Number); if (p[0] < 22 || (p[0] === 22 && p[1] < 6)) process.exit(1)'; then
  echo "clear-email-limit needs Node 22.6 or newer (--experimental-strip-types)." >&2
  echo "The API container has that Node. Derive the key there, then delete the printed keys:" >&2
  echo "  docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T api node --experimental-strip-types server/clear-email-limit.ts '<email>'" >&2
  exit 1
fi

key="$(node --experimental-strip-types "$ROOT/server/clear-email-limit.ts" "$1")"
case "$key" in
  *[!a-z0-9_@.-]*|"")
    echo "Enter an email address." >&2
    exit 1
    ;;
esac

sql=$(cat <<'SQL'
delete from "rateLimit" where "key" in (
  'sign-in:email:' || :'key',
  'signup:email:' || :'key',
  'invite:email:' || :'key'
);
SQL
)

passfile=""
cleanup() {
  if [ -n "$passfile" ]; then
    rm -f "$passfile"
  fi
}
trap cleanup EXIT

case "$CLEAR_MODE" in
  docker)
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v "key=${key}" -c "$sql"
    ;;
  psql)
    if [ -z "${DATABASE_URL:-}" ]; then
      echo "Set DATABASE_URL for CLEAR_MODE=psql." >&2
      exit 1
    fi
    passfile="$(mktemp)"
    meta="$(DATABASE_URL="$DATABASE_URL" node "$ROOT/scripts/pg-pass.mjs" "$passfile")"
    host="$(printf '%s\n' "$meta" | awk 'NR==1')"
    port="$(printf '%s\n' "$meta" | awk 'NR==2')"
    pguser="$(printf '%s\n' "$meta" | awk 'NR==3')"
    pgdb="$(printf '%s\n' "$meta" | awk 'NR==4')"
    env -u DATABASE_URL PGPASSFILE="$passfile" psql -h "$host" -p "$port" -U "$pguser" -d "$pgdb" \
      -v ON_ERROR_STOP=1 -v "key=${key}" -c "$sql"
    ;;
  *)
    echo "CLEAR_MODE must be docker or psql." >&2
    exit 1
    ;;
esac

echo "Cleared the limit for ${key}."
