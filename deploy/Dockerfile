FROM node:22-bookworm-slim AS app

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /work/queue /work/jobs /work/samples \
  && chown -R node:node /work

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

FROM app AS media
# ffmpeg lives only in this image. The API and the worker do not have it.
# Bookworm security, 5.1.9. The epoch is part of the apt version.
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg=7:5.1.9-0+deb12u1 \
    util-linux \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*
USER node
