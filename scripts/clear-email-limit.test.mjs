import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { projectRoot } from "./with-app-env.mjs";

const execFileAsync = promisify(execFile);

test("clearing a limit deletes the normalized email and not the typed alias", async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-clear-"));
  const bin = join(root, "bin");
  const log = join(root, "psql.log");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(bin);
  writeFileSync(join(bin, "psql"), "#!/bin/sh\nprintf '%s\\n' \"$@\" >> \"$PSQL_LOG\"\n");
  chmodSync(join(bin, "psql"), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    CLEAR_MODE: "psql",
    DATABASE_URL: "postgres://avouch@127.0.0.1/avouch",
    PSQL_LOG: log,
  };
  const result = await execFileAsync(join(projectRoot(), "scripts/clear-email-limit.sh"), ["A.B+tag@Example.com"], {
    env,
  });
  assert.match(result.stdout, /Cleared the limit for ab@example\.com/);
  const sql = readFileSync(log, "utf8");
  assert.match(sql, /sign-in:email:ab@example\.com/);
  assert.match(sql, /signup:email:ab@example\.com/);
  assert.match(sql, /invite:email:ab@example\.com/);
  assert.equal(sql.includes("A.B+tag"), false);
});
