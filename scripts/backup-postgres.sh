#!/bin/sh
# Nightly logical backup of the Avouch Social Postgres database.
#
# Dumps the database and encrypts it with age to a public-key recipient.
# The private identity is not on this machine and is not read here.
# The plaintext dump is removed. Local ciphertext older than
# BACKUP_RETENTION_DAYS (default 14) is deleted.
#
# Off-site copy goes to S3-compatible storage when BACKUP_S3_BUCKET,
# BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY_ID, and BACKUP_S3_SECRET_ACCESS_KEY
# are all set. Leave them blank until Josh approves a bucket. The script
# does not delete remote objects.
#
# Restore with scripts/restore-postgres.sh. See deploy/README.md.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/avouch}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_MODE="${BACKUP_MODE:-docker}"
BACKUP_AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
POSTGRES_USER="${POSTGRES_USER:-avouch}"
POSTGRES_DB="${POSTGRES_DB:-avouch}"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/docker-compose.yml}"

case "$BACKUP_AGE_RECIPIENT" in
  age1*) ;;
  *)
    echo "Set BACKUP_AGE_RECIPIENT to an age public key (age1...). Keep the private key off this machine." >&2
    exit 1
    ;;
esac
case "$BACKUP_AGE_RECIPIENT" in
  *SECRET*)
    echo "BACKUP_AGE_RECIPIENT must be a public key, not an identity." >&2
    exit 1
    ;;
esac

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PLAIN="$BACKUP_DIR/avouch-$STAMP.dump.partial"
OUT="$BACKUP_DIR/avouch-$STAMP.dump.age"
trap 'rm -f "$PLAIN"' EXIT

if [ "$BACKUP_MODE" = "docker" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' > "$PLAIN"
elif [ "$BACKUP_MODE" = "pg_dump" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "Set DATABASE_URL for BACKUP_MODE=pg_dump." >&2
    exit 1
  fi
  pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" > "$PLAIN"
else
  echo "BACKUP_MODE must be docker or pg_dump." >&2
  exit 1
fi

age -r "$BACKUP_AGE_RECIPIENT" -o "$OUT" "$PLAIN"
rm -f "$PLAIN"
chmod 600 "$OUT"

node "$ROOT/scripts/backup-offsite.mjs" "$OUT"
node "$ROOT/scripts/prune-backups.mjs" "$BACKUP_DIR" "$BACKUP_RETENTION_DAYS"
echo "Wrote $OUT"
