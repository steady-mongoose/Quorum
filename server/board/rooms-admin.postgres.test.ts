import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { isNoTransaction, isSkipEmbedded, sqlStatements } from "../../scripts/migration-plan.mjs";
import { pgDb } from "../db.ts";
import { moveRoom } from "./rooms-admin.ts";

const url = process.env.CATEGORY_POSTGRES_URL ?? "";
const now = new Date("2026-10-27T15:00:00Z");

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

test("concurrent category moves on Postgres never merge", async (t) => {
  if (!url) {
    if (process.env.GITHUB_ACTIONS) assert.fail("CATEGORY_POSTGRES_URL is required on CI");
    t.skip("CATEGORY_POSTGRES_URL is not set");
    return;
  }
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query("drop database if exists rooms_admin_race with (force)");
  await admin.query("create database rooms_admin_race");
  await admin.end();
  const pool = new pg.Pool({ connectionString: databaseUrl("rooms_admin_race"), max: 12 });
  const db = pgDb(pool);
  try {
    await applyMigrations(pool);
    const ids = [randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries()) {
      const name = index === 0 ? "Ada" : "Bea";
      await db.query(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ($1, $2, $3, true, $4, $4)`,
        [id, name, `${id}@example.com`, now],
      );
      for (const role of ["member", "admin"]) {
        await db.query(
          `insert into access_log
           (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
           values ($1, $2, $3, $4, '', 'grant', 'test', 'test', 'test', 'For the test.', $5)`,
          [randomUUID(), id, name, role, now],
        );
      }
    }
    for (let round = 0; round < 10; round += 1) {
      const results = await Promise.all([
        moveRoom(db, { userId: ids[0]!, userName: "Ada", id: "shop", categoryIds: ["civic"], now }),
        moveRoom(db, {
          userId: ids[1]!,
          userName: "Bea",
          id: "shop",
          categoryIds: ["county", "churches"],
          now,
        }),
      ]);
      assert.ok(results.every((result) => result.ok));
      const links = await db.query<{ category_id: string }>(
        `select category_id from room_categories where room_id = 'shop' order by category_id`,
      );
      const got = links.map((row) => row.category_id).join(",");
      assert.ok(got === "civic" || got === "churches,county", `merged: ${got}`);
    }

    // With expectedBefore, the second of two racing saves gets 409.
    await moveRoom(db, {
      userId: ids[0]!,
      userName: "Ada",
      id: "shop",
      categoryIds: ["civic"],
      now,
    });
    const raced = await Promise.all([
      moveRoom(db, {
        userId: ids[0]!,
        userName: "Ada",
        id: "shop",
        categoryIds: ["county"],
        expectedBefore: ["civic"],
        now,
      }),
      moveRoom(db, {
        userId: ids[1]!,
        userName: "Bea",
        id: "shop",
        categoryIds: ["churches"],
        expectedBefore: ["civic"],
        now,
      }),
    ]);
    const statuses = raced.map((result) => (result.ok ? 200 : result.status)).sort();
    assert.deepEqual(statuses, [200, 409]);
  } finally {
    await pool.end();
  }
});
