# Failover to a new VPS

Use this when the box that serves `api.avouchsocial.com` is gone or you have to leave it. The spare is another VPS you already have a way to pay for. This repository does not order a machine, open a new account, or turn on a paid failover product.

The database copy is the nightly age-encrypted dump in Backblaze B2. B2 is free under 10 GB. The script talks to it with the same `BACKUP_S3_*` variables as `scripts/backup-postgres.sh`. The age private key stays off the server except during the restore.

## Target times

- **Recovery point.** The newest dump in the bucket. The cron in `deploy/README.md` runs at 03:15 UTC. A failure between dumps can lose up to about 24 hours of writes.
- **Time to a serving API.** Within 1 hour of starting this runbook. That is the charter's first hour: the new box is up and `GET /api/health` answers.
- **DNS.** `api.avouchsocial.com` stays at Cloudflare TTL auto, which is 300 seconds, and the record stays DNS only. After you change the A record, resolvers follow within 5 minutes. Before a planned move, lower that TTL to between 60 and 300 seconds the day before, then put it back.

## 1. Bring up an empty VPS

Pick a company that is not the one that just failed you, and not AWS, Google, Azure, or Apple. Install Docker and the AWS CLI (`sudo apt-get install -y awscli`). The CLI is only the S3 client for B2. You do not need an Amazon account.

Clone this repository and check out `the-board`. Copy `deploy/env.example` to `deploy/.env` and fill it from the password manager. Use the same `BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`, and age public key as the old box so existing sessions still verify. A new auth secret signs everyone out.

`CSAM_HOLD_KEY` has to be the same key that sealed the hold. A fresh key makes every restored `board_csam_hold` row undecryptable, and the 365-day evidence hold cannot be opened or finished. Two copies of that key exist:

- On the old box, `/root/avouch-secrets` (mode 600). If that disk is still readable, copy the `CSAM_HOLD_KEY` line from there into `deploy/.env`.
- In the same B2 bucket as the dumps, at `avouch/secrets/csam-hold-key.env.age`. Decrypt it with the same age identity as the database dumps. The plaintext is one env line, `CSAM_HOLD_KEY=...`. Put that line in `deploy/.env`, then shred the plaintext.

```bash
set -a && . ./deploy/.env && set +a
aws s3api get-object --endpoint-url "$BACKUP_S3_ENDPOINT" --region "${BACKUP_S3_REGION:-auto}" \
  --bucket "$BACKUP_S3_BUCKET" --key "avouch/secrets/csam-hold-key.env.age" /tmp/csam-hold-key.env.age
age -d -i /tmp/avouch-backup-identity.txt -o /tmp/csam-hold-key.env /tmp/csam-hold-key.env.age
# Copy the CSAM_HOLD_KEY line into deploy/.env. Do not leave the plaintext on disk.
shred -u /tmp/csam-hold-key.env /tmp/csam-hold-key.env.age 2>/dev/null || rm -f /tmp/csam-hold-key.env /tmp/csam-hold-key.env.age
```

Do this before you start the API. The identity file used above is the same one step 2 deletes when the database restore finishes, so decrypt the key first or copy the identity only for both commands.

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d postgres
```

Wait until Postgres is healthy. Do not start the API yet, and do not run the migrate profile. The dump already has the schema. A migrate on top of it is a second writer.

## 2. Restore the newest dump

On a machine you control, you already have `avouch-backup-identity.txt` from `age-keygen`. Copy that file to the new box only for this command.

`deploy/.env` needs the same four values the nightly backup uses, pointed at B2's S3 endpoint:

```bash
BACKUP_S3_BUCKET=...
BACKUP_S3_ENDPOINT=https://s3.<region>.backblazeb2.com
BACKUP_S3_REGION=<region>
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
```

`BACKUP_S3_REGION` for B2 is the region in the endpoint, such as `us-west-004`. Leave `BACKUP_MODE` at `docker`.

```bash
set -a && . ./deploy/.env && set +a
AGE_IDENTITY_FILE=/tmp/avouch-backup-identity.txt ./scripts/restore-from-backup.sh
shred -u /tmp/avouch-backup-identity.txt 2>/dev/null || rm -f /tmp/avouch-backup-identity.txt
```

The script lists `avouch/avouch-STAMP.dump.age` in the bucket, downloads the newest name, and restores it with `scripts/restore-postgres.sh`. It runs `pg_restore --list` on the decrypted dump before it touches the database. This Postgres was just created, so `public` is empty and the script restores into it. It does not drop the database. If `public` already has tables, the script refuses. Pass `--overwrite` only when you mean to drop `POSTGRES_DB` and recreate it from the dump:

```bash
AGE_IDENTITY_FILE=/tmp/avouch-backup-identity.txt ./scripts/restore-from-backup.sh --overwrite
```

It does not delete the copy in B2, and it does not print the secret or the identity.

The dump is the database only. Objects under `csam-hold/` are not in it. Those bytes live in the media bucket (`MEDIA_S3_BUCKET`), and `board_csam_hold` names the keys. Point `MEDIA_S3_ENDPOINT`, `MEDIA_S3_BUCKET`, and the media keys at the same bucket the old box used, and do not copy anything. If you are leaving that bucket, copy the prefix onto the new one before you start the API. Use the media credentials, not the backup credentials:

```bash
AWS_ACCESS_KEY_ID="$MEDIA_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$MEDIA_S3_SECRET_ACCESS_KEY" \
  aws s3 sync --endpoint-url "$MEDIA_S3_ENDPOINT" \
  "s3://${MEDIA_S3_BUCKET}/csam-hold/" /var/backups/avouch/csam-hold
AWS_ACCESS_KEY_ID="$NEW_MEDIA_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$NEW_MEDIA_S3_SECRET_ACCESS_KEY" \
  aws s3 sync --endpoint-url "$NEW_MEDIA_S3_ENDPOINT" \
  /var/backups/avouch/csam-hold "s3://${NEW_MEDIA_S3_BUCKET}/csam-hold/"
rm -rf /var/backups/avouch/csam-hold
```

The new object's key must stay `csam-hold/...`, the same string stored in `board_csam_hold`. A missing object cannot be decrypted later, and the hold sweep will not invent it.

## 3. Start the API and check it on the new address

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d api caddy
curl -fsS --resolve api.avouchsocial.com:443:<new-ip> https://api.avouchsocial.com/api/health
```

Expect `{"ok":true}` before you touch DNS. If this curl fails, leave the Cloudflare record where it is.

## 4. Cut DNS over in Cloudflare

In the Cloudflare dashboard for `avouchsocial.com`:

1. Open the A record for `api.avouchsocial.com`.
2. Set the address to the new VPS.
3. Leave the proxy off (DNS only, grey cloud). Do not turn the orange cloud on.
4. Leave the TTL at auto (300 seconds) during an emergency. For a planned move that you lowered ahead of time, you can set it as low as 60 seconds.

Wait 5 minutes, then from a network that is not your shell's resolver cache:

```bash
curl -fsS https://api.avouchsocial.com/api/health
```

Expect `{"ok":true}`. The static site stays where it is. It already calls `https://api.avouchsocial.com`.

## 5. After the hour

Confirm the nightly backup cron points at the new box and that a new dump lands in B2. Keep the age identity where you kept it before. Put a one-line note in the password manager that names the new host and the dump you restored.

A rehearsal uses the dry run so it cannot touch the production database name. It restores a local test dump into a throwaway Postgres and does not contact B2:

```bash
RESTORE_DRY_RUN=1 RESTORE_DUMP=/tmp/avouch-test.dump.age \
  AGE_IDENTITY_FILE=/tmp/identity.txt BACKUP_MODE=pg_restore \
  DATABASE_URL=postgres://avouch:secret@127.0.0.1:54329/avouch_restore_test \
  ./scripts/restore-from-backup.sh
```

The database name must be `test` or end in `_test`. CI runs that rehearsal in a throwaway Postgres container (`scripts/failover-restore-drill.sh`).
