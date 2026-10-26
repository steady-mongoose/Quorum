import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { offsitePlan } from "./backup-offsite.mjs";
import { projectRoot } from "./with-app-env.mjs";

const execFileAsync = promisify(execFile);
const DUMP = "closed-test dump bytes\n";

function writeCommands(root) {
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "pg_dump"), "#!/bin/sh\nprintf '%s' \"$DUMP_BYTES\"\n");
  writeFileSync(
    join(bin, "pg_restore"),
    "#!/bin/sh\ncat > \"$RESTORE_SINK\"\n",
  );
  writeFileSync(
    join(bin, "curl"),
    "#!/bin/sh\nprintf 'argv:%s\\n' \"$*\" >> \"$CURL_LOG\"\ncat >> \"$CURL_LOG\"\n",
  );
  writeFileSync(
    join(bin, "aws"),
    "#!/bin/sh\nprintf '%s\\n' \"$@\" >> \"$AWS_LOG\"\nif [ -n \"$AWS_ACCESS_KEY_ID\" ]; then echo access-key-present >> \"$AWS_LOG\"; fi\nif [ -n \"$AWS_SECRET_ACCESS_KEY\" ]; then echo secret-present >> \"$AWS_LOG\"; fi\necho \"metadata:$AWS_EC2_METADATA_DISABLED\" >> \"$AWS_LOG\"\n",
  );
  chmodSync(join(bin, "pg_dump"), 0o755);
  chmodSync(join(bin, "pg_restore"), 0o755);
  chmodSync(join(bin, "aws"), 0o755);
  chmodSync(join(bin, "curl"), 0o755);
  return bin;
}

async function publicKey(identityPath) {
  await execFileAsync("age-keygen", ["-o", identityPath]);
  const text = readFileSync(identityPath, "utf8");
  const match = text.match(/public key: (age1[0-9a-z]+)/);
  assert.ok(match);
  assert.equal(text.includes("AGE-SECRET-KEY-"), true);
  return match[1];
}

test("an age dump restores to the same bytes and stays local until credentials exist", async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-backup-"));
  const bin = writeCommands(root);
  const local = join(root, "local");
  const identity = join(root, "identity.txt");
  const sink = join(root, "restored");
  const recipient = await publicKey(identity);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    BACKUP_DIR: local,
    BACKUP_AGE_RECIPIENT: recipient,
    BACKUP_MODE: "pg_dump",
    DATABASE_URL: "postgres://avouch:secret@127.0.0.1/avouch",
    DUMP_BYTES: DUMP,
    BACKUP_S3_BUCKET: "",
    BACKUP_S3_ENDPOINT: "",
    BACKUP_S3_ACCESS_KEY_ID: "",
    BACKUP_S3_SECRET_ACCESS_KEY: "",
    BACKUP_HEALTHCHECK_URL: "https://hc.example/ping/secret-token",
    CURL_LOG: join(root, "curl.log"),
  };
  delete env.AGE_IDENTITY_FILE;
  delete env.BACKUP_KEY_FILE;
  delete env.BACKUP_OFFBOX_DIR;
  writeFileSync(join(root, "curl.log"), "");
  const backup = await execFileAsync(join(projectRoot(), "scripts/backup-postgres.sh"), [], { env });
  assert.match(backup.stdout, /Off-site copy is disabled until credentials are provided/);
  assert.match(backup.stdout, /Wrote /);
  assert.equal(backup.stdout.includes("AGE-SECRET-KEY-"), false);
  const names = readdirSync(local);
  assert.equal(names.some((name) => name.endsWith(".dump.partial")), false);
  assert.equal(names.some((name) => name.endsWith(".dump") && !name.endsWith(".age")), false);
  const enc = names.find((name) => name.endsWith(".dump.age"));
  assert.ok(enc);
  assert.equal(readFileSync(join(local, enc)).includes("closed-test dump"), false);

  await execFileAsync(join(projectRoot(), "scripts/restore-postgres.sh"), [join(local, enc)], {
    env: { ...env, BACKUP_MODE: "pg_restore", AGE_IDENTITY_FILE: identity, RESTORE_SINK: sink },
  });
  assert.equal(readFileSync(sink, "utf8"), DUMP);
  const successPing = readFileSync(join(root, "curl.log"), "utf8");
  assert.match(successPing, /url = "https:\/\/hc\.example\/ping\/secret-token"/);
  assert.match(successPing, /^fail$/m);
  assert.equal(successPing.includes("/fail"), false);
  const argv = successPing.split("\n").find((line) => line.startsWith("argv:")) ?? "";
  assert.equal(argv.includes("secret-token"), false);

  const wrong = join(root, "wrong.txt");
  await publicKey(wrong);
  await assert.rejects(
    execFileAsync(join(projectRoot(), "scripts/restore-postgres.sh"), [join(local, enc)], {
      env: { ...env, BACKUP_MODE: "pg_restore", AGE_IDENTITY_FILE: wrong, RESTORE_SINK: join(root, "nope") },
    }),
  );
});

test("credentials upload the ciphertext with object lock and without printing the secret", async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-backup-"));
  const bin = writeCommands(root);
  const identity = join(root, "identity.txt");
  const recipient = await publicKey(identity);
  const awsLog = join(root, "aws.log");
  const secret = "super-secret-value";
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    BACKUP_DIR: join(root, "local"),
    BACKUP_AGE_RECIPIENT: recipient,
    BACKUP_MODE: "pg_dump",
    DATABASE_URL: "postgres://avouch:secret@127.0.0.1/avouch",
    DUMP_BYTES: DUMP,
    BACKUP_S3_BUCKET: "avouch-backups",
    BACKUP_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
    BACKUP_S3_REGION: "auto",
    BACKUP_S3_ACCESS_KEY_ID: "test-access-key",
    BACKUP_S3_SECRET_ACCESS_KEY: secret,
    BACKUP_S3_OBJECT_LOCK: "COMPLIANCE",
    BACKUP_RETENTION_DAYS: "14",
    AWS_LOG: awsLog,
  };
  delete env.AGE_IDENTITY_FILE;
  const backup = await execFileAsync(join(projectRoot(), "scripts/backup-postgres.sh"), [], { env });
  assert.equal(backup.stdout.includes(secret), false);
  const log = readFileSync(awsLog, "utf8");
  assert.match(log, /s3api\nput-object\n/);
  assert.match(log, /--endpoint-url\nhttps:\/\/example\.r2\.cloudflarestorage\.com\n/);
  assert.match(log, /--bucket\navouch-backups\n/);
  assert.match(log, /--key\navouch\/avouch-\d{8}T\d{6}Z\.dump\.age\n/);
  assert.match(log, /--object-lock-mode\nCOMPLIANCE\n/);
  assert.match(log, /--object-lock-retain-until-date\n\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n/);
  assert.match(log, /access-key-present/);
  assert.match(log, /secret-present/);
  assert.match(log, /metadata:true/);
  assert.equal(log.includes(secret), false);
});

test("a failed backup pings the health-check URL and a blank URL stays quiet", async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-backup-"));
  const bin = writeCommands(root);
  const curlLog = join(root, "curl.log");
  const url = "https://hc.example/ping/secret-token";
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    BACKUP_DIR: join(root, "local"),
    BACKUP_AGE_RECIPIENT: "not-a-key",
    BACKUP_MODE: "pg_dump",
    BACKUP_HEALTHCHECK_URL: url,
    CURL_LOG: curlLog,
  };
  const failed = await execFileAsync(join(projectRoot(), "scripts/backup-postgres.sh"), [], { env }).then(
    () => {
      throw new Error("backup should have failed");
    },
    (error) => error,
  );
  assert.match(String(failed.stderr ?? ""), /age1/);
  assert.equal(String(failed.stdout ?? "").includes(url), false);
  assert.equal(String(failed.stderr ?? "").includes(url), false);
  const ping = readFileSync(curlLog, "utf8");
  assert.match(ping, /url = "https:\/\/hc\.example\/ping\/secret-token\/fail"/);
  assert.match(ping, /^fail$/m);
  const argv = ping.split("\n").find((line) => line.startsWith("argv:")) ?? "";
  assert.equal(argv.includes("secret-token"), false);

  const quietLog = join(root, "quiet.log");
  writeFileSync(quietLog, "");
  const quiet = { ...env, BACKUP_HEALTHCHECK_URL: "", CURL_LOG: quietLog };
  await assert.rejects(execFileAsync(join(projectRoot(), "scripts/backup-postgres.sh"), [], { env: quiet }));
  assert.equal(readFileSync(quietLog, "utf8"), "");
});

test("off-site upload is off until every credential is set", () => {
  const name = "/tmp/avouch-20261019T031500Z.dump.age";
  const now = Date.parse("2026-10-19T03:15:00Z");
  const blank = offsitePlan(
    {
      BACKUP_S3_BUCKET: "",
      BACKUP_S3_ENDPOINT: " ",
      BACKUP_S3_ACCESS_KEY_ID: "",
      BACKUP_S3_SECRET_ACCESS_KEY: "",
    },
    name,
    now,
  );
  assert.equal(blank.enabled, false);
  assert.throws(
    () =>
      offsitePlan(
        {
          BACKUP_S3_BUCKET: "avouch-backups",
          BACKUP_S3_ENDPOINT: "",
          BACKUP_S3_ACCESS_KEY_ID: "",
          BACKUP_S3_SECRET_ACCESS_KEY: "",
        },
        name,
        now,
      ),
    /together/,
  );
  const unlocked = offsitePlan(
    {
      BACKUP_S3_BUCKET: "avouch-backups",
      BACKUP_S3_ENDPOINT: "https://s3.example.com",
      BACKUP_S3_ACCESS_KEY_ID: "key",
      BACKUP_S3_SECRET_ACCESS_KEY: "secret",
      BACKUP_S3_OBJECT_LOCK: "off",
      BACKUP_RETENTION_DAYS: "14",
    },
    name,
    now,
  );
  assert.equal(unlocked.enabled, true);
  assert.equal(unlocked.args.includes("--object-lock-mode"), false);
  assert.equal(unlocked.args.includes("secret"), false);
});
