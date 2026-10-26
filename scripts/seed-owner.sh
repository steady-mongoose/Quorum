#!/bin/sh
# Seat Josh once.
#
# The API container is already running, so lines added to deploy/.env after
# `up` are not in its environment. The three BOOTSTRAP_* values come from the
# caller, or from a prompt (the password is not echoed). They are passed with
# `exec -e` and are not written into deploy/.env. This script never edits
# that file.
#
# If a password was already left in the file, the seed clears that one line
# (the API mounts deploy/.env). This script recreates the API only after that
# line is gone. If the password is still there, it does not recreate the API
# and exits non-zero. A clean run leaves the file and the API alone. A second
# run that finds Josh already seated exits 0.
#
# COMPOSE_FILE may name several compose files, separated by
# COMPOSE_PATH_SEPARATOR (a colon, unless that variable is set).
# COMPOSE_PROFILES is passed through as `--profile`.
set -eu
# pipefail is not POSIX. A shell that rejects it can abort this process, so
# the probe runs in a subshell. When that succeeds, pipefail is turned on.
if (set -o pipefail) 2>/dev/null; then
  set -o pipefail
fi

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/.env}"

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
seed_log=
cleanup() {
  restore_echo
  if [ -n "$seed_log" ]; then
    rm -f "$seed_log"
  fi
}
trap cleanup EXIT
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

# 0 when deploy/.env holds a non-empty BOOTSTRAP_OWNER_PASSWORD. The value
# is not printed.
password_left() {
  [ -f "$ENV_FILE" ] || return 1
  awk '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*BOOTSTRAP_OWNER_PASSWORD=/ {
      value = substr($0, index($0, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      q = "\047"
      if (length(value) >= 2 && substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"")
        value = substr(value, 2, length(value) - 2)
      else if (length(value) >= 2 && substr(value, 1, 1) == q && substr(value, length(value), 1) == q)
        value = substr(value, 2, length(value) - 2)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if (value != "") found = 1
    }
    END { exit found ? 0 : 1 }
  ' "$ENV_FILE"
}

# docker compose, with every compose file and every profile the operator set.
# COMPOSE_FILE is expanded here and unset for the child so it is not applied twice.
run_compose() {
  sep="${COMPOSE_PATH_SEPARATOR:-:}"
  files="${COMPOSE_FILE:-$ROOT/deploy/docker-compose.yml}"
  profiles="${COMPOSE_PROFILES:-}"
  _list=$(mktemp)
  for _arg in "$@"; do
    printf '%s\n' "$_arg" >> "$_list"
  done
  set -- --env-file "$ENV_FILE"
  _rest=$files
  while [ -n "$_rest" ]; do
    _file=${_rest%%"$sep"*}
    if [ "$_file" = "$_rest" ]; then
      _rest=
    else
      _rest=${_rest#*"$sep"}
    fi
    if [ -n "$_file" ]; then
      set -- "$@" -f "$_file"
    fi
  done
  _rest=$profiles
  while [ -n "$_rest" ]; do
    _profile=${_rest%%,*}
    if [ "$_profile" = "$_rest" ]; then
      _rest=
    else
      _rest=${_rest#*,}
    fi
    _profile=${_profile#"${_profile%%[![:space:]]*}"}
    _profile=${_profile%"${_profile##*[![:space:]]}"}
    if [ -n "$_profile" ]; then
      set -- "$@" --profile "$_profile"
    fi
  done
  while IFS= read -r _arg || [ -n "$_arg" ]; do
    set -- "$@" "$_arg"
  done < "$_list"
  rm -f "$_list"
  env -u COMPOSE_FILE docker compose "$@"
}

fill BOOTSTRAP_OWNER text
fill BOOTSTRAP_OWNER_EMAIL text
fill BOOTSTRAP_OWNER_PASSWORD secret
export BOOTSTRAP_OWNER BOOTSTRAP_OWNER_EMAIL BOOTSTRAP_OWNER_PASSWORD

# Read before the seed. The seed may clear the mounted file; this script does not.
leftover=0
if password_left; then
  leftover=1
fi

# `-e NAME` with no value takes the caller's environment. The password is
# not placed on the command line, and deploy/.env is not the source.
seed_log=$(mktemp)
set +e
run_compose exec -T \
  -e BOOTSTRAP_OWNER \
  -e BOOTSTRAP_OWNER_EMAIL \
  -e BOOTSTRAP_OWNER_PASSWORD \
  api npm run seed:owner >"$seed_log" 2>&1
seed_status=$?
set -e
cat "$seed_log"

already=0
if grep -q "already seated" "$seed_log"; then
  already=1
fi

# Recreate only when the leftover password is actually gone. Recreating while
# it is still in the mounted file would load it back into the API process.
if [ "$leftover" -eq 1 ] && password_left; then
  echo "Could not clear the leftover BOOTSTRAP_OWNER_PASSWORD in $ENV_FILE. The API was not recreated." >&2
  exit 1
fi

if [ "$leftover" -eq 1 ]; then
  run_compose up -d --force-recreate --no-deps api
fi

if [ "$already" -eq 1 ]; then
  echo "Josh is already seated."
  exit 0
fi

if [ "$seed_status" -ne 0 ]; then
  exit "$seed_status"
fi

if [ "$leftover" -eq 1 ]; then
  echo "Josh is seated. A leftover BOOTSTRAP_OWNER_PASSWORD was in $ENV_FILE, so the API was recreated."
else
  echo "Josh is seated."
fi
