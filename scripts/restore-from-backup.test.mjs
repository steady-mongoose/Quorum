import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { ageInstalled } from "./age-bin.mjs";
import { projectRoot } from "./with-app-env.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT = join(projectRoot(), "scripts/restore-from-backup.sh");
const skipWithoutAge = ageInstalled() ? false : "age-keygen is not installed";
const PLAIN = "closed-test dump bytes\n";

function writeBins(root, awsBody, relations = "0") {
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "pg_restore"),
    `#!/bin/sh
if [ "$1" = "--list" ]; then
  printf '%s\\n' "1; 1259 16384 TABLE public drill_marker avouch"
  exit 0
fi
cat > "$RESTORE_SINK"
`,
  );
  writeFileSync(join(bin, "psql"), `#!/bin/sh\nprintf '%s\\n' "${relations}"\n`);
  writeFileSync(join(bin, "aws"), awsBody);
  chmodSync(join(bin, "pg_restore"), 0o755);
  chmodSync(join(bin, "psql"), 0o755);
  chmodSync(join(bin, "aws"), 0o755);
  return bin;
}

async function publicKey(identityPath) {
  await execFileAsync("age-keygen", ["-o", identityPath]);
  const text = readFileSync(identityPath, "utf8");
  const match = text.match(/public key: (age1[0-9a-z]+)/);
  assert.ok(match);
  return match[1];
}

async function encryptedDump(root) {
  const identity = join(root, "identity.txt");
  const plain = join(root, "plain.dump");
  const enc = join(root, "avouch-20261021T031500Z.dump.age");
  writeFileSync(plain, PLAIN);
  const recipient = await publicKey(identity);
  await execFileAsync("age", ["-r", recipient, "-o", enc, plain]);
  return { identity, enc };
}

test("a dry run restores the local dump and does not contact the bucket", { skip: skipWithoutAge }, async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-restore-dry-"));
  const awsLog = join(root, "aws.log");
  const sink = join(root, "restored");
  const bin = writeBins(root, '#!/bin/sh\necho called >> "$AWS_LOG"\nexit 99\n');
  const { identity, enc } = await encryptedDump(root);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    RESTORE_DRY_RUN: "1",
    RESTORE_DUMP: enc,
    AGE_IDENTITY_FILE: identity,
    BACKUP_MODE: "pg_restore",
    DATABASE_URL: "postgres://avouch:secret@127.0.0.1:5432/avouch_restore_test",
    RESTORE_SINK: sink,
    AWS_LOG: awsLog,
    BACKUP_S3_BUCKET: "should-not-be-read",
    BACKUP_S3_SECRET_ACCESS_KEY: "super-secret-value",
  };
  const result = await execFileAsync(SCRIPT, [], { env });
  assert.match(result.stdout, /Restored /);
  assert.equal(readFileSync(sink, "utf8"), PLAIN);
  assert.equal(result.stdout.includes("super-secret-value"), false);
  assert.equal(result.stderr.includes("super-secret-value"), false);
  let aws = "";
  try {
    aws = readFileSync(awsLog, "utf8");
  } catch {
    aws = "";
  }
  assert.equal(aws, "");
});

test("a dry run refuses a database that is not a throwaway", { skip: skipWithoutAge }, async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-restore-guard-"));
  const sink = join(root, "restored");
  const bin = writeBins(root, "#!/bin/sh\nexit 99\n");
  const { identity, enc } = await encryptedDump(root);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    RESTORE_DRY_RUN: "1",
    RESTORE_DUMP: enc,
    AGE_IDENTITY_FILE: identity,
    BACKUP_MODE: "pg_restore",
    DATABASE_URL: "postgres://avouch:secret@127.0.0.1:5432/avouch",
    RESTORE_SINK: sink,
  };
  const failed = await execFileAsync(SCRIPT, [], { env }).then(
    () => {
      throw new Error("dry run should have refused the production name");
    },
    (error) => error,
  );
  assert.match(String(failed.stderr ?? ""), /refuses to restore into avouch/);
  assert.equal(String(failed.stdout ?? "").includes("super-secret"), false);
});

test("the bucket restore takes the newest age dump and does not print the secret", { skip: skipWithoutAge }, async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-restore-b2-"));
  const awsLog = join(root, "aws.log");
  const sink = join(root, "restored");
  const { identity, enc } = await encryptedDump(root);
  const bin = writeBins(
    root,
    `#!/bin/sh
printf '%s\\n' "$@" >> "$AWS_LOG"
if [ -n "$AWS_SECRET_ACCESS_KEY" ]; then echo secret-present >> "$AWS_LOG"; fi
echo "metadata:$AWS_EC2_METADATA_DISABLED" >> "$AWS_LOG"
if [ "$1" = "s3api" ] && [ "$2" = "list-objects-v2" ]; then
  printf '%s\\t%s\\t%s\\n' \\
    "avouch/avouch-20261019T031500Z.dump.age" \\
    "avouch/readme.txt" \\
    "avouch/avouch-20261021T031500Z.dump.age"
  exit 0
fi
if [ "$1" = "s3api" ] && [ "$2" = "get-object" ]; then
  last=""
  for arg in "$@"; do last="$arg"; done
  cp "$FIXTURE_AGE" "$last"
  exit 0
fi
echo "unexpected" >> "$AWS_LOG"
exit 1
`,
  );
  const secret = "super-secret-value";
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    AGE_IDENTITY_FILE: identity,
    BACKUP_MODE: "pg_restore",
    DATABASE_URL: "postgres://avouch:secret@127.0.0.1:5432/avouch_restore_test",
    RESTORE_SINK: sink,
    AWS_LOG: awsLog,
    FIXTURE_AGE: enc,
    BACKUP_S3_BUCKET: "avouch-backups",
    BACKUP_S3_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    BACKUP_S3_REGION: "us-west-004",
    BACKUP_S3_ACCESS_KEY_ID: "test-access-key",
    BACKUP_S3_SECRET_ACCESS_KEY: secret,
  };
  delete env.RESTORE_DRY_RUN;
  delete env.RESTORE_DUMP;
  const result = await execFileAsync(SCRIPT, [], { env });
  assert.equal(readFileSync(sink, "utf8"), PLAIN);
  assert.equal(result.stdout.includes(secret), false);
  const log = readFileSync(awsLog, "utf8");
  assert.match(log, /--key\navouch\/avouch-20261021T031500Z\.dump\.age\n/);
  assert.equal(log.includes("--key\navouch/avouch-20261019T031500Z.dump.age"), false);
  assert.match(log, /--endpoint-url\nhttps:\/\/s3\.us-west-004\.backblazeb2\.com\n/);
  assert.match(log, /secret-present/);
  assert.match(log, /metadata:true/);
  assert.equal(log.includes(secret), false);
  assert.equal(log.includes("AGE-SECRET-KEY-"), false);
});

test("a restore refuses a database that is not empty unless --overwrite is set", { skip: skipWithoutAge }, async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-restore-full-"));
  const sink = join(root, "restored");
  const bin = writeBins(root, "#!/bin/sh\nexit 99\n", "4");
  const { identity, enc } = await encryptedDump(root);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    RESTORE_DRY_RUN: "1",
    RESTORE_DUMP: enc,
    AGE_IDENTITY_FILE: identity,
    BACKUP_MODE: "pg_restore",
    DATABASE_URL: "postgres://avouch:secret@127.0.0.1:5432/avouch_restore_test",
    RESTORE_SINK: sink,
  };
  const failed = await execFileAsync(SCRIPT, [], { env }).then(
    () => {
      throw new Error("a non-empty database should have been refused");
    },
    (error) => error,
  );
  assert.match(String(failed.stderr ?? ""), /Pass --overwrite/);
  assert.equal(existsSync(sink) && readFileSync(sink, "utf8").includes(PLAIN), false);

  const again = await execFileAsync(SCRIPT, ["--overwrite"], { env });
  assert.match(again.stdout, /Restored /);
  assert.equal(readFileSync(sink, "utf8"), PLAIN);
});

test("a dump that does not list is refused before the database is written", { skip: skipWithoutAge }, async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-restore-list-"));
  const sink = join(root, "restored");
  const bin = writeBins(root, "#!/bin/sh\nexit 99\n");
  writeFileSync(
    join(bin, "pg_restore"),
    `#!/bin/sh
if [ "$1" = "--list" ]; then
  echo "not an archive" >&2
  exit 1
fi
cat > "$RESTORE_SINK"
`,
  );
  chmodSync(join(bin, "pg_restore"), 0o755);
  const { identity, enc } = await encryptedDump(root);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    RESTORE_DRY_RUN: "1",
    RESTORE_DUMP: enc,
    AGE_IDENTITY_FILE: identity,
    BACKUP_MODE: "pg_restore",
    DATABASE_URL: "postgres://avouch:secret@127.0.0.1:5432/avouch_restore_test",
    RESTORE_SINK: sink,
  };
  const failed = await execFileAsync(SCRIPT, [], { env }).then(
    () => {
      throw new Error("a dump that will not list should have been refused");
    },
    (error) => error,
  );
  assert.notEqual(failed.code, 0);
  let restored = "";
  try {
    restored = readFileSync(sink, "utf8");
  } catch {
    restored = "";
  }
  assert.equal(restored.includes(PLAIN), false);
});
