#!/bin/sh
# CI-only: install apt packages without letting a stalled mirror hang the job.
# Attempt 1 uses the runner's default mirror. Attempts 2 and 3 switch every
# source to archive.ubuntu.com (deb822 ubuntu.sources and sources.list).
# Each apt call is capped at 100s. Downloaded .debs go to $APT_CACHE_DIR so
# actions/cache can keep them between runs.
set -u
CACHE="${APT_CACHE_DIR:-$HOME/apt-cache}"
mkdir -p "$CACHE/partial"
OPTS="-o Acquire::Retries=3 -o Acquire::http::Timeout=20 -o Dir::Cache::Archives=$CACHE"

use_archive_mirror() {
  echo "Switching apt sources to archive.ubuntu.com"
  for f in /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list; do
    [ -f "$f" ] || continue
    sudo sed -i -E \
      -e 's#https?://[a-z0-9.-]*(azure\.archive|archive|security)\.ubuntu\.com/ubuntu/?#http://archive.ubuntu.com/ubuntu/#g' \
      -e 's#^(URIs:[[:space:]]*)(mirror\+)?file:/etc/apt/apt-mirrors\.txt#\1http://archive.ubuntu.com/ubuntu/#' \
      -e 's#^(deb(-src)?([[:space:]]+\[[^]]*\])?[[:space:]]+)mirror\+file:/etc/apt/apt-mirrors\.txt#\1http://archive.ubuntu.com/ubuntu/#' \
      "$f"
  done
}

for attempt in 1 2 3; do
  if [ "$attempt" -gt 1 ]; then
    use_archive_mirror
  fi
  # shellcheck disable=SC2086
  if timeout 100 sudo apt-get $OPTS update \
    && timeout 100 sudo apt-get $OPTS install -y "$@"; then
    sudo chown -R "$(id -u):$(id -g)" "$CACHE"
    exit 0
  fi
  echo "apt attempt $attempt failed; retrying"
  sleep 5
done
exit 1
