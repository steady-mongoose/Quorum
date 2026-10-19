#!/bin/sh
# Restore one age-encrypted Avouch dump.
#
#   ./scripts/restore-postgres.sh /var/backups/avouch/avouch-STAMP.dump.age
#
# Stop the API first. This replaces the accounts, invite log, and founding
# seat with the dump. It does not change the static site.
#
# AGE_IDENTITY_FILE is the age identity (AGE-SECRET-KEY-1...). Copy it onto
# the box only for this restore, then delete it. The nightly backup env keeps
# the public key only.
#
#   docker compose --env-file deploy/.env -f deploy/docker-compose.yml stop api
#   AGE_IDENTITY_FILE=/tmp/avouch-backup-identity.txt ./scripts/restore-postgres.sh /path/to/avouch-STAMP.dump.age
#   shred -u /tmp/avouch-backup-identity.txt 2>/dev/null || rm -f /tmp/avouch-backup-identity.txt
#   docker compose --env-file deploy/.env -f deploy/docker-compose.yml start api
#   curl -fsS https://api.avouchsocial.com/api/health
#
# To fetch a copy from the bucket Josh approved:
#   aws s3api get-object --endpoint-url "$BACKUP_S3_ENDPOINT" --region "${BACKUP_S3_REGION:-auto}" \
#     --bucket "$BACKUP_S3_BUCKET" --key "avouch/avouch-STAMP.dump.age" avouch-STAMP.dump.age
#
# BACKUP_MODE=docker (default) restores into the compose Postgres.
# BACKUP_MODE=pg_restore shells out to pg_restore on PATH, which tests use.
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: restore-postgres.sh <avouch-STAMP.dump.age>" >&2
  exit 1
fi

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
ENC="$1"
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
trap 'rm -f "$PLAIN"' EXIT
age -d -i "$AGE_IDENTITY_FILE" -o "$PLAIN" "$ENC"

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
