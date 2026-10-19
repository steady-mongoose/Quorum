#!/bin/sh
# Nightly logical backup of the Avouch Social Postgres database.
#
# Writes a custom-format pg_dump on this machine and deletes dumps older than
# BACKUP_RETENTION_DAYS (default 14). It does not upload the dump anywhere.
#
# Restore (stop the API first; do not run this against a database you have
# not copied aside):
#
#   docker compose --env-file deploy/.env -f deploy/docker-compose.yml stop api
#   docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T postgres \
#     dropdb -U avouch --force --if-exists avouch
#   docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T postgres \
#     createdb -U avouch avouch
#   docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T postgres \
#     pg_restore -U avouch -d avouch --no-owner --exit-on-error \
#     < /var/backups/avouch/avouch-STAMP.dump
#   docker compose --env-file deploy/.env -f deploy/docker-compose.yml start api
#   curl -fsS https://api.avouchsocial.com/api/health
#
# A restore replaces the accounts, invite log, and founding seat with the
# dump. It does not change the static site. See deploy/README.md.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/avouch}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_MODE="${BACKUP_MODE:-docker}"
POSTGRES_USER="${POSTGRES_USER:-avouch}"
POSTGRES_DB="${POSTGRES_DB:-avouch}"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/docker-compose.yml}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/avouch-$STAMP.dump"
TMP="$OUT.partial"
trap 'rm -f "$TMP"' EXIT

if [ "$BACKUP_MODE" = "docker" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner > "$TMP"
elif [ "$BACKUP_MODE" = "pg_dump" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "Set DATABASE_URL for BACKUP_MODE=pg_dump." >&2
    exit 1
  fi
  pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" > "$TMP"
else
  echo "BACKUP_MODE must be docker or pg_dump." >&2
  exit 1
fi

mv "$TMP" "$OUT"
chmod 600 "$OUT"
node "$ROOT/scripts/prune-backups.mjs" "$BACKUP_DIR" "$BACKUP_RETENTION_DAYS"
echo "Wrote $OUT"
