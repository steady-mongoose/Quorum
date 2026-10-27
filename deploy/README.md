# Dedicated box for api.avouchsocial.com

This is the closed-test API: Better Auth, invite codes, and Postgres on one Vultr VPS. The static site stays where it already is. Cloudflare is DNS only for `api.avouchsocial.com` (grey cloud, not proxied). Do not order another VPS from this repository's automation, and do not run the migrate profile until the owner has approved the SQL.

## The production host

**Vultr Cloud Compute `vc2-2c-4gb` in New York, $20/month, chosen Oct 19.** Address `140.82.61.209`.

|           |                |
| --------- | -------------- |
| Plan      | vc2-2c-4gb     |
| vCPU      | 2              |
| RAM       | 4 GB           |
| Region    | New York       |
| Price     | $20 /month     |
| Chosen    | Oct 19         |
| Public IP | 140.82.61.209  |

Image: Ubuntu 24.04. Do not add Plesk or cPanel.

## Why Docker Compose

One file runs Postgres, the API, and Caddy, with versions pinned. Postgres has no published port, so the database is only on the compose network. Caddy gets the certificate for `api.avouchsocial.com` from Let's Encrypt. Migrations are a separate compose profile that `docker compose up` does not start.

A systemd unit per process would also fit a single box. Compose is the smaller thing to read, and the backup script shells into the Postgres container.

## One-time steps for the owner

1. `0008`, `0011`, and `0012` are already applied on production. **0010** (`migrations/0010_moderation.sql`), **0013** (`migrations/0013_room_chat.sql`), **0014** (`migrations/0014_board_ban_room.sql`), and **0015** (`migrations/0015_hard_rules.sql`) are not. Approve those files before anyone runs `npm run db:migrate`. Merging is not that approval. `0005` adds an index on `rateLimit.lastRequest`. `0004` and `0007` add media storage and the media worker login. `0008` adds room text, posts, steward marks, hard removals, and bans. `0011` adds towns, ZIP codes, congregations, room requests, and council approvals. **0010** adds doxxing and blasphemy, the out-of-scope mark, appeals, and the CSAM hold. It adds `anonymize_moderation_user`. It does not replace `anonymize_board_user`. `0012` adds theme groups (carpentry, gardening, brewing, distilling, and a literary society), per-group admins and stewards, posts, marks, removals, appeals, and the action log. `0013` adds the plain-text room transcript and its hard-removal log. Until you apply it, room chat answers that it is not available yet and the board still loads. `0014` adds `board_ban.room_id` so a room steward's bar covers that room. An empty room id is a site-wide bar. An admin writes that, and a CSAM removal writes it too. Applying 0014 again is safe. **0015** allows doxxing and blasphemy on the theme-group and room-chat removal checks when those tables exist. It does not replace an anonymize function. `0006` (`migrations/0006_dm_e2ee.sql`) is end-to-end messages between two members. A shared meeting is a real meeting card. A person named by the host counts only after they confirm, and only if their account already had that name when the host posted. If posts already exist when the file is applied, a name is recorded only when a name stored at or before that post — the post's author name, an access log, or an earlier post — is the name on the list, and only one account had it. An account with no such record is skipped. A fresh database has no posts yet, so that step records nothing. One hosted card has one host. Deleting an account runs `anonymize_dm_user`, which keeps the other person's thread and the ciphertext row, shows the deleted member as Former member, leaves messages they sent with a null sender, deletes their device row, their one-time keys, and envelopes addressed to that device, clears the sender device and identity on those messages, and removes rate-limit rows whose key contains that account id. It does not replace any other anonymize function. A signed prekey is rotated after 7 days, the previous three still open a message, and a signed prekey is not offered for a new message after 30 days. Approve that file before anyone applies it. Merging is not that approval, and the API process does not run it. `0009` is unused. Do not apply `0006`, `0010`, `0013`, `0014`, `0015`, `0017`, or `0018` before you say so. **0018** (`migrations/0018_public_gathering.sql`) adds `public_gathering`. The public page reads the live title, date, time, and town from that row. Sharing defaults to off. It does not replace a function. **0017** (`migrations/0017_csam_hold_key.sql`) adds `board_csam_hold.key_id`. `0016` is reserved for group-ban inheritance. 0017 does not replace a function. Applying it again is safe. Set `CSAM_HOLD_KEY` to a random 32-byte key (`openssl rand -hex 32`) or a passphrase of 16 or more characters. The server still boots when that key is unset. A CSAM removal still hides the post and its files, records the removal and the ban, and alerts an admin. With no key, the post text and the files stay held unencrypted where the board cannot serve them, and starting the server after a key is set encrypts those holds. The process logs a warning at startup when CSAM_HOLD_KEY is missing. Set RESEND_API_KEY, ADMIN_ALERT_EMAIL, and RESEND_FROM together to email an admin when a hold is recorded. If any of those three is blank, no email is sent and nothing is logged. The message has no post text. The app does not show held material and it does not file the CyberTipline report. Josh files that by hand. Evidence is kept for 365 days by default (`CSAM_HOLD_DAYS` can raise that). That period is pending counsel.
2. The VPS above is the production host. Do not use AWS, Google, Azure, or Apple.
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

   The script asks for `BOOTSTRAP_OWNER`, `BOOTSTRAP_OWNER_EMAIL`, and `BOOTSTRAP_OWNER_PASSWORD`. The password is not echoed. `BOOTSTRAP_OWNER` must be `Josh`, `1`, or `true`. They are handed to the seed process with `docker compose exec -e` and are not written into `deploy/.env`. The script never edits `deploy/.env`. The seed blanks a leftover `BOOTSTRAP_OWNER_PASSWORD` line in the mounted file. A second run prints that Josh is already seated and exits 0. If a password was left in `deploy/.env` and the seed clears it, the script recreates the API so it is not left in the process. If that line is still set afterwards, the script does not recreate the API and exits non-zero. A clean run, and a clean re-run, do not recreate the API. `COMPOSE_PROFILES` and extra files in `COMPOSE_FILE` are passed through to Compose. `pipefail` is turned on when the shell supports it. Two seed processes at once can race; run it once. The `bootstrap_seat` row still refuses a second founding account.

9. Check health:

   ```bash
   curl -fsS https://api.avouchsocial.com/api/health
   ```

   Expect `{"ok":true}`. The health path is `/api/health`.

10. Build the static site with `VITE_API_BASE_URL=https://api.avouchsocial.com` (no trailing slash). An empty value means same-origin `/api`. `VITE_DEMO=1` forces the browser demo and does not call the API. When `/api/health` does not answer, the site stays in demo mode.

## DNS fallback plan

Cloudflare is the primary DNS for `avouchsocial.com`. The spare domain `avouchsocial.org` is registered at Porkbun. Porkbun DNS is the fallback. Hurricane Electric (`dns.he.net`, free) is a second option. The VPS is the Vultr `vc2-2c-4gb` in New York, `140.82.61.209`.

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

## Browser origins on state-changing requests

`POST`, `PUT`, `PATCH`, and `DELETE` are rejected with 403 when the browser names an origin that is not on the allow-list. `Origin` is checked first. If it is missing, the origin of `Referer` is checked the same way. A request with neither header is allowed: `curl`, `/api/health` (a GET, so it is not in this check), and other non-browser callers send neither, and a same-origin browser that omits both is treated the same way. `GET`, `HEAD`, and `OPTIONS` are not rejected for a missing origin. An allowed browser origin still gets `Vary: Origin` on the CORS response, including a rejected preflight.

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

`deploy/.env` values must not contain spaces. A Vultr automatic backup, if enabled, is a separate copy of the whole machine.

Set `BACKUP_HEALTHCHECK_URL` to a monitor's success URL if a nightly run should ping. Leave it blank and nothing is pinged. A successful run pings that URL. A failed run pings the same URL with `/fail` appended (Healthchecks.io). If the value already ends in `/fail`, that URL is the failure ping and the success ping is the URL with `/fail` removed. The script does not print the URL, and it does not put the URL on curl's command line.

Restore, after stopping the API. This database already has rows, so `--overwrite` is required: the script lists the dump, then drops and recreates it. Without that flag the database must be empty and nothing is dropped. Copy the identity onto the box only for this command, then remove it:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml stop api
AGE_IDENTITY_FILE=/tmp/avouch-backup-identity.txt ./scripts/restore-postgres.sh --overwrite /var/backups/avouch/avouch-STAMP.dump.age
rm -f /tmp/avouch-backup-identity.txt
docker compose --env-file deploy/.env -f deploy/docker-compose.yml start api
curl -fsS https://api.avouchsocial.com/api/health
```

To restore the newest dump from the bucket onto a fresh host, follow `deploy/FAILOVER.md` and run `scripts/restore-from-backup.sh`. That script uses these same `BACKUP_S3_*` names.

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

## Room calls

Live calls stay off until `CALLS=on` in `deploy/.env`. Restart the API after changing it. The site does not need a rebuild. Until then, `/api/calls/status` answers `{ "enabled": false, "record": false }` and the room page has no call button. Every other calls path answers 404.

This is not stored video. `MEDIA_VIDEO` still governs uploaded clips. A call is WebRTC between the browsers. The API keeps the offer, the answer, and the ICE candidates in memory for the people currently in that room. It checks the session, then `room_member`. Someone who has not stood in the room is refused, and their slot is dropped on that request. An open ban refuses the join even when that membership row is still there, and drops the slot. An admin who is not a member of that room is refused. Nothing is written to Postgres for the call, so there is no new migration. A restart drops the call. There is no recording route, and the page leaves if a response ever says the call is recorded.

Run one API container. The roster, the six-person cap, and the signals are in that process. A second replica would split the room. Do not scale `api` past one.

Six people can be in one room's call. The mesh is browser to browser. Set `CALLS_STUN_URLS` and `CALLS_TURN_URLS` only when you want a relay you run yourself. Do not point them at Google, Cloudflare, AWS, Azure, Apple, or LiveKit Cloud. A TURN URL without `CALLS_TURN_SECRET`, or a secret without a URL, keeps calls off. The secret is 32 or more letters and digits (`openssl rand -hex 32`). The API mints a password that lasts about an hour. A poll or a re-join refreshes it before it expires. The status path does not receive that password.

Removing or banning someone takes them out of the call in the same moment. After the ban is saved, `banMember` calls `evictCallMember` with that member's id, and `removePost` calls it with the author's id. `evictCallMember` in `server/calls/evict.ts` drops them from every room on this process. `startHost` binds the store. A path that deletes one `room_member` row calls `store.leave(roomId, userId)` for that room. The other browsers close that peer when the id disappears from the roster.

The relay is coturn, and only if you start the calls profile. `docker compose up` does not start it. LiveKit is not in the compose file: a media server can record, and these calls are not recorded. Coturn forwards packets. It has no recording switch.

```bash
# deploy/.env
# CALLS=on
# CALLS_STUN_URLS=stun:140.82.61.209:3478
# CALLS_TURN_URLS=turn:140.82.61.209:3478?transport=udp
# CALLS_TURN_SECRET=
# CALLS_TURN_EXTERNAL_IP=140.82.61.209
# CALLS_TURN_REALM=avouchsocial.com

docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build api
docker compose --env-file deploy/.env -f deploy/docker-compose.yml --profile calls up -d coturn
```

Coturn uses the host network and binds UDP and TCP 3478, plus UDP 49160 through 49260 for the relay. Open those in ufw only when you turn the profile on. It refuses to relay to the box's own public address, into private IPv4, and into `fc00::/7`, `fe80::/10`, and `::ffff:0:0/96`. It will not start without the secret and the public address. The credential is checked by coturn. It is not a standing password. Join, leave, and poll are limited to 60 in 10 seconds per member, and Caddy applies that same window per client address to those paths. A signal is limited to 120 in 10 seconds, in the API and at Caddy, on `/api/calls/rooms/<room>/signal`.

Calls work without coturn when the browsers can reach each other directly. Most people behind home routers cannot. Leave the TURN lines blank until the profile is up. Calls stay on, and the browsers use host candidates only.

## What this box does not do

It does not serve the static site. It does not run a feed, likes, reshares, or scores. It does not record room calls. Signup without an invite code is refused. The interface strings are English.

## Media host behind Cloudflare

`media.avouchsocial.com` is proxied by Cloudflare. Caddy serves it with a Cloudflare Origin CA certificate, not Let's Encrypt, because an ACME challenge does not reliably reach Caddy through the proxy, and with no valid certificate Cloudflare's Full (strict) mode answers 525. The host serves the media API (`/api/media/*`) and member files at `/m/:id/:variant/:exp/:sig`, both proxied to `api:8787`. Every other path is 404. The storage host itself must still not be `avouchsocial.com` or a subdomain of it; the API reads the bytes from storage and the media host serves them.

Manual steps. This repository does not do them, and nothing here changes DNS or Cloudflare:

1. In the Cloudflare dashboard for `avouchsocial.com`: SSL/TLS → Origin Server → Create Certificate. Hostnames: `media.avouchsocial.com`. Key type RSA or ECDSA, validity up to 15 years. Copy the certificate and the private key. The private key is shown once.
2. On the VPS, as root: `install -d -m 750 deploy/origin`, then write the certificate to `deploy/origin/media-origin.pem` and the key to `deploy/origin/media-origin.key` with mode `640`, readable by the Caddy container. Do not commit them; `deploy/origin/` is in `.gitignore`.
3. Set SSL/TLS mode for the zone (or a Configuration Rule for `media.avouchsocial.com`) to **Full (strict)**. The Origin CA certificate is only trusted by Cloudflare, so the record must stay proxied (orange cloud). A grey-cloud record would show browsers an untrusted certificate.
4. DNS: `media` A record to `140.82.61.209`, proxied. (Owner action; not done here.)
5. Optional: turn on Authenticated Origin Pulls so only Cloudflare can reach this site.
6. Reload: `docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d caddy`. Caddy refuses to start if the two files are missing, so place them before this step.
7. Check: `curl -sS https://media.avouchsocial.com/api/media/status` answers JSON, and `curl -sS -o /dev/null -w '%{http_code}' https://media.avouchsocial.com/` is `404`.

### Signed media links

The web app still asks `api.avouchsocial.com` for a file, with the session cookie, and the API still checks membership, bans and the CSAM block. When `MEDIA_PUBLIC_ORIGIN` and `MEDIA_URL_SECRET` are both set, the answer's `url` and `thumbUrl` point at `https://media.avouchsocial.com/m/...` instead of the storage host. The link carries an HMAC-SHA256 over the file id, the variant and an expiry. The expiry is rounded up to a ten-minute window, so every member reading a file in that window gets the same URL and Cloudflare can cache one copy (`Cache-Control: public, max-age` at most the time left, never more than 600 seconds).

Why signed links, not a wider cookie: the session cookie is host-only on `api.avouchsocial.com`. Widening it to `Domain=avouchsocial.com` would send the session to every subdomain, including the static site, and a response that depends on a cookie cannot be shared from the edge cache, which is the point of this host. The media host never reads or sets a cookie.

Held or flagged files: the media host runs the CSAM check on every request that reaches it, so a fresh link for a held or flagged file is refused for everyone, the owner and admins included. A copy already in Cloudflare's cache can live until its link expires (at most ten minutes). Purging it sooner needs a Cloudflare cache purge, which this repository does not do.

Settings in `deploy/.env` (not done here):

- `MEDIA_PUBLIC_ORIGIN=https://media.avouchsocial.com`
- `MEDIA_URL_SECRET=` at least 32 random characters, for example `openssl rand -base64 48`. Rotating it invalidates every link in flight; members fetch a new one.

With either unset, the API keeps the old behaviour: a two-minute presigned storage link.

To turn on the scanner: Cloudflare dashboard → Caching → Configuration → CSAM Scanning Tool, for the `avouchsocial.com` zone. Owner action; not done here.

## Real client address behind Cloudflare

Caddy trusts Cloudflare's published IP ranges (`trusted_proxies static` in the
global `servers` block) and, only for a peer in those ranges, reads the client
address from `CF-Connecting-IP`. Rate-limit zones key on `{client_ip}`, and each
`reverse_proxy` to the API sets `X-Forwarded-For` to that one address, so the
API's per-IP limits see the visitor, not a Cloudflare edge. A direct caller
outside those ranges keeps its socket address and cannot spoof the header.

Manual upkeep: the ranges are pinned from https://www.cloudflare.com/ips-v4 and
https://www.cloudflare.com/ips-v6 (fetched 2026-10-26). When Cloudflare changes
them, update the Caddyfile line and `CLOUDFLARE_RANGES` in
`scripts/deploy-edge.test.mjs` together. Keep the ranges on one line: Caddy
2.10 silently ignores ranges written as a block. To run the live check locally,
set `CADDY_BIN` to a Caddy binary and run `node --test scripts/deploy-edge.test.mjs`.
