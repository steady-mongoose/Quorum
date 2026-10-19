#!/bin/sh
# Restore one encrypted Avouch dump.
#
#   ./scripts/restore-postgres.sh /var/backups/avouch/avouch-STAMP.dump.enc
#
# Stop the API first. This replaces the accounts, invite log, and founding
# seat with the dump. It does not change the static site. The passphrase is
# read from BACKUP_KEY_FILE and is not printed.
#
#   docker compose --env-file deploy/.env -f deploy/docker-compose.yml stop api
#   BACKUP_KEY_FILE=/etc/avouch/backup.key ./scripts/restore-postgres.sh /path/to/avouch-STAMP.dump.enc
#   docker compose --env-file deploy/.env -f deploy/docker-compose.yml start api
#   curl -fsS https://api.avouchsocial.com/api/health
#
# BACKUP_MODE=docker (default) restores into the compose Postgres.
# BACKUP_MODE=pg_restore shells out to pg_restore on PATH, which tests use.
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: restore-postgres.sh <avouch-STAMP.dump.enc>" >&2
  exit 1
fi

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
ENC="$1"
BACKUP_MODE="${BACKUP_MODE:-docker}"
BACKUP_KEY_FILE="${BACKUP_KEY_FILE:-}"
POSTGRES_USER="${POSTGRES_USER:-avouch}"
POSTGRES_DB="${POSTGRES_DB:-avouch}"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/docker-compose.yml}"

if [ ! -f "$ENC" ]; then
  echo "Encrypted dump not found." >&2
  exit 1
fi
if [ -z "$BACKUP_KEY_FILE" ] || [ ! -f "$BACKUP_KEY_FILE" ]; then
  echo "Set BACKUP_KEY_FILE to the passphrase file that encrypted this dump." >&2
  exit 1
fi

PLAIN="$(mktemp)"
trap 'rm -f "$PLAIN"' EXIT
gpg --batch --yes --pinentry-mode loopback \
  --passphrase-file "$BACKUP_KEY_FILE" \
  --decrypt --output "$PLAIN" "$ENC"

if [ "$BACKUP_MODE" = "docker" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    dropdb -U "$POSTGRES_USER" --force --if-exists "$POSTGRES_DB"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error < "$PLAIN"
elif [ "$BACKUP_MODE" = "pg_restore" ]; then
  pg_restore --no-owner --exit-on-error < "$PLAIN"
else
  echo "BACKUP_MODE must be docker or pg_restore." >&2
  exit 1
fi

rm -f "$PLAIN"
echo "Restored $(basename "$ENC")"
