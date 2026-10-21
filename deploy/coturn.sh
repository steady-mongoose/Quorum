#!/bin/sh
# TURN for room calls. The calls compose profile runs this. docker compose up does not.
# The process relays UDP between browsers. It keeps no copy of the packets.
set -eu

secret=${CALLS_TURN_SECRET:-}
case "$secret" in
  *[!A-Za-z0-9]*)
    echo "CALLS_TURN_SECRET must be letters and digits." >&2
    exit 1
    ;;
esac
if [ "${#secret}" -lt 32 ] || [ "${#secret}" -gt 128 ]; then
  echo "Set CALLS_TURN_SECRET to 32 or more letters and digits before starting the calls profile." >&2
  exit 1
fi

public=${CALLS_TURN_EXTERNAL_IP:-}
case "$public" in
  "" | *[!0-9A-Fa-f:.]*)
    echo "Set CALLS_TURN_EXTERNAL_IP to this box's public address." >&2
    exit 1
    ;;
esac

realm=${CALLS_TURN_REALM:-avouchsocial.com}
case "$realm" in
  *[!A-Za-z0-9.-]*)
    echo "CALLS_TURN_REALM is not a hostname." >&2
    exit 1
    ;;
esac

private=""
if command -v hostname >/dev/null 2>&1; then
  private=$(hostname -i 2>/dev/null | awk '{print $1}') || private=""
fi
case "$private" in
  *[!0-9A-Fa-f:.]*) private="" ;;
esac

external="$public"
if [ -n "$private" ] && [ "$private" != "$public" ]; then
  external="${public}/${private}"
fi

umask 077
cat > /tmp/turnserver.conf <<EOF
listening-port=3478
listening-ip=0.0.0.0
fingerprint
use-auth-secret
static-auth-secret=${secret}
realm=${realm}
server-name=${realm}
external-ip=${external}
min-port=49160
max-port=49260
no-cli
no-loopback-peers
no-multicast-peers
stale-nonce=600
max-bps=100000
bps-capacity=2500000
user-quota=8
total-quota=40
log-file=stdout
no-software-attribute
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.0.2.0-192.0.2.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=198.51.100.0-198.51.100.255
denied-peer-ip=203.0.113.0-203.0.113.255
denied-peer-ip=240.0.0.0-255.255.255.255
denied-peer-ip=${public}
denied-peer-ip=fc00::/7
denied-peer-ip=fe80::/10
denied-peer-ip=::ffff:0:0/96
EOF

exec turnserver -c /tmp/turnserver.conf --prod
