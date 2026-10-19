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
  writeFileSync(
    join(bin, "psql"),
    "#!/bin/sh\nprintf '%s\\n' \"$@\" >> \"$PSQL_LOG\"\nif [ -n \"$PGPASSFILE\" ] && grep -q super-secret \"$PGPASSFILE\"; then echo pgpass-has-password >> \"$PSQL_LOG\"; fi\nif [ -n \"${DATABASE_URL:-}\" ]; then echo url-in-env >> \"$PSQL_LOG\"; fi\n",
  );
  chmodSync(join(bin, "psql"), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    CLEAR_MODE: "psql",
    DATABASE_URL: "postgres://avouch:super-secret@127.0.0.1:5432/avouch",
    PSQL_LOG: log,
  };
  const result = await execFileAsync(
    join(projectRoot(), "scripts/clear-email-limit.sh"),
    ["first.last+tag@GoogleMail.com"],
    { env },
  );
  assert.match(result.stdout, /Cleared the limit for firstlast@gmail\.com/);
  const sql = readFileSync(log, "utf8");
  assert.match(sql, /key=firstlast@gmail\.com/);
  assert.match(sql, /:'key'/);
  assert.match(sql, /pgpass-has-password/);
  assert.equal(sql.includes("super-secret"), false);
  assert.equal(sql.includes("postgres://"), false);
  assert.equal(sql.includes("url-in-env"), false);
  assert.equal(sql.includes("GoogleMail"), false);
  const script = readFileSync(join(projectRoot(), "scripts/clear-email-limit.sh"), "utf8");
  assert.match(script, /Node 22\.6/);
});
