#!/bin/sh
# Seat Josh once.
#
# The API container is already running, so lines added to deploy/.env after
# `up` are not in its environment and the seed would exit without seating
# anyone. The three BOOTSTRAP_* values come from the caller, or from a
# prompt (the password is not echoed). They are passed with `exec -e` and
# are not written into deploy/.env. A leftover password line is blanked
# afterwards and the API is recreated so it is not left in the process.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/docker-compose.yml}"

STTY_OFF=
restore_echo() {
  if [ -n "$STTY_OFF" ]; then
    stty echo || true
    STTY_OFF=
  fi
}
trap restore_echo EXIT INT TERM

# Prints the value. Asks on a terminal when the variable is empty.
# A missing value with no terminal is an error, so the script never reads
# the password back out of deploy/.env.
ask() {
  label="$1"
  secret="$2"
  if [ ! -t 0 ]; then
    echo "Set ${label} in the environment. The seed does not read it from deploy/.env." >&2
    exit 1
  fi
  if [ "$secret" = secret ]; then
    stty -echo
    STTY_OFF=1
  fi
  printf '%s: ' "$label" >&2
  if ! IFS= read -r value; then
    restore_echo
    echo "Set ${label}." >&2
    exit 1
  fi
  if [ "$secret" = secret ]; then
    restore_echo
    printf '\n' >&2
  fi
  if [ -z "$value" ]; then
    echo "Set ${label}." >&2
    exit 1
  fi
  printf '%s' "$value"
}

if [ -z "${BOOTSTRAP_OWNER:-}" ]; then
  BOOTSTRAP_OWNER="$(ask BOOTSTRAP_OWNER text)"
fi
if [ -z "${BOOTSTRAP_OWNER_EMAIL:-}" ]; then
  BOOTSTRAP_OWNER_EMAIL="$(ask BOOTSTRAP_OWNER_EMAIL text)"
fi
if [ -z "${BOOTSTRAP_OWNER_PASSWORD:-}" ]; then
  BOOTSTRAP_OWNER_PASSWORD="$(ask BOOTSTRAP_OWNER_PASSWORD secret)"
fi
export BOOTSTRAP_OWNER BOOTSTRAP_OWNER_EMAIL BOOTSTRAP_OWNER_PASSWORD

# `-e NAME` with no value takes the caller's environment. The password is
# not placed on the command line, and deploy/.env is not the source.
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T \
  -e BOOTSTRAP_OWNER \
  -e BOOTSTRAP_OWNER_EMAIL \
  -e BOOTSTRAP_OWNER_PASSWORD \
  api npm run seed:owner
node --experimental-strip-types "$ROOT/server/env-file.ts" "$ENV_FILE"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate --no-deps api
echo "Josh is seated. A leftover BOOTSTRAP_OWNER_PASSWORD in $ENV_FILE was cleared, and the API was recreated."
