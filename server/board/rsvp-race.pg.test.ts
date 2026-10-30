import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { isNoTransaction, sqlStatements } from "../../scripts/migration-plan.mjs";
import { pgDb, type Db } from "../db.ts";
import { markAttendance, setMyRsvp } from "./rsvp.ts";

// QA #126 S3 #2: on real Postgres a first-time RSVP insert that landed while
// a close's transaction was open was deleted by the close, which said 200.
// The close now locks the gathering row first; the insert's foreign key
// waits on it, so the new RSVP survives.

async function applyMigrations(client: pg.PoolClient): Promise<void> {
  const dir = new URL("../../migrations/", import.meta.url);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    const text = await readFile(new URL(name, dir), "utf8");
    if (isNoTransaction(text)) {
      for (const statement of sqlStatements(text)) {
        try {
          await client.query(statement);
        } catch (error) {
          const createRole = /^\s*(?:--[^\n]*\n\s*)*create\s+role\s+/i.test(statement);
          const code = error && typeof error === "object" && "code" in error ? error.code : "";
          if (createRole && code === "42710") continue;
          throw error;
        }
      }
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(text);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}

async function person(db: Db, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 6)}@example.com`],
  );
  return id;
}

test("a first-time RSVP that lands during a close's transaction survives it", async (t) => {
  const url = process.env.CLAIM_POSTGRES_URL ?? "";
  if (!url) {
    if (process.env.CLAIM_POSTGRES_REQUIRED === "1") {
      throw new Error("Set CLAIM_POSTGRES_URL to the CI Postgres service.");
    }
    t.skip("Set CLAIM_POSTGRES_URL to run the RSVP close race on Postgres.");
    return;
  }
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const name = `rsvp_race_${randomBytes(4).toString("hex")}`;
  const poolUrl = new URL(url);
  poolUrl.pathname = `/${name}`;
  await admin.query(`create database ${name}`);
  const pool = new pg.Pool({ connectionString: poolUrl.toString(), max: 10 });
  pool.on("error", () => {});
  const setup = await pool.connect();
  try {
    await applyMigrations(setup);
  } finally {
    setup.release();
  }
  const db = pgDb(pool);
  try {
    const dale = await person(db, "Dale");
    const tom = await person(db, "Tom");
    const ann = await person(db, "Ann");
    const gathering = randomUUID();
    await db.query(
      `insert into public_gathering (id, title, gather_on, room_id, host_user_id) values ($1, 'Lifts', '2026-10-31', 'shop', $2)`,
      [gathering, dale],
    );
    await setMyRsvp(db, { userId: tom, gatheringId: gathering, going: true });

    let insert: Promise<unknown> | null = null;
    let insertDone = false;
    // The close's list check runs inside its transaction (on its own pool
    // connection). Ann's first RSVP starts on another connection meanwhile.
    const closed = await markAttendance(db, {
      gatheringId: gathering,
      userIds: [tom],
      close: true,
      check: async () => {
        insert = setMyRsvp(db, { userId: ann, gatheringId: gathering, going: true }).then((row) => {
          insertDone = true;
          return row;
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(insertDone, false, "Ann's insert waits for the close");
        return true;
      },
    });
    assert.equal(closed, true);
    await insert;
    const rows = await db.query<{ user_id: string; going: boolean; attended: boolean }>(
      `select user_id, going, attended from gathering_rsvp where gathering_id = $1`,
      [gathering],
    );
    const annRow = rows.find((row) => row.user_id === ann);
    assert.ok(annRow, "Ann's RSVP survives the close");
    assert.equal(annRow.going, true);
    const tomRow = rows.find((row) => row.user_id === tom);
    assert.deepEqual([tomRow?.going, tomRow?.attended], [false, true]);
  } finally {
    await pool.end();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  }
});
