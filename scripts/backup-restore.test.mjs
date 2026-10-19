import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { projectRoot } from "./with-app-env.mjs";

const execFileAsync = promisify(execFile);
const DUMP = "closed-test dump bytes\n";

function writeCommands(root) {
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "pg_dump"), "#!/bin/sh\nprintf '%s' \"$DUMP_BYTES\"\n");
  writeFileSync(join(bin, "pg_restore"), "#!/bin/sh\ncat > \"$RESTORE_SINK\"\n");
  chmodSync(join(bin, "pg_dump"), 0o755);
  chmodSync(join(bin, "pg_restore"), 0o755);
  return bin;
}

test("an encrypted dump copies off the box and restores to the same bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-backup-"));
  const bin = writeCommands(root);
  const local = join(root, "local");
  const offbox = join(root, "offbox");
  const key = join(root, "backup.key");
  const sink = join(root, "restored");
  writeFileSync(key, "local-backup-passphrase\n", { mode: 0o600 });
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    BACKUP_DIR: local,
    BACKUP_OFFBOX_DIR: offbox,
    BACKUP_KEY_FILE: key,
    BACKUP_MODE: "pg_dump",
    BACKUP_ALLOW_SAME_DEVICE: "1",
    DATABASE_URL: "postgres://avouch:secret@127.0.0.1/avouch",
    DUMP_BYTES: DUMP,
  };
  const backup = await execFileAsync(join(projectRoot(), "scripts/backup-postgres.sh"), [], { env });
  assert.match(backup.stdout, /Wrote /);
  const names = readdirSync(local);
  assert.equal(names.some((name) => name.endsWith(".dump.partial")), false);
  assert.equal(names.some((name) => name.endsWith(".dump") && !name.endsWith(".enc")), false);
  const enc = names.find((name) => name.endsWith(".dump.enc"));
  assert.ok(enc);
  assert.equal(readdirSync(offbox).includes(enc), true);
  assert.equal(readFileSync(join(local, enc)).includes("closed-test dump"), false);

  await execFileAsync(join(projectRoot(), "scripts/restore-postgres.sh"), [join(offbox, enc)], {
    env: { ...env, BACKUP_MODE: "pg_restore", RESTORE_SINK: sink },
  });
  assert.equal(readFileSync(sink, "utf8"), DUMP);

  const wrong = join(root, "wrong.key");
  writeFileSync(wrong, "not-the-passphrase\n");
  await assert.rejects(
    execFileAsync(join(projectRoot(), "scripts/restore-postgres.sh"), [join(offbox, enc)], {
      env: { ...env, BACKUP_MODE: "pg_restore", BACKUP_KEY_FILE: wrong, RESTORE_SINK: join(root, "nope") },
    }),
  );
});

test("a copy onto the same disk is refused unless the drill flag is set", async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-backup-"));
  const bin = writeCommands(root);
  const key = join(root, "backup.key");
  writeFileSync(key, "local-backup-passphrase\n");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    BACKUP_DIR: join(root, "local"),
    BACKUP_OFFBOX_DIR: join(root, "offbox"),
    BACKUP_KEY_FILE: key,
    BACKUP_MODE: "pg_dump",
    DATABASE_URL: "postgres://avouch:secret@127.0.0.1/avouch",
    DUMP_BYTES: DUMP,
  };
  delete env.BACKUP_ALLOW_SAME_DEVICE;
  await assert.rejects(
    execFileAsync(join(projectRoot(), "scripts/backup-postgres.sh"), [], { env }),
    (error) => /same disk/.test(String(error.stderr ?? error.message)),
  );
});
