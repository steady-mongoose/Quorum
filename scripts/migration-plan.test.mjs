import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyMediaWorkerPassword,
  isMigrationFile,
  isNoTransaction,
  isSkipEmbedded,
  migrationName,
  pendingMigrations,
  sqlStatements,
} from "./migration-plan.mjs";
import { projectRoot } from "./with-app-env.mjs";

const AUTH_MIGRATION = "0001_auth.sql";

/**
 * The auth-on copy of the Better Auth schema and its source, or null when the
 * app has not turned sign-in on (the shipped state).
 */
function authSchemaCopy(root) {
  const copy = join(root, "migrations", AUTH_MIGRATION);
  const source = join(root, "migrations/auth", AUTH_MIGRATION);
  if (!existsSync(copy) || !existsSync(source)) return null;
  return { copy: readFileSync(copy, "utf8"), source: readFileSync(source, "utf8") };
}

test("_migrations keys on basename, not path", () => {
  assert.equal(migrationName("/migrations/0002_todos.sql"), "0002_todos.sql");
  assert.equal(migrationName("migrations/auth/0001_auth.sql"), "0001_auth.sql");
  assert.equal(migrationName("0001_auth.sql"), "0001_auth.sql");
});

test("a file already applied from another directory does not re-apply", () => {
  // The auth-on path copies migrations/auth/0001_auth.sql into the globbed
  // directory; a database that already has it must not run it twice.
  assert.deepEqual(pendingMigrations(["/migrations/0001_auth.sql"], ["0001_auth.sql"]), []);
});

test("pending migrations are returned in name order", () => {
  assert.deepEqual(
    pendingMigrations(
      ["/migrations/0003_c.sql", "/migrations/0001_a.sql", "/migrations/0002_b.sql"],
      ["0001_a.sql"],
    ),
    [
      { name: "0002_b.sql", path: "/migrations/0002_b.sql" },
      { name: "0003_c.sql", path: "/migrations/0003_c.sql" },
    ],
  );
});

test("non-.sql entries are dropped (readdir also yields the auth/ directory)", () => {
  assert.equal(isMigrationFile("auth"), false);
  assert.deepEqual(pendingMigrations(["auth", "README.md"], []), []);
});

test("closed-test migrations are auth, invites, rate limits, and media", () => {
  const migrationsDir = join(projectRoot(), "migrations");
  assert.deepEqual(
    pendingMigrations(readdirSync(migrationsDir), []).map((item) => item.name),
    [
      "0001_auth.sql",
      "0002_closed_test.sql",
      "0003_rate_limit.sql",
      "0004_media.sql",
      "0005_media_worker_role.sql",
    ],
  );
  assert.ok(readdirSync(join(migrationsDir, "auth")).includes("0001_auth.sql"));
});

test("this workspace's auth schema copy is byte-identical to its source", () => {
  // An edited copy diverges silently: basename keying skips it on a database
  // that already ran the original, and applies it on a fresh PGLite preview.
  const pair = authSchemaCopy(projectRoot());
  if (pair === null) return; // sign-in off — nothing has been copied up
  assert.equal(
    pair.copy,
    pair.source,
    "migrations/0001_auth.sql has been edited — it must stay a verbatim copy of migrations/auth/0001_auth.sql",
  );
});

test("the copy check reads both files and catches an edit", () => {
  const root = mkdtempSync(join(tmpdir(), "auth-schema-"));
  mkdirSync(join(root, "migrations/auth"), { recursive: true });
  writeFileSync(join(root, "migrations/auth", AUTH_MIGRATION), "create table t ();\n");
  assert.equal(authSchemaCopy(root), null);

  writeFileSync(join(root, "migrations", AUTH_MIGRATION), "create table t ();\n");
  const same = authSchemaCopy(root);
  assert.equal(same.copy, same.source);

  writeFileSync(join(root, "migrations", AUTH_MIGRATION), "create table t (x int);\n");
  const drifted = authSchemaCopy(root);
  assert.notEqual(drifted.copy, drifted.source);
});

test("the media worker role is owner-approved and limited to the media tables", () => {
  const sql = readFileSync(join(projectRoot(), "migrations/0005_media_worker_role.sql"), "utf8");
  assert.equal(sql.includes("The owner must approve this file"), true);
  assert.equal(isNoTransaction(sql), true);
  assert.equal(isSkipEmbedded(sql), true);
  assert.equal(sql.includes("@@MEDIA_WORKER_DB_PASSWORD@@"), true);
  assert.match(sql, /create role media_worker/i);
  assert.match(sql, /nosuperuser/i);
  assert.match(
    sql,
    /grant select, update, delete on table media_object, media_job to media_worker/i,
  );
  assert.equal(sql.toLowerCase().includes('on table "user"'), false);
  assert.equal(sql.toLowerCase().includes("on table room"), false);
  const applied = applyMediaWorkerPassword(sql, "mediaworkerpass1");
  assert.equal(applied.includes("@@MEDIA_WORKER_DB_PASSWORD@@"), false);
  assert.equal(applied.includes("mediaworkerpass"), true);
  assert.throws(() => applyMediaWorkerPassword(sql, "short"), /owner's approval/);
  const statements = sqlStatements(applied);
  assert.equal(statements.length, 3);
  assert.match(statements[0], /create role media_worker/i);
});
