# Dedicated box for api.avouchsocial.com

This is the closed-test API: Better Auth, invite codes, and Postgres on one OVH VPS. The static site stays where it already is. Cloudflare is DNS only for `api.avouchsocial.com` (grey cloud, not proxied). Do not order the VPS from this repository's automation, and do not run the migrate profile until the owner has approved the SQL.

## What to order

**VPS-2, 2027 range, datacenter in US East (Vint Hill, Virginia).** Not a Local Zone: OVH's own VPS page says Local Zone images do not include Docker, and this recipe uses Docker Compose.

|                       |                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Plan                  | VPS-2 (2027 range)                                                                                                            |
| vCores                | 4                                                                                                                             |
| RAM                   | 8 GB                                                                                                                          |
| Disk                  | 75 GB SSD NVMe                                                                                                                |
| Region                | US East, Vint Hill, Virginia (`US-EAST-VA` in the order API). The location list calls it Washington DC (Vint Hill, Virginia). |
| Price on the VPS page | Starting at $8.50 /month                                                                                                      |

Sources: [VPS plans](https://us.ovhcloud.com/vps/) and [infrastructure locations](https://us.ovhcloud.com/about/global-infrastructure/locations/). The order funnel also asks for a renewal frequency, so read the figure on that screen before paying. The "Starting at" price is the number printed on the plan card.

VPS-2 is inside the charter's $5 to $20 closed-test band. 8 GB is enough for Postgres, the API, and Caddy for 5 to 20 people. VPS-1's 4 GB is tight once dumps sit on the same disk. VPS-4 is the card nearest $20 and is more machine than this test needs.

Image: Ubuntu 24.04. Do not add Plesk or cPanel.

## Why Docker Compose

One file runs Postgres, the API, and Caddy, with versions pinned. Postgres has no published port, so the database is only on the compose network. Caddy gets the certificate for `api.avouchsocial.com` from Let's Encrypt. Migrations are a separate compose profile that `docker compose up` does not start.

A systemd unit per process would also fit a single box. Compose is the smaller thing to read, and the backup script shells into the Postgres container.

## One-time steps for the owner

1. Approve `migrations/0001_auth.sql` and `migrations/0002_closed_test.sql` in the pull request. Merging is not that approval. Do not apply them before you say so.
2. Order the VPS above. Do not use AWS, Google, Azure, or Apple.
3. Point `api.avouchsocial.com` at the VPS with an A (and AAAA, if you have one) record. In Cloudflare, set the record to DNS only. Do not proxy it.
4. SSH in with a key. On the host:

   ```bash
   sudo apt-get update
   sudo apt-get install -y ca-certificates curl
   # Docker's own apt repository, from docs.docker.com. Then:
   sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
   sudo ufw default deny incoming
   sudo ufw default allow outgoing
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```

   Docker can bypass ufw for published ports. This compose file publishes only 80 and 443. It does not publish 5432 or 8787.

5. Clone the repo to `/opt/avouch` and check out the approved commit. Copy `deploy/env.example` to `deploy/.env` and fill it in. `POSTGRES_PASSWORD` should be letters and digits. `BETTER_AUTH_SECRET` is `openssl rand -hex 32`. `ACME_EMAIL` is the address Let's Encrypt can use.
6. Start the stack, still without migrations:

   ```bash
   cd /opt/avouch
   docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
   ```

   The API health check stays failed until the tables exist. Caddy can still start. That is expected.

7. After the SQL is approved, apply it once:

   ```bash
   docker compose --env-file deploy/.env -f deploy/docker-compose.yml --profile migrate run --rm migrate
   ```

   The command is safe to repeat. Each file runs once and is recorded in `_migrations`.

8. Seat Josh once:

   ```bash
   docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec api npm run seed:owner
   ```

   `BOOTSTRAP_OWNER` must be `Josh`, `1`, or `true`. Set `BOOTSTRAP_OWNER_EMAIL` and `BOOTSTRAP_OWNER_PASSWORD` in `deploy/.env` first. A second run prints that the founding admin is already seated and exits 1.

9. Check health:

   ```bash
   curl -fsS https://api.avouchsocial.com/api/health
   ```

   Expect `{"ok":true}`.

10. Build the static site with `VITE_API_BASE_URL=https://api.avouchsocial.com` (no trailing slash). Until that variable is set, or when the API does not answer, the site stays in demo mode.

## Nightly backup

On the host:

```bash
sudo mkdir -p /var/backups/avouch
sudo chmod 700 /var/backups/avouch
sudo crontab -e
```

```
15 3 * * * cd /opt/avouch && BACKUP_DIR=/var/backups/avouch BACKUP_RETENTION_DAYS=14 ./scripts/backup-postgres.sh >> /var/log/avouch-backup.log 2>&1
```

The script runs `pg_dump` inside the Postgres container and keeps 14 days of dumps on the VPS disk. It does not upload them. OVH's included disk backup is a separate copy of the whole machine; the dump is the one you can restore into a new Postgres. Copy a dump onto a disk you hold if you want a copy that is not on this VPS. Do not send it to AWS, Google, Azure, or Apple.

Restore steps are in the header of `scripts/backup-postgres.sh`. Stop the API, restore into the database, start the API, then curl `/api/health`.

## What this box does not do

It does not serve the static site. It does not run a feed, likes, reshares, or scores. Signup without an invite code is refused. The interface strings are English.
