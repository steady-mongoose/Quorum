#!/bin/sh
# Nightly logical backup of the Avouch Social Postgres database.
#
# Dumps the database, encrypts it with gpg (AES256, a local key file), and
# copies the ciphertext to BACKUP_OFFBOX_DIR. The plaintext dump is removed.
# Dumps older than BACKUP_RETENTION_DAYS (default 14) are deleted in both places.
#
# BACKUP_OFFBOX_DIR is a directory on another disk or machine. A value with a
# colon is copied with scp (for example backup@192.0.2.10:/var/backups/avouch).
# A local path on the same device as BACKUP_DIR is refused, so the copy is not
# another folder on the database disk. No paid storage service is used.
#
# Restore with scripts/restore-postgres.sh. See deploy/README.md.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/avouch}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_MODE="${BACKUP_MODE:-docker}"
BACKUP_KEY_FILE="${BACKUP_KEY_FILE:-}"
BACKUP_OFFBOX_DIR="${BACKUP_OFFBOX_DIR:-}"
POSTGRES_USER="${POSTGRES_USER:-avouch}"
POSTGRES_DB="${POSTGRES_DB:-avouch}"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/docker-compose.yml}"

if [ -z "$BACKUP_KEY_FILE" ] || [ ! -f "$BACKUP_KEY_FILE" ]; then
  echo "Set BACKUP_KEY_FILE to a passphrase file on this machine." >&2
  exit 1
fi
if [ -z "$BACKUP_OFFBOX_DIR" ]; then
  echo "Set BACKUP_OFFBOX_DIR to a directory off this database disk." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PLAIN="$BACKUP_DIR/avouch-$STAMP.dump.partial"
OUT="$BACKUP_DIR/avouch-$STAMP.dump.enc"
trap 'rm -f "$PLAIN"' EXIT

if [ "$BACKUP_MODE" = "docker" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner > "$PLAIN"
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

gpg --batch --yes --pinentry-mode loopback \
  --passphrase-file "$BACKUP_KEY_FILE" \
  --symmetric --cipher-algo AES256 \
  --output "$OUT" "$PLAIN"
rm -f "$PLAIN"
chmod 600 "$OUT"

case "$BACKUP_OFFBOX_DIR" in
  *:*)
    scp -o BatchMode=yes "$OUT" "$BACKUP_OFFBOX_DIR/"
    ;;
  *)
    mkdir -p "$BACKUP_OFFBOX_DIR"
    chmod 700 "$BACKUP_OFFBOX_DIR"
    if [ "${BACKUP_ALLOW_SAME_DEVICE:-}" != "1" ]; then
      local_dev="$(stat -c %d "$BACKUP_DIR")"
      off_dev="$(stat -c %d "$BACKUP_OFFBOX_DIR")"
      if [ "$local_dev" = "$off_dev" ]; then
        echo "BACKUP_OFFBOX_DIR is on the same disk as $BACKUP_DIR. Point it at another disk or an scp target." >&2
        exit 1
      fi
    fi
    cp "$OUT" "$BACKUP_OFFBOX_DIR/"
    chmod 600 "$BACKUP_OFFBOX_DIR/$(basename "$OUT")"
    ;;
esac

node "$ROOT/scripts/prune-backups.mjs" "$BACKUP_DIR" "$BACKUP_RETENTION_DAYS"
case "$BACKUP_OFFBOX_DIR" in
  *:*) ;;
  *) node "$ROOT/scripts/prune-backups.mjs" "$BACKUP_OFFBOX_DIR" "$BACKUP_RETENTION_DAYS" ;;
esac
echo "Wrote $OUT"
