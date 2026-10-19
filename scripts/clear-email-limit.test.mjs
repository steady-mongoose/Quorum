import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { projectRoot } from "./with-app-env.mjs";

const execFileAsync = promisify(execFile);

/**
 * The clear test deletes every "rateLimit" row. Only a database named "test",
 * or whose name ends in "_test", is eligible. A substring such as "latest"
 * or "contest" is not enough.
 */
function isClearTestDatabase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, "")).toLowerCase();
  return name === "test" || name.endsWith("_test");
}

test("clearing a limit deletes the normalized email and not the typed alias", async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-clear-"));
  const bin = join(root, "bin");
  const log = join(root, "psql.log");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "psql"),
    "#!/bin/sh\nprintf '%s\\n' \"$@\" >> \"$PSQL_LOG\"\necho '---stdin---' >> \"$PSQL_LOG\"\ncat >> \"$PSQL_LOG\"\nif [ -n \"$PGPASSFILE\" ] && grep -q super-secret \"$PGPASSFILE\"; then echo pgpass-has-password >> \"$PSQL_LOG\"; fi\nif [ -n \"${DATABASE_URL:-}\" ]; then echo url-in-env >> \"$PSQL_LOG\"; fi\n",
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
  assert.match(sql, /-f\n-/);
  assert.match(sql, /:'key'/);
  assert.equal(sql.includes("-c"), false);
  assert.match(sql, /pgpass-has-password/);
  assert.equal(sql.includes("super-secret"), false);
  assert.equal(sql.includes("postgres://"), false);
  assert.equal(sql.includes("url-in-env"), false);
  assert.equal(sql.includes("GoogleMail"), false);
  const script = readFileSync(join(projectRoot(), "scripts/clear-email-limit.sh"), "utf8");
  assert.match(script, /Node 22\.6/);
  assert.match(script, /exec -T postgres/);
  assert.equal(script.includes('-c "$sql"'), false);
});

test("the Postgres clear test only accepts a _test suffix or the name test", () => {
  assert.equal(isClearTestDatabase("postgres://avouch:secret@127.0.0.1:5432/avouch_test"), true);
  assert.equal(isClearTestDatabase("postgres://avouch:secret@127.0.0.1:5432/avouch_TEST"), true);
  assert.equal(isClearTestDatabase("postgres://avouch:secret@127.0.0.1:5432/test"), true);
  assert.equal(isClearTestDatabase("postgres://avouch:secret@127.0.0.1:5432/TEST"), true);
  assert.equal(isClearTestDatabase("postgres://avouch:secret@127.0.0.1:5432/AvouchTest"), false);
  assert.equal(isClearTestDatabase("postgres://avouch:secret@127.0.0.1:5432/latest"), false);
  assert.equal(isClearTestDatabase("postgres://avouch:secret@127.0.0.1:5432/contest"), false);
  assert.equal(isClearTestDatabase("postgres://avouch:secret@127.0.0.1:5432/avouch"), false);
  assert.equal(isClearTestDatabase("postgres://avouch:secret@db.example/avouch"), false);
  assert.equal(isClearTestDatabase("not-a-url"), false);
});

// WARNING: this test deletes every row in "rateLimit" on CLEAR_POSTGRES_URL.
// It is not limited to one email. It refuses to run unless the database name
// is "test" or ends with "_test". Do not point it at a database you need to keep.
test("clearing a limit on Postgres deletes that email's rows", async (t) => {
  const url = process.env.CLEAR_POSTGRES_URL ?? "";
  if (!url) {
    if (process.env.CLEAR_POSTGRES_REQUIRED === "1") {
      throw new Error("Set CLEAR_POSTGRES_URL to a Postgres the clear script can use.");
    }
    t.skip("Set CLEAR_POSTGRES_URL to run this against Postgres.");
    return;
  }
  if (!isClearTestDatabase(url)) {
    throw new Error(
      'Refusing to delete "rateLimit" rows: the database name in CLEAR_POSTGRES_URL must be "test" or end with "_test".',
    );
  }
  const schema = readFileSync(join(projectRoot(), "migrations/0003_rate_limit.sql"), "utf8");
  await execFileAsync("psql", [url, "-v", "ON_ERROR_STOP=1", "-c", schema]);
  await execFileAsync("psql", [
    url,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `delete from "rateLimit";
     insert into "rateLimit" ("id", "key", "count", "lastRequest") values
       ('clear-1', 'sign-in:email:firstlast@gmail.com', 6, 1),
       ('clear-2', 'signup:email:firstlast@gmail.com', 6, 1),
       ('clear-3', 'invite:email:firstlast@gmail.com', 6, 1),
       ('clear-4', 'signup:email:other@example.com', 1, 1);`,
  ]);
  const result = await execFileAsync(
    join(projectRoot(), "scripts/clear-email-limit.sh"),
    ["first.last+tag@GoogleMail.com"],
    {
      env: {
        ...process.env,
        CLEAR_MODE: "psql",
        DATABASE_URL: url,
        PGCONNECT_TIMEOUT: "5",
      },
    },
  );
  assert.match(result.stdout, /Cleared the limit for firstlast@gmail\.com/);
  assert.equal(result.stderr.includes("syntax error"), false);
  const { stdout } = await execFileAsync("psql", [
    url,
    "-tA",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    'select "key" from "rateLimit" order by 1',
  ]);
  assert.equal(stdout.trim(), "signup:email:other@example.com");
});
