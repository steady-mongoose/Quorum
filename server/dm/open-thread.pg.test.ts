import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { isNoTransaction, isSkipEmbedded, sqlStatements } from "../../scripts/migration-plan.mjs";
import { pgDb } from "../db.ts";
import { DAY, inRoom, member } from "./reach-harness.ts";
import { ROOM_MESSAGE_DAILY_STARTS, openThread } from "./store.ts";

// Real connections, so parallel opens really run at once and the advisory lock
// really waits. PGlite (open-thread-race.integration.test.ts) cannot show that.

const now = new Date("2026-10-31T12:00:00.000Z");
const long = new Date(now.getTime() - 20 * DAY);

async function applyMigrations(client: pg.PoolClient): Promise<void> {
  const dir = new URL("../../migrations/", import.meta.url);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    const text = await readFile(new URL(name, dir), "utf8");
    if (!isSkipEmbedded(text) && !isNoTransaction(text)) {
      await client.query(text);
      continue;
    }
    for (const statement of sqlStatements(text)) {
      try {
        await client.query(statement);
      } catch (error) {
        const duplicate =
          error && typeof error === "object" && "code" in error && error.code === "42710";
        if (!duplicate) throw error;
      }
    }
  }
}

test("on real Postgres, parallel opens stop at the limit and a pair race makes one thread", async (t) => {
  const url = process.env.MFA_TEST_DATABASE_URL ?? "";
  if (!url) {
    t.skip("Set MFA_TEST_DATABASE_URL to run the open-thread race on Postgres.");
    return;
  }
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const name = `dm_open_race_${randomBytes(4).toString("hex")}`;
  const poolUrl = new URL(url);
  poolUrl.pathname = `/${name}`;
  await admin.query(`create database ${name}`);
  const pool = new pg.Pool({ connectionString: poolUrl.toString(), max: 10 });
  pool.on("error", () => {});
  try {
    const setup = await pool.connect();
    try {
      await applyMigrations(setup);
    } finally {
      setup.release();
    }
    const db = pgDb(pool);
    const settled = async (label: string) => {
      const id = await member(db, label, long);
      await inRoom(db, id, "shop", long);
      return id;
    };

    const racer = await settled("TestRacer");
    const targets: string[] = [];
    for (let i = 0; i < 30; i += 1) targets.push(await settled(`TestTarget${i}`));
    const opened = await Promise.all(targets.map((id) => openThread(db, racer, id, now)));
    assert.equal(opened.filter((row) => row.ok).length, ROOM_MESSAGE_DAILY_STARTS);
    assert.ok(opened.every((row) => row.ok || row.status === 429));
    const stored = await db.query<{ n: number }>(
      `select count(*)::int as n from dm_thread where opened_by = $1`,
      [racer],
    );
    assert.equal(stored[0]?.n, ROOM_MESSAGE_DAILY_STARTS);

    for (let round = 0; round < 10; round += 1) {
      const anna = await settled(`TestAnna${round}`);
      const ben = await settled(`TestBen${round}`);
      const [first, second] = await Promise.all([
        openThread(db, anna, ben, now),
        openThread(db, ben, anna, now),
      ]);
      assert.ok(first.ok && second.ok);
      assert.equal(first.value.id, second.value.id);
    }
  } finally {
    await pool.end();
    await admin.query(`drop database if exists ${name}`);
    await admin.end();
  }
});
