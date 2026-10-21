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
on_interrupt() {
  restore_echo
  exit 130
}
# The prompt runs in this shell, not a $(...) subshell, so this trap can
# turn echo back on if the operator hits Ctrl-C while the password is hidden.
trap restore_echo EXIT
trap on_interrupt INT TERM

# Sets one BOOTSTRAP_* variable. Called directly so stty and the trap stay
# in this process.
fill() {
  name="$1"
  secret="$2"
  case "$name" in
    BOOTSTRAP_OWNER) current="${BOOTSTRAP_OWNER:-}" ;;
    BOOTSTRAP_OWNER_EMAIL) current="${BOOTSTRAP_OWNER_EMAIL:-}" ;;
    BOOTSTRAP_OWNER_PASSWORD) current="${BOOTSTRAP_OWNER_PASSWORD:-}" ;;
    *)
      echo "Unknown seed variable." >&2
      exit 1
      ;;
  esac
  if [ -n "$current" ]; then
    return 0
  fi
  if [ ! -t 0 ]; then
    echo "Set ${name} in the environment. The seed does not read it from deploy/.env." >&2
    exit 1
  fi
  if [ "$secret" = secret ]; then
    stty -echo
    STTY_OFF=1
  fi
  printf '%s: ' "$name" >&2
  if ! IFS= read -r value; then
    restore_echo
    echo "Set ${name}." >&2
    exit 1
  fi
  if [ "$secret" = secret ]; then
    restore_echo
    printf '\n' >&2
  fi
  if [ -z "$value" ]; then
    echo "Set ${name}." >&2
    exit 1
  fi
  case "$name" in
    BOOTSTRAP_OWNER) BOOTSTRAP_OWNER="$value" ;;
    BOOTSTRAP_OWNER_EMAIL) BOOTSTRAP_OWNER_EMAIL="$value" ;;
    BOOTSTRAP_OWNER_PASSWORD) BOOTSTRAP_OWNER_PASSWORD="$value" ;;
  esac
}

fill BOOTSTRAP_OWNER text
fill BOOTSTRAP_OWNER_EMAIL text
fill BOOTSTRAP_OWNER_PASSWORD secret
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
