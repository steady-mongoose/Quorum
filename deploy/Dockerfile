FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY migrations ./migrations
COPY scripts/migrate.mjs scripts/migration-plan.mjs ./scripts/

ENV NODE_ENV=production
USER node
EXPOSE 8787

# Migrations are not applied here. The owner runs the compose "migrate" profile
# after approving the SQL files.
CMD ["node", "--experimental-strip-types", "server/host.ts"]
