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

1. Approve `migrations/0001_auth.sql`, `migrations/0002_closed_test.sql`, `migrations/0003_rate_limit.sql`, `migrations/0004_media.sql`, `migrations/0005_rate_limit_index.sql`, `migrations/0007_media_worker_role.sql`, `migrations/0008_board.sql`, and `migrations/0010_moderation.sql` in the pull request. Merging is not that approval. `0005` adds an index on `rateLimit.lastRequest`. `0004` and `0007` add media storage and the media worker login. `0008` adds room text, posts, steward marks, hard removals, and bans. `0010` adds doxxing and blasphemy, the out-of-scope mark, appeals, and the 90-day CSAM hold. `0006` is reserved. `0009` is unused. Each still needs your OK before it is applied. Do not apply them before you say so. Set `CSAM_HOLD_KEY` to 16 or more characters before a steward removes child sexual abuse material. That key seals the hold. The app does not show the sealed text and it does not file the CyberTipline report.
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

8. Seat Josh once, from the host. Do not put these values in `deploy/.env`. The API container is already running, so a line added to that file afterwards is never seen and the seed exits without seating anyone.

   ```bash
   ./scripts/seed-owner.sh
   ```

   The script asks for `BOOTSTRAP_OWNER`, `BOOTSTRAP_OWNER_EMAIL`, and `BOOTSTRAP_OWNER_PASSWORD`. The password is not echoed. `BOOTSTRAP_OWNER` must be `Josh`, `1`, or `true`. They are handed to the seed process with `docker compose exec -e` and are not written into `deploy/.env`. A second run prints that the founding admin is already seated and exits 1. If a password was left in `deploy/.env`, the script clears that line and recreates the API so it is not left in the process. Two seed processes at once can race; run it once. The `bootstrap_seat` row still refuses a second founding account.

9. Check health:

   ```bash
   curl -fsS https://api.avouchsocial.com/api/health
   ```

   Expect `{"ok":true}`. The health path is `/api/health`.

10. Build the static site with `VITE_API_BASE_URL=https://api.avouchsocial.com` (no trailing slash). Until that variable is set, or when the API does not answer, the site stays in demo mode.

## DNS fallback plan

Cloudflare is the primary DNS for `avouchsocial.com`. The spare domain `avouchsocial.org` is registered at Porkbun. Porkbun DNS is the fallback. Hurricane Electric (`dns.he.net`, free) is a second option. The VPS is `140.82.61.209`.

Prepare now, before anything breaks:

- At Porkbun, create A records for `api.avouchsocial.org`, `avouchsocial.org`, and `www.avouchsocial.org` pointing at `140.82.61.209`, TTL 600.
- Keep `api.avouchsocial.com` at Cloudflare TTL auto, which is 300 seconds. Leave that record DNS only. Do not proxy it.
- Keep a Cloudflare zone export in the project Drive.
- Leave the `.org` names out of `WEB_ORIGINS` until the fallback is actually in use.

If Cloudflare drops us, the `.org` records already point at the VPS. In `deploy/.env` set `API_HOST=api.avouchsocial.org` and `BETTER_AUTH_URL=https://api.avouchsocial.org`, and add `https://avouchsocial.org` and `https://www.avouchsocial.org` to `WEB_ORIGINS`. Then reload the API and Caddy:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d caddy api
```

Rebuild the frontend with `VITE_API_BASE_URL=https://api.avouchsocial.org` and serve it from the VPS through a Caddy `file_server`. That static block is not in `deploy/Caddyfile` yet. It is on the backlog in `BACKLOG.md`. Check the API:

```bash
curl -fsS https://api.avouchsocial.org/api/health
```

Expect `{"ok":true}`. Members will need to sign in again because sessions are per-domain.

A domain registered at Cloudflare Registrar cannot use outside nameservers. A transfer is locked for 60 days after registration, until about Dec 13, 2026. The `.com` name stays on Cloudflare until that lock ends. The `.org` name is the path that works before then.

TTLs are 300 seconds in normal operation, and 60 to 300 seconds before a planned move. The spare `.org` records created now use TTL 600. `api.avouchsocial.com` stays at TTL auto, which is 300 seconds.

The open items (Porkbun records, an optional Hurricane Electric zone, a monthly zone export, the Caddy static block, and a failover drill) are the checklist in `BACKLOG.md`.

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

That line runs at 3:15 UTC with the host clock on UTC.

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

`migrations/0001_auth.sql` is a verbatim copy of the scaffold file, so that file still mentions Neon and Vercel. Those comments do not describe this box. Apply SQL only with the migrate profile after you approve the files, including `migrations/0003_rate_limit.sql`, `migrations/0004_media.sql`, `migrations/0005_rate_limit_index.sql`, and `migrations/0007_media_worker_role.sql`. Set `MEDIA_WORKER_DB_PASSWORD` before that apply. It is the password for the media worker's database login, 16 or more letters and digits. The migrator turns that password into a SCRAM-SHA-256 verifier and runs `ALTER ROLE` on every migrate, including a re-run. The password is not written into the SQL file. Postgres statement logging would copy that `ALTER ROLE` into the server log, verifier and all. Leave `log_statement` at `none`. The compose Postgres command already does. `ddl`, `mod`, `all`, and `log_min_duration_statement = 0` record the verifier. Turn those on after the migrate profile has finished.

## Pictures and video

Uploads stay off until `MEDIA_S3_ENDPOINT`, `MEDIA_S3_BUCKET`, `MEDIA_S3_ACCESS_KEY_ID`, and `MEDIA_S3_SECRET_ACCESS_KEY` are set in `deploy/.env`. That is deliberate: object storage is a paid service, or a store you run, and it needs your OK. Do not order it from this repository.

Video stays off unless `MEDIA_VIDEO=on`. The charter keeps video off until the $250 band is boring.

After you approve `migrations/0004_media.sql`, `migrations/0007_media_worker_role.sql`, and the credentials, the media worker is a separate compose profile. `docker compose up` does not start it.

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml --profile media up -d
```

The worker re-encodes every room picture and video. It does not serve the original bytes. ffmpeg is pinned to Debian bookworm `7:5.1.9-0+deb12u1` and runs in `media-sandbox`, a container with no network, a CPU cap, and a memory cap. The worker does not call `unshare`. Docker's default seccomp profile would block that once privileges are dropped, and a failed sandbox refuses to start instead of blaming a missing ffmpeg. The worker signs in to Postgres as `media_worker`, which can use only the media tables. It reaches Postgres through a socket file. Its network has no default route. A proxy on that network dials the storage host from `MEDIA_S3_HOST` and no other destination. Set `MEDIA_S3_HOST` to the hostname of `MEDIA_S3_ENDPOINT`.

The worker container runs as `node`, with a read-only root filesystem, no Linux capabilities, and a temporary `/tmp`. It is limited to 512 MB and one CPU. It loads only its database URL, the storage settings, and the job directory. The worker claims the next job only after the current file is finished. The sandbox process cap of 64 and the ffmpeg nproc cap of 32 are per user, so they only hold while that stays true. Each job has its own directory on a volume the sandbox can write. The worker's ready file is on a different volume, so the sandbox cannot write it.

A room upload is accepted only when the room exists, the member has stood in that room, and the post exists. An invite that names a room records that membership. A signed-in member of another room cannot read the file.

Members receive a signed link that lasts two minutes. The link sets `Content-Disposition: attachment`, a fixed content type, and `Cache-Control: private, no-store`. The storage host must not be `avouchsocial.com` or a subdomain of it. That host, or the CDN in front of it, must send `X-Content-Type-Options: nosniff`. Signed URLs are not written to the logs.

After you approve the bucket, apply `deploy/media-lifecycle.json` so unfinished `incoming/` uploads expire after 24 hours. This repository does not apply that rule.

```bash
aws s3api put-bucket-lifecycle-configuration \
  --endpoint-url "$MEDIA_S3_ENDPOINT" \
  --bucket "$MEDIA_S3_BUCKET" \
  --lifecycle-configuration file://deploy/media-lifecycle.json
```

Deleting a member tombstones pictures that member sent. A sweep in the worker deletes those objects. A message picture the other person sent stays.

Pictures in a direct message are ciphertext. The server stores a wrapped key and does not read the bytes. The messaging change has to encrypt on the device. See `src/lib/media/e2e.ts`.

## What this box does not do

It does not serve the static site. It does not run a feed, likes, reshares, or scores. Signup without an invite code is refused. The interface strings are English.
