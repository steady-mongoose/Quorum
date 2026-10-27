import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { isNoTransaction, isSkipEmbedded, sqlStatements } from "../../scripts/migration-plan.mjs";
import { createApp, type AppDeps } from "../http.ts";
import { pgDb, type Db } from "../db.ts";
import { trustAuthenticator } from "../mfa/test-trust.ts";

/**
 * These tests check category roles, not the second step, so each user acts
 * through a session that has already passed MFA (admin pages need it).
 */
const trusted = new WeakMap<Db, Map<string, Promise<string>>>();
function trustedSession(db: Db, userId: string): Promise<string> {
  const sessions = trusted.get(db) ?? new Map<string, Promise<string>>();
  trusted.set(db, sessions);
  let session = sessions.get(userId);
  if (!session) {
    session = trustAuthenticator(db, userId);
    sessions.set(userId, session);
  }
  return session;
}

const url = process.env.CATEGORY_POSTGRES_URL ?? "";
const now = new Date("2026-10-19T12:00:00Z");

function databaseUrl(name: string): string {
  const next = new URL(url);
  next.pathname = `/${name}`;
  return next.toString();
}

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const dir = new URL("../../migrations/", import.meta.url);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const client = await pool.connect();
  try {
    for (const name of names) {
      const sql = await readFile(new URL(name, dir), "utf8");
      if (isSkipEmbedded(sql)) continue;
      if (isNoTransaction(sql)) {
        for (const statement of sqlStatements(sql)) {
          try {
            await client.query(statement);
          } catch (error) {
            const createRole = /^\s*(?:--[^\n]*\n\s*)*create\s+role\s+/i.test(statement);
            const exists =
              error && typeof error === "object" && "code" in error && error.code === "42710";
            if (createRole && exists) continue;
            throw error;
          }
        }
        continue;
      }
      // One simple-query call runs the file, including dollar-quoted functions.
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

test("room category links on Postgres", async (t) => {
  if (!url) {
    if (process.env.GITHUB_ACTIONS) assert.fail("CATEGORY_POSTGRES_URL is required on CI");
    t.skip("CATEGORY_POSTGRES_URL is not set");
    return;
  }
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query("drop database if exists category_rules with (force)");
  await admin.query("create database category_rules");
  await admin.end();
  const pool = new pg.Pool({ connectionString: databaseUrl("category_rules"), max: 4 });
  const db = pgDb(pool);
  try {
    await applyMigrations(pool);
    const rules = await db.query<{ conname: string; confdeltype: string }>(
      `select conname, confdeltype::text
       from pg_constraint
       where conrelid = 'room_categories'::regclass and contype = 'f'
       order by conname`,
    );
    const byName = new Map(rules.map((row) => [row.conname, row.confdeltype]));
    assert.equal(byName.get("room_categories_room_id_fkey"), "c");
    assert.equal(byName.get("room_categories_category_id_fkey"), "r");

    await db.query(
      `insert into room (
         id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order
       ) values (
         'woodshop', 'Woodshop', 'A bench.', array[]::text[], array[]::text[], array[]::text[],
         'Meeting', false, false, 200
       )`,
    );
    await db.query(
      `insert into room_categories (room_id, category_id) values ('woodshop', 'churches')`,
    );
    await db.query(`delete from room where id = 'woodshop'`);
    const gone = await db.query<{ room_id: string }>(
      `select room_id from room_categories where room_id = 'woodshop'`,
    );
    assert.equal(gone.length, 0);
    await assert.rejects(
      () => db.query(`delete from categories where slug = 'churches'`),
      (error: unknown) =>
        Boolean(error && typeof error === "object" && "code" in error && error.code === "23503"),
    );

    const steward = randomUUID();
    await db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'Tom', 'tom@example.com', true, $2, $2)`,
      [steward, now],
    );
    for (const role of ["member", "steward"] as const) {
      await db.query(
        `insert into access_log
         (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
         values ($1, $2, 'Tom', $3, $4, 'grant', 'test', 'test', 'test', 'Granted for the test.', $5)`,
        [randomUUID(), steward, role, role === "steward" ? "shop" : "", now],
      );
    }
    const handler = createApp({
      db,
      origins: ["http://localhost:8080"],
      now: () => now,
      createAccount: async () => ({ id: "unused" }),
      signIn: async () => ({ ok: false, status: 500, message: "unused" }),
      readSession: async (headers) => {
        const id = headers.get("x-user-id");
        if (!id) return null;
        return { id, name: "Tom", email: "tom@example.com", sessionId: await trustedSession(db, id) };
      },
      forwardAuth: async () => new Response(null, { status: 500 }),
    } satisfies AppDeps);
    const cleared = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": steward },
        body: JSON.stringify({ categoryIds: [] }),
      }),
    );
    assert.equal(cleared.status, 400);
    const kept = await db.query<{ category_id: string }>(
      `select category_id from room_categories where room_id = 'shop' order by category_id`,
    );
    assert.deepEqual(
      kept.map((row) => row.category_id),
      ["business-trades"],
    );
    const listed = await handler(
      new Request("http://127.0.0.1:8787/api/categories/business-trades", {
        headers: { "x-user-id": steward },
      }),
    );
    assert.equal(listed.status, 200);
    const page = (await listed.json()) as { rooms: { id: string; categoryIds: string[] }[] };
    assert.equal(
      page.rooms.some((room) => room.id === "shop"),
      true,
    );
  } finally {
    await pool.end();
    const cleanup = new pg.Client({ connectionString: url });
    await cleanup.connect();
    await cleanup.query("drop database if exists category_rules with (force)");
    await cleanup.end();
  }
});
