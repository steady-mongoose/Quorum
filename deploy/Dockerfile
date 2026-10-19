FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY migrations ./migrations
COPY src/lib/media ./src/lib/media
COPY scripts/migrate.mjs scripts/migration-plan.mjs ./scripts/

ENV NODE_ENV=production
USER node
EXPOSE 8787

# Migrations are not applied here. The owner runs the compose "migrate" profile
# after approving the SQL files.
CMD ["node", "--experimental-strip-types", "server/host.ts"]
