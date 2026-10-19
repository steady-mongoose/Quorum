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

1. Approve `migrations/0001_auth.sql`, `migrations/0002_closed_test.sql`, `migrations/0003_rate_limit.sql`, and `migrations/0005_rate_limit_index.sql` in the pull request. Merging is not that approval. `0005` adds an index on `rateLimit.lastRequest` and still needs your OK before it is applied. Do not apply them before you say so.
2. Order the VPS above. Do not use AWS, Google, Azure, or Apple.
3. Point `api.avouchsocial.com` at the VPS with an A (and AAAA, if you have one) record. In Cloudflare, set the record to DNS only. Do not proxy it.
4. SSH in with a key. On the host:

   ```bash
   sudo apt-get update
   sudo apt-get install -y ca-certificates curl
   # Docker's own apt repository, from docs.docker.com. Then:
   sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin age
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

## Limits

Better Auth stores its limiter in the `rateLimit` table, so every API process shares it. Sign-in is 5 attempts a minute per client address. The API applies that same cap, per address and per email, to sign-in, `/api/signup`, and `/api/invites`. A further attempt while the window is closed doubles the wait, up to 16 minutes. The response is HTTP 429 with `Retry-After`.

Plus tags share a lock on every domain. Dots share a lock only for `gmail.com` and `googlemail.com`, which count as one domain: `first.last+tag@googlemail.com` and `firstlast@gmail.com`. `first.last@corp.com` and `firstlast@corp.com` stay separate. A value that is too long or not an address is refused and is not stored as a key. IPv6 is one bucket per /64, in the API and in Caddy, including bracketed addresses and IPv4-mapped forms (`::FFFF:1.2.3.4` and `::ffff:cb00:7108`).

Expired rows (last request older than 16 minutes, which is as long as a lock can last) are deleted in batches of 500. That delete runs on every 20th limited write in a process, not on every write. It uses the `lastRequest` index from `migrations/0005_rate_limit_index.sql`. That migration needs your approval before it is applied. Until then the delete still works, and it scans the table.

Five failures from anywhere lock a known email for a minute, and further tries stretch that to 16 minutes. That is the tradeoff for a shared email cap. To clear it before the wait ends:

```bash
./scripts/clear-email-limit.sh 'person@example.com'
```

The script deletes the sign-in, signup, and invite rows for the normalized address. It does not delete the account. It runs `node --experimental-strip-types`, so the host needs Node 22.6 or newer. The API image is Node 22. On an older host, derive the key in the container and delete those keys yourself:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T api \
  node --experimental-strip-types server/clear-email-limit.ts 'person@example.com'
```

Caddy applies the same 5-per-minute cap per client address, with IPv6 grouped by /64, in front of those POST routes. Its image is built from `deploy/Dockerfile.caddy` (Caddy 2.10.2 by digest, rate-limit module pinned to commit `5625512`). The module sets `Retry-After` to the seconds until that 1-minute window allows another try. The error route does not replace that header. When the API returns 429, Caddy forwards the API's `Retry-After`, which can be up to 16 minutes.

The request URL is always `BETTER_AUTH_URL`. `X-Forwarded-For` is used for the client address only when the TCP peer is Caddy (`172.28.19.10`). Localhost browser origins are added only when `NODE_ENV` is not `production`. The API image sets `NODE_ENV=production`.

## Nightly backup

The dump is encrypted with [age](https://github.com/FiloSottile/age) to a public key. The private identity never sits on the server. Generate it on a machine you control:

```bash
age-keygen -o avouch-backup-identity.txt
```

The file's comment line is `public key: age1...`. Put that `age1...` value in `BACKUP_AGE_RECIPIENT`. Keep `avouch-backup-identity.txt` with you. Without it, a dump cannot be restored.

Local ciphertext stays in `BACKUP_DIR` for `BACKUP_RETENTION_DAYS` (14). The script deletes older local files.

A copy can go to S3-compatible storage: Cloudflare R2, or S3 with object lock. Leave `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY_ID`, and `BACKUP_S3_SECRET_ACCESS_KEY` blank until you approve the bucket. A paid bucket is not turned on by this repository. When all four are set, the script uploads with `aws s3api put-object`. Install the AWS CLI on the box at that point (`sudo apt-get install -y awscli`). `BACKUP_S3_OBJECT_LOCK` is `COMPLIANCE` or `GOVERNANCE` (or `off`). The retain-until date is the same 14 days. The script does not delete remote objects.

```bash
sudo mkdir -p /var/backups/avouch
sudo chmod 700 /var/backups/avouch
sudo crontab -e
```

```
15 3 * * * cd /opt/avouch && set -a && . ./deploy/.env && set +a && ./scripts/backup-postgres.sh >> /var/log/avouch-backup.log 2>&1
```

`deploy/.env` values must not contain spaces. OVH's included disk backup is a separate copy of the whole machine.

Set `BACKUP_HEALTHCHECK_URL` to a monitor's success URL if a nightly run should ping. Leave it blank and nothing is pinged. A successful run pings that URL. A failed run pings the same URL with `/fail` appended (Healthchecks.io). If the value already ends in `/fail`, that URL is the failure ping and the success ping is the URL with `/fail` removed. The script does not print the URL, and it does not put the URL on curl's command line.

Restore, after stopping the API. Copy the identity onto the box only for this command, then remove it:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml stop api
AGE_IDENTITY_FILE=/tmp/avouch-backup-identity.txt ./scripts/restore-postgres.sh /var/backups/avouch/avouch-STAMP.dump.age
rm -f /tmp/avouch-backup-identity.txt
docker compose --env-file deploy/.env -f deploy/docker-compose.yml start api
curl -fsS https://api.avouchsocial.com/api/health
```

If the copy you need is only in the bucket:

```bash
aws s3api get-object --endpoint-url "$BACKUP_S3_ENDPOINT" --region "${BACKUP_S3_REGION:-auto}" \
  --bucket "$BACKUP_S3_BUCKET" --key "avouch/avouch-STAMP.dump.age" avouch-STAMP.dump.age
```

`migrations/0001_auth.sql` is a verbatim copy of the scaffold file, so that file still mentions Neon and Vercel. Those comments do not describe this box. Apply SQL only with the migrate profile after you approve the files, including `migrations/0003_rate_limit.sql` and `migrations/0005_rate_limit_index.sql`.

## What this box does not do

It does not serve the static site. It does not run a feed, likes, reshares, or scores. Signup without an invite code is refused. The interface strings are English.
