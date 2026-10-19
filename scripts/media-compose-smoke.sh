#!/bin/sh
# Prove the media profile on a real Docker engine.
# Starts Postgres, applies the owner-approved SQL in this test database only,
# then runs `docker compose --profile media up` and processes one picture and
# one video through the sandbox. Removes the project on the way out.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to prove the media sandbox." >&2
  exit 1
fi

COMPOSE_FILE="$ROOT/deploy/docker-compose.yml"
ENV_FILE="$ROOT/deploy/.env"
PROJECT="${COMPOSE_PROJECT_NAME:-avouchmedia}"
export COMPOSE_PROJECT_NAME="$PROJECT"

backup=""
if [ -f "$ENV_FILE" ]; then
  backup="$(mktemp)"
  cp "$ENV_FILE" "$backup"
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    compose --profile media --profile media-test logs --no-color || true
  fi
  compose --profile media --profile media-test down -v --remove-orphans >/dev/null 2>&1 || true
  if [ -n "$backup" ]; then
    mv "$backup" "$ENV_FILE"
  else
    rm -f "$ENV_FILE"
  fi
  exit "$status"
}
trap cleanup EXIT

cat > "$ENV_FILE" <<'EOF'
POSTGRES_USER=avouch
POSTGRES_PASSWORD=postgrespass
POSTGRES_DB=avouch
BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef
BETTER_AUTH_URL=http://127.0.0.1:8787
WEB_ORIGINS=https://avouchsocial.com
API_HOST=api.avouchsocial.com
ACME_EMAIL=ci@example.com
HTTP_PORT=18080
HTTPS_PORT=18443
MEDIA_WORKER_DB_PASSWORD=mediaworkerpass1
MEDIA_S3_ENDPOINT=http://storage.test:9000
MEDIA_S3_HOST=storage.test
MEDIA_S3_PORT=9000
MEDIA_S3_BUCKET=avouch-media
MEDIA_S3_REGION=us-east-1
MEDIA_S3_ACCESS_KEY_ID=testaccesskey
MEDIA_S3_SECRET_ACCESS_KEY=testsecretkey
MEDIA_S3_FORCE_PATH_STYLE=true
MEDIA_VIDEO=on
EGRESS_ALLOW_HOST=storage-sink
EGRESS_ALLOW_PORT=9000
EOF

compose up -d --wait postgres
compose --profile migrate run --build --rm migrate
# The media profile. The test sink is a second profile so production does not start it.
# Caddy is left out of this wait: it would ask Let's Encrypt for a certificate.
compose --profile media --profile media-test up -d --build --wait --wait-timeout 240 \
  postgres media-sandbox media-proxy storage-sink media-worker

compose exec -T media-sandbox ffmpeg -y -f lavfi -i color=c=red:s=64x64:d=1 -frames:v 1 -update 1 /work/samples/in.png
compose exec -T media-sandbox ffmpeg -y \
  -f lavfi -i color=c=black:s=64x64:d=1 \
  -f lavfi -i anullsrc=r=44100:cl=mono \
  -shortest -t 1 -c:v libx264 -pix_fmt yuv420p -c:a aac \
  /work/samples/in.mp4

compose exec -T media-worker node -e 'if (process.env.POSTGRES_PASSWORD || process.env.BETTER_AUTH_SECRET) process.exit(1)'
compose exec -T media-sandbox node -e 'if (process.env.DATABASE_URL || process.env.MEDIA_S3_SECRET_ACCESS_KEY) process.exit(1)'

compose exec -T -e PGPASSWORD=mediaworkerpass1 postgres \
  psql -U media_worker -d avouch -c 'select count(*) from media_object'
if compose exec -T -e PGPASSWORD=mediaworkerpass1 postgres \
  psql -U media_worker -d avouch -c 'select count(*) from "user"'; then
  echo "The media worker role can read accounts." >&2
  exit 1
fi

compose exec -T media-worker node --experimental-strip-types server/media-sandbox-smoke.ts
echo "Media sandbox processed a picture and a video."
