#!/usr/bin/env bash
# Restore one age-encrypted Avouch dump.
#
#   ./scripts/restore-postgres.sh [--overwrite] /var/backups/avouch/avouch-STAMP.dump.age
#
# Stop the API first. This replaces the accounts, invite log, and founding
# seat with the dump. It does not change the static site.
#
# The decrypted dump is listed with pg_restore --list before the database is
# touched. Without --overwrite the target must be empty: a database that
# already has objects in public is refused, and nothing is dropped. Pass
# --overwrite only when you mean to replace that database. Docker mode then
# drops and recreates POSTGRES_DB. pg_restore mode drops and recreates the
# public schema, then restores.
#
# AGE_IDENTITY_FILE is the age identity (AGE-SECRET-KEY-1...). Copy it onto
# the box only for this restore, then delete it. The nightly backup env keeps
# the public key only.
#
#   docker compose --env-file deploy/.env -f deploy/docker-compose.yml stop api
#   AGE_IDENTITY_FILE=/tmp/avouch-backup-identity.txt \
#     ./scripts/restore-postgres.sh --overwrite /path/to/avouch-STAMP.dump.age
#   shred -u /tmp/avouch-backup-identity.txt 2>/dev/null || rm -f /tmp/avouch-backup-identity.txt
#   docker compose --env-file deploy/.env -f deploy/docker-compose.yml start api
#   curl -fsS https://api.avouchsocial.com/api/health
#
# To fetch the newest copy from the bucket and restore it, use
# scripts/restore-from-backup.sh. That script uses the same env names.
#
# BACKUP_MODE=docker (default) restores into the compose Postgres.
# BACKUP_MODE=pg_restore shells out to pg_restore on PATH, which tests use.
# When DATABASE_URL is set, pg_restore writes into that database.
set -euo pipefail

OVERWRITE=0
ENC=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --overwrite) OVERWRITE=1 ;;
    -*)
      echo "Unknown flag: $1" >&2
      exit 1
      ;;
    *)
      if [ -n "$ENC" ]; then
        echo "Usage: restore-postgres.sh [--overwrite] <avouch-STAMP.dump.age>" >&2
        exit 1
      fi
      ENC="$1"
      ;;
  esac
  shift
done
if [ -z "$ENC" ]; then
  echo "Usage: restore-postgres.sh [--overwrite] <avouch-STAMP.dump.age>" >&2
  exit 1
fi

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
BACKUP_MODE="${BACKUP_MODE:-docker}"
AGE_IDENTITY_FILE="${AGE_IDENTITY_FILE:-}"
POSTGRES_USER="${POSTGRES_USER:-avouch}"
POSTGRES_DB="${POSTGRES_DB:-avouch}"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/docker-compose.yml}"

if [ ! -f "$ENC" ]; then
  echo "Encrypted dump not found." >&2
  exit 1
fi
if [ -z "$AGE_IDENTITY_FILE" ] || [ ! -f "$AGE_IDENTITY_FILE" ]; then
  echo "Set AGE_IDENTITY_FILE to the age identity for this restore. Remove it when you are done." >&2
  exit 1
fi

PLAIN="$(mktemp)"
LIST="$(mktemp)"
trap 'rm -f "$PLAIN" "$LIST"' EXIT
age -d -i "$AGE_IDENTITY_FILE" -o "$PLAIN" "$ENC"

# List before any drop or write. A bad archive stops here.
if [ "$BACKUP_MODE" = "docker" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    pg_restore --list > "$LIST" < "$PLAIN"
elif [ "$BACKUP_MODE" = "pg_restore" ]; then
  pg_restore --list "$PLAIN" > "$LIST"
else
  echo "BACKUP_MODE must be docker or pg_restore." >&2
  exit 1
fi
if ! grep -Eq '^[0-9]+;' "$LIST"; then
  echo "The decrypted dump has nothing to restore." >&2
  exit 1
fi

PUBLIC_RELATIONS="select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p','v','m','S','f')"

relation_count() {
  if [ "$BACKUP_MODE" = "docker" ]; then
    printf '%s\n' "$PUBLIC_RELATIONS" | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
      sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -v ON_ERROR_STOP=1 -f -'
  else
    if [ -z "${DATABASE_URL:-}" ]; then
      echo "BACKUP_MODE=pg_restore needs DATABASE_URL so the restore can see whether the database is empty." >&2
      exit 1
    fi
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "$PUBLIC_RELATIONS"
  fi
}

if [ "$OVERWRITE" -eq 1 ]; then
  if [ "$BACKUP_MODE" = "docker" ]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
      sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" dropdb -U "$POSTGRES_USER" --force --if-exists "$POSTGRES_DB"'
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
      sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
  else
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
  fi
else
  count="$(relation_count | tr -d '[:space:]')"
  if [ "$count" != "0" ]; then
    echo "Refusing to restore into a database that is not empty. Pass --overwrite to drop it first." >&2
    exit 1
  fi
fi

if [ "$BACKUP_MODE" = "docker" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < "$PLAIN"
else
  pg_restore --no-owner --exit-on-error --dbname="$DATABASE_URL" < "$PLAIN"
fi

rm -f "$PLAIN" "$LIST"
echo "Restored $(basename "$ENC")"
