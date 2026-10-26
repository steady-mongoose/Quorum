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
import { mediaWorkerPasswordSql } from "./media-worker-password.mjs";
import {
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
      "0005_rate_limit_index.sql",
      "0006_dm_e2ee.sql",
      "0007_media_worker_role.sql",
      "0008_board.sql",
      "0010_moderation.sql",
      "0011_places.sql",
      "0012_theme_groups.sql",
      "0013_room_chat.sql",
      "0014_board_ban_room.sql",
      "0015_hard_rules.sql",
      "0017_csam_hold_key.sql",
      "0018_public_gathering.sql",
      "0022_stats.sql",
    ],
  );
  assert.ok(readdirSync(join(migrationsDir, "auth")).includes("0001_auth.sql"));
});

test("migration 0010 anonymizes on its own and does not replace anonymize_board_user", () => {
  const sql = readFileSync(join(projectRoot(), "migrations/0010_moderation.sql"), "utf8");
  assert.match(sql, /Numbered 0010/);
  assert.match(sql, /create or replace function anonymize_moderation_user/);
  assert.match(sql, /create trigger anonymize_moderation_user/);
  assert.equal(/create or replace function anonymize_board_user/.test(sql), false);
  assert.equal(/create trigger anonymize_board_user/.test(sql), false);
  assert.equal(sql.includes("like_count"), false);
  assert.match(sql, /pending counsel/i);
  assert.match(sql, /365/);
  assert.match(sql, /anonymize_moderation_user/);
});

test("migration 0015 widens group and chat rules and does not replace anonymize functions", () => {
  const sql = readFileSync(join(projectRoot(), "migrations/0015_hard_rules.sql"), "utf8");
  assert.match(sql, /Numbered 0015/);
  assert.match(sql, /doxxing/);
  assert.match(sql, /blasphemy/);
  assert.match(sql, /theme_group_removal/);
  assert.match(sql, /room_chat_removal/);
  assert.match(sql, /0014 is the room-ban migration/);
  assert.equal(/create or replace function anonymize_/.test(sql), false);
  assert.equal(sql.includes("like_count"), false);
});

test("migration 0018 adds the public gathering and does not replace a function", () => {
  const sql = readFileSync(join(projectRoot(), "migrations/0018_public_gathering.sql"), "utf8");
  assert.match(sql, /Numbered 0018/);
  assert.match(sql, /create table if not exists public_gathering/i);
  assert.match(sql, /shared boolean not null default false/i);
  assert.match(sql, /title text not null/);
  assert.match(sql, /gather_on text not null/);
  assert.match(sql, /town text not null/);
  assert.match(sql, /gather_time text not null/);
  assert.match(sql, /removed boolean not null default false/i);
  assert.match(sql, /0-9a-f/);
  assert.equal(/create or replace function/i.test(sql), false);
  assert.equal(/create trigger/i.test(sql), false);
});

test("migration 0017 adds the hold key id and does not replace a function", () => {
  const sql = readFileSync(join(projectRoot(), "migrations/0017_csam_hold_key.sql"), "utf8");
  assert.match(sql, /Numbered 0017/);
  assert.match(sql, /0016 is reserved/);
  assert.match(sql, /add column if not exists key_id text not null default ''/i);
  assert.equal(/create or replace function/i.test(sql), false);
  assert.equal(/anonymize_/i.test(sql), false);
  assert.equal(/create trigger/i.test(sql), false);
});

test("migration 0011 is the places file and is not a ranking table", () => {
  const sql = readFileSync(join(projectRoot(), "migrations/0011_places.sql"), "utf8");
  assert.match(sql, /Numbered 0011/);
  assert.match(sql, /This is migration 0011/);
  assert.match(sql, /The owner must approve this file/);
  assert.match(sql, /council_approval/);
  assert.match(sql, /checklist/);
  assert.match(sql, /access_log/);
  assert.match(sql, /create or replace function anonymize_places_user/);
  assert.match(sql, /create trigger anonymize_places_user/);
  assert.equal(/create or replace function anonymize_board_user/.test(sql), false);
  assert.equal(sql.includes("like_count"), false);
  assert.equal(/\bscore\s+(integer|int|numeric|real|double|float)\b/i.test(sql), false);
  assert.equal(/create table[^;]*\brank\b/i.test(sql), false);
});

test("0014 adds the room bar column and leaves anonymize functions alone", () => {
  const sql = readFileSync(join(projectRoot(), "migrations/0014_board_ban_room.sql"), "utf8");
  assert.match(sql, /Numbered 0014/);
  assert.match(sql, /add column if not exists room_id text not null default ''/i);
  assert.match(sql, /create index if not exists board_ban_user_room_idx/i);
  assert.equal(/anonymize_/i.test(sql), false);
  assert.equal(/create or replace function/i.test(sql), false);
  assert.equal(/create trigger/i.test(sql), false);
  assert.equal(/drop trigger/i.test(sql), false);
  assert.equal(/drop function/i.test(sql), false);
});

test("0012 anonymizes group names on its own trigger", () => {
  const sql = readFileSync(join(projectRoot(), "migrations/0012_theme_groups.sql"), "utf8");
  assert.equal(/create or replace function anonymize_board_user/i.test(sql), false);
  assert.match(sql, /create or replace function anonymize_theme_group_user/i);
  assert.match(sql, /create trigger anonymize_theme_group_user/i);
  assert.match(sql, /execute function anonymize_theme_group_user/i);
  const body = sql.slice(sql.toLowerCase().indexOf("function anonymize_theme_group_user"));
  for (const table of [
    "theme_group_post",
    "theme_group_mark",
    "theme_group_removal",
    "theme_group_request",
    "theme_group_appeal",
    "theme_group_admin",
    "theme_group_steward",
    "theme_group_log",
  ]) {
    assert.match(body, new RegExp(`update ${table}\\b`, "i"), table);
  }
  assert.equal(/update board_/i.test(body), false);
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

test("the private-message migration is flagged for the owner's approval", () => {
  const text = readFileSync(join(projectRoot(), "migrations/0006_dm_e2ee.sql"), "utf8");
  assert.match(text, /owner must approve/i);
  assert.match(text, /ciphertext/i);
  assert.doesNotMatch(text, /plaintext/i);
  assert.doesNotMatch(text, /reshare/i);
  assert.doesNotMatch(text, /\blikes?\b/i);
  assert.doesNotMatch(text, /\bscore\b/i);
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
  const sql = readFileSync(join(projectRoot(), "migrations/0007_media_worker_role.sql"), "utf8");
  assert.equal(sql.includes("The owner must approve this file"), true);
  assert.equal(isNoTransaction(sql), true);
  assert.equal(isSkipEmbedded(sql), true);
  assert.equal(sql.includes("@@MEDIA_WORKER_DB_PASSWORD@@"), false);
  assert.match(sql, /create role media_worker/i);
  assert.match(sql, /nosuperuser/i);
  assert.match(
    sql,
    /grant select, update, delete on table media_object, media_job to media_worker/i,
  );
  assert.equal(sql.toLowerCase().includes('on table "user"'), false);
  assert.equal(sql.toLowerCase().includes("on table room"), false);
  const statements = sqlStatements(sql);
  const code = statements
    .join("\n")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .toLowerCase();
  assert.equal(code.includes("password"), false);
  assert.equal(statements.length, 3);
  assert.match(statements[0], /create role media_worker/i);
  const password = "mediaworkerpass1";
  const first = mediaWorkerPasswordSql(password);
  const second = mediaWorkerPasswordSql(password);
  assert.match(first, /^ALTER ROLE media_worker PASSWORD 'SCRAM-SHA-256\$/);
  assert.equal(first.includes(password), false);
  assert.notEqual(first, second);
  assert.throws(() => mediaWorkerPasswordSql("short"), /owner's approval/);
});
