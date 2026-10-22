#!/usr/bin/env bash
# Restore the newest age-encrypted Avouch dump from Backblaze B2 onto this host.
#
# Uses the same names as scripts/backup-postgres.sh:
#   BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY_ID,
#   BACKUP_S3_SECRET_ACCESS_KEY, BACKUP_S3_REGION (default auto),
#   BACKUP_MODE (docker or pg_restore), POSTGRES_USER, POSTGRES_DB,
#   ENV_FILE, COMPOSE_FILE, DATABASE_URL, and AGE_IDENTITY_FILE.
#
# The bucket is B2's S3-compatible API. Leave the four credential values
# blank and this script will not guess a bucket. It does not delete remote
# objects and it does not print the secret or the identity.
#
#   AGE_IDENTITY_FILE=/tmp/avouch-backup-identity.txt ./scripts/restore-from-backup.sh
#
# A database that already has objects is refused. Pass --overwrite only when
# you mean to drop it. The dump is listed with pg_restore --list before that.
#
#   AGE_IDENTITY_FILE=/tmp/avouch-backup-identity.txt ./scripts/restore-from-backup.sh --overwrite
#
# A dry run does not contact the bucket. It restores RESTORE_DUMP into a
# throwaway database (the name "test", or a name ending in _test):
#
#   RESTORE_DRY_RUN=1 RESTORE_DUMP=/tmp/avouch-test.dump.age \
#     AGE_IDENTITY_FILE=/tmp/identity.txt BACKUP_MODE=pg_restore \
#     DATABASE_URL=postgres://avouch:secret@127.0.0.1:5432/avouch_restore_test \
#     ./scripts/restore-from-backup.sh
#
# Copy the age identity onto the box only for this command, then delete it.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
WORKDIR=""
OVERWRITE=0

on_exit() {
  status="$?"
  if [ -n "$WORKDIR" ]; then
    rm -rf "$WORKDIR"
  fi
  exit "$status"
}
trap on_exit EXIT

while [ "$#" -gt 0 ]; do
  case "$1" in
    --overwrite) OVERWRITE=1 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

BACKUP_MODE="${BACKUP_MODE:-docker}"
POSTGRES_DB="${POSTGRES_DB:-avouch}"
AGE_IDENTITY_FILE="${AGE_IDENTITY_FILE:-}"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/docker-compose.yml}"

if [ -z "$AGE_IDENTITY_FILE" ] || [ ! -f "$AGE_IDENTITY_FILE" ]; then
  echo "Set AGE_IDENTITY_FILE to the age identity for this restore. Remove it when you are done." >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"

throwaway_name() {
  case "$1" in
    test | TEST | *_test | *_TEST) return 0 ;;
    *) return 1 ;;
  esac
}

require_throwaway() {
  if [ "$BACKUP_MODE" = "pg_restore" ]; then
    if [ -z "${DATABASE_URL:-}" ]; then
      echo "A dry run with BACKUP_MODE=pg_restore needs DATABASE_URL pointed at a throwaway database." >&2
      exit 1
    fi
    name="${DATABASE_URL##*/}"
    name="${name%%\?*}"
    if ! throwaway_name "$name"; then
      echo "A dry run refuses to restore into ${name}. Use a database named test or ending in _test." >&2
      exit 1
    fi
  elif [ "$BACKUP_MODE" = "docker" ]; then
    if ! throwaway_name "$POSTGRES_DB"; then
      echo "A dry run refuses to restore into POSTGRES_DB=${POSTGRES_DB}. Use a database named test or ending in _test." >&2
      exit 1
    fi
  else
    echo "BACKUP_MODE must be docker or pg_restore." >&2
    exit 1
  fi
}

fetch_latest() {
  bucket="${BACKUP_S3_BUCKET:-}"
  endpoint="${BACKUP_S3_ENDPOINT:-}"
  access="${BACKUP_S3_ACCESS_KEY_ID:-}"
  secret="${BACKUP_S3_SECRET_ACCESS_KEY:-}"
  filled=0
  if [ -n "$bucket" ]; then filled=$((filled + 1)); fi
  if [ -n "$endpoint" ]; then filled=$((filled + 1)); fi
  if [ -n "$access" ]; then filled=$((filled + 1)); fi
  if [ -n "$secret" ]; then filled=$((filled + 1)); fi
  if [ "$filled" -eq 0 ]; then
    echo "Set BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY_ID, and BACKUP_S3_SECRET_ACCESS_KEY, or pass RESTORE_DUMP with RESTORE_DRY_RUN=1." >&2
    exit 1
  fi
  if [ "$filled" -ne 4 ]; then
    echo "Set BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY_ID, and BACKUP_S3_SECRET_ACCESS_KEY together, or leave all four blank." >&2
    exit 1
  fi
  region="${BACKUP_S3_REGION:-auto}"
  export AWS_ACCESS_KEY_ID="$access"
  export AWS_SECRET_ACCESS_KEY="$secret"
  export AWS_EC2_METADATA_DISABLED=true
  export AWS_PAGER=""
  list="$WORKDIR/keys.txt"
  lines="$WORKDIR/keys.lines"
  aws s3api list-objects-v2 \
    --endpoint-url "$endpoint" \
    --region "$region" \
    --bucket "$bucket" \
    --prefix "avouch/" \
    --query "Contents[].Key" \
    --output text > "$list"
  # tr is outside the grep pipeline so a failure there is not hidden by grep's
  # "no match" status.
  tr '\t' '\n' < "$list" > "$lines"
  key="$(grep -E '^avouch/avouch-[0-9]{8}T[0-9]{6}Z\.dump\.age$' "$lines" | sort | tail -n 1 || true)"
  if [ -z "$key" ]; then
    echo "No age-encrypted Avouch dump in the bucket." >&2
    exit 1
  fi
  out="$WORKDIR/$(basename "$key")"
  aws s3api get-object \
    --endpoint-url "$endpoint" \
    --region "$region" \
    --bucket "$bucket" \
    --key "$key" \
    "$out" > /dev/null
  printf '%s\n' "$out"
}

if [ "${RESTORE_DRY_RUN:-}" = "1" ]; then
  if [ -z "${RESTORE_DUMP:-}" ] || [ ! -f "$RESTORE_DUMP" ]; then
    echo "A dry run needs RESTORE_DUMP set to a local age-encrypted dump." >&2
    exit 1
  fi
  require_throwaway
  ENC="$RESTORE_DUMP"
else
  ENC="$(fetch_latest)"
fi

export BACKUP_MODE POSTGRES_DB ENV_FILE COMPOSE_FILE AGE_IDENTITY_FILE
if [ "$OVERWRITE" -eq 1 ]; then
  "$ROOT/scripts/restore-postgres.sh" --overwrite "$ENC"
else
  "$ROOT/scripts/restore-postgres.sh" "$ENC"
fi
