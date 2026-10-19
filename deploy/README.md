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
   sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin gnupg
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

8. Seat Josh once, from the host:

   ```bash
   ./scripts/seed-owner.sh
   ```

   `BOOTSTRAP_OWNER` must be `Josh`, `1`, or `true`. Set `BOOTSTRAP_OWNER_EMAIL` and `BOOTSTRAP_OWNER_PASSWORD` in `deploy/.env` first. A second run prints that the founding admin is already seated and exits 1. After a successful seat, the script clears `BOOTSTRAP_OWNER_PASSWORD` in `deploy/.env` and recreates the API process so the password is not left in memory. Two seed processes at once can race; run it once. The `bootstrap_seat` row still refuses a second founding account.

9. Check health:

   ```bash
   curl -fsS https://api.avouchsocial.com/api/health
   ```

   Expect `{"ok":true}`.

10. Build the static site with `VITE_API_BASE_URL=https://api.avouchsocial.com` (no trailing slash). Until that variable is set, or when the API does not answer, the site stays in demo mode.

## Nightly backup

The dump is encrypted with gpg on the box and copied off the database disk. Nothing is sent to a paid storage service.

```bash
sudo mkdir -p /var/backups/avouch /etc/avouch
sudo chmod 700 /var/backups/avouch /etc/avouch
openssl rand -base64 32 | sudo tee /etc/avouch/backup.key >/dev/null
sudo chmod 600 /etc/avouch/backup.key
```

Point `BACKUP_OFFBOX_DIR` at another disk, a drive you mounted, or an scp target such as `backup@192.0.2.10:/var/backups/avouch`. A directory on the same disk as `BACKUP_DIR` is refused. Keep a copy of `/etc/avouch/backup.key` with that off-box copy. Without the key, the dump cannot be restored.

```bash
sudo crontab -e
```

```
15 3 * * * cd /opt/avouch && BACKUP_DIR=/var/backups/avouch BACKUP_OFFBOX_DIR=/mnt/backup/avouch BACKUP_KEY_FILE=/etc/avouch/backup.key BACKUP_RETENTION_DAYS=14 ./scripts/backup-postgres.sh >> /var/log/avouch-backup.log 2>&1
```

The script keeps 14 days of ciphertext. OVH's included disk backup is a separate copy of the whole machine. Do not send dumps to AWS, Google, Azure, or Apple.

Restore, after stopping the API:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml stop api
BACKUP_KEY_FILE=/etc/avouch/backup.key ./scripts/restore-postgres.sh /mnt/backup/avouch/avouch-STAMP.dump.enc
docker compose --env-file deploy/.env -f deploy/docker-compose.yml start api
curl -fsS https://api.avouchsocial.com/api/health
```

`migrations/0001_auth.sql` is a verbatim copy of the scaffold file, so that file still mentions Neon and Vercel. Those comments do not describe this box. Apply SQL only with the migrate profile after you approve the files, including `migrations/0003_rate_limit.sql` and `migrations/0004_dm_e2ee.sql`. The private-message migration needs the owner's approval before it is applied. Do not run it against a real database until then.

## What this box does not do

It does not serve the static site. It does not run a feed, likes, reshares, or scores. Signup without an invite code is refused. The interface strings are English.
