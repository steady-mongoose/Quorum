#!/bin/sh
# Dry-run the failover restore against a throwaway Postgres container.
# Creates a one-row database, dumps it, encrypts the dump with age, drops the
# row, and restores through scripts/restore-from-backup.sh. No bucket is used.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
NAME="${FAILOVER_DRILL_PG:-avouch-failover-drill}"
PORT="${FAILOVER_DRILL_PORT:-54329}"
PASS="${FAILOVER_DRILL_PASSWORD:-secret}"
DB="${FAILOVER_DRILL_DB:-avouch_restore_test}"
URL="postgres://avouch:${PASS}@127.0.0.1:${PORT}/${DB}"
WORK=""

on_exit() {
  status="$?"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  if [ -n "$WORK" ]; then
    rm -rf "$WORK"
  fi
  exit "$status"
}
trap on_exit EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the throwaway Postgres container." >&2
  exit 1
fi
if ! command -v age >/dev/null 2>&1 || ! command -v age-keygen >/dev/null 2>&1; then
  echo "age is required to encrypt the test dump." >&2
  exit 1
fi
if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore is required on PATH (postgresql-client)." >&2
  exit 1
fi

WORK="$(mktemp -d)"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" \
  -e POSTGRES_USER=avouch \
  -e POSTGRES_PASSWORD="$PASS" \
  -e POSTGRES_DB="$DB" \
  -p "127.0.0.1:${PORT}:5432" \
  postgres:16-bookworm >/dev/null

echo "Waiting for the throwaway Postgres"
ready=0
i=0
while [ "$i" -lt 60 ]; do
  if docker exec -e PGPASSWORD="$PASS" "$NAME" \
    pg_isready -h 127.0.0.1 -U avouch -d "$DB" >/dev/null 2>&1; then
    ready=1
    break
  fi
  i=$((i + 1))
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "The throwaway Postgres did not become ready." >&2
  exit 1
fi

psql_exec() {
  docker exec -e PGPASSWORD="$PASS" "$NAME" \
    psql -h 127.0.0.1 -U avouch -d "$DB" -v ON_ERROR_STOP=1 "$@"
}

psql_exec -c "create table drill_marker (note text not null); insert into drill_marker (note) values ('failover-drill');"
docker exec -e PGPASSWORD="$PASS" "$NAME" \
  pg_dump -h 127.0.0.1 -U avouch -d "$DB" --format=custom --no-owner > "$WORK/plain.dump"

age-keygen -o "$WORK/identity.txt" >/dev/null
recipient="$(sed -n 's/^# public key: //p' "$WORK/identity.txt")"
if [ -z "$recipient" ]; then
  echo "age-keygen did not write a public key." >&2
  exit 1
fi
age -r "$recipient" -o "$WORK/dump.age" "$WORK/plain.dump"
psql_exec -c "drop table drill_marker;"

echo "Restoring the test dump"
RESTORE_DRY_RUN=1 \
  RESTORE_DUMP="$WORK/dump.age" \
  AGE_IDENTITY_FILE="$WORK/identity.txt" \
  BACKUP_MODE=pg_restore \
  DATABASE_URL="$URL" \
  POSTGRES_DB="$DB" \
  "$ROOT/scripts/restore-from-backup.sh"

note="$(psql_exec -tAc "select note from drill_marker")"
case "$note" in
  *failover-drill*) ;;
  *)
    echo "The dry-run restore did not bring the marker back." >&2
    exit 1
    ;;
esac
echo "Dry-run restore brought the marker back."
