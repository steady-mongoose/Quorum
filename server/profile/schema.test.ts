import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import test from "node:test";
import { isSkipEmbedded } from "../../scripts/migration-plan.mjs";
import { openTestDb } from "../closed-test/test-db.ts";
import { INTERESTS } from "./interests.ts";
import { TOWNS } from "./towns.ts";

test("0024 backfills display name from the vouched name, then requires it", async () => {
  const pg = new PGlite();
  await pg.waitReady;
  const dir = new URL("../../migrations/", import.meta.url);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    if (name === "0024_member_profile.sql") continue;
    const sql = await readFile(new URL(name, dir), "utf8");
    if (isSkipEmbedded(sql)) continue;
    await pg.exec(sql);
  }
  const id = randomUUID();
  await pg.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, 'Joshua Hale', 'joshua@example.com', true, now(), now())`,
    [id],
  );
  await pg.query(`insert into members (user_id, gender) values ($1, 'man')`, [id]);
  await pg.exec(await readFile(new URL("0024_member_profile.sql", dir), "utf8"));
  const row = await pg.query<{ display_name: string }>(
    `select display_name from members where user_id = $1`,
    [id],
  );
  assert.equal(row.rows[0]?.display_name, "Joshua Hale");
  const nullable = await pg.query<{ is_nullable: string }>(
    `select is_nullable from information_schema.columns
     where table_name = 'members' and column_name = 'display_name'`,
  );
  assert.equal(nullable.rows[0]?.is_nullable, "NO");
  await pg.exec(await readFile(new URL("0024_member_profile.sql", dir), "utf8"));
  await pg.close();
});

test("0024 stores a profile scope and refuses a profile gif", async () => {
  const sql = readFileSync(
    new URL("../../migrations/0024_member_profile.sql", import.meta.url),
    "utf8",
  );
  for (const town of TOWNS) assert.match(sql, new RegExp(`'${town.id}'`));
  for (const interest of INTERESTS) assert.match(sql, new RegExp(`'${interest.id}'`));
  const { db, close } = await openTestDb();
  try {
    const id = randomUUID();
    await db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'Josh', 'josh@example.com', true, now(), now())`,
      [id],
    );
    const mediaId = randomUUID();
    await db.query(
      `insert into media_object (
         id, owner_user_id, scope, kind, status, content_type, byte_size,
         room_id, post_id, encryption, key_envelope, upload_key
       ) values ($1, $2, 'profile', 'image', 'pending', 'image/jpeg', 10, '', '', 'server-processed', '', $3)`,
      [mediaId, id, `incoming/${mediaId}`],
    );
    await assert.rejects(() =>
      db.query(
        `insert into media_object (
           id, owner_user_id, scope, kind, status, content_type, byte_size,
           room_id, post_id, encryption, key_envelope, upload_key
         ) values ($1, $2, 'profile', 'image', 'pending', 'image/gif', 10, '', '', 'server-processed', '', $3)`,
        [randomUUID(), id, `incoming/${randomUUID()}`],
      ),
    );
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_name in ('member_link', 'profile_visibility')`,
    );
    assert.equal(tables.length, 2);
  } finally {
    await close();
  }
});
