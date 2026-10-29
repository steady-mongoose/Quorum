import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { isNoTransaction, sqlStatements } from "../../scripts/migration-plan.mjs";
import { LAST_STEWARD_ERROR, liveStewards } from "../../src/lib/board/access-rules.ts";
import { pgDb, type Db } from "../db.ts";
import { grantAccess, readAccessLog } from "./places-store.ts";
import { banMember } from "./store.ts";

// QA, Oct 27, 2026: two steward revokes for one room both returned 200 and left
// it with no steward. Every removal path now locks the room's steward rows.

const now = new Date("2026-10-27T15:00:00.000Z");
const ROOM = "county";

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

async function person(db: Db, name: string, grants: { role: string; room: string }[]) {
  const id = randomUUID();
  const email = `${name.toLowerCase()}-${id.slice(0, 6)}@example.com`;
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, email, now],
  );
  for (const grant of grants) {
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, $3, $4, $5, 'grant', 'test', 'test', 'test', 'Granted for the test.', $6)`,
      [randomUUID(), id, name, grant.role, grant.room, new Date(now.getTime() - 60_000)],
    );
  }
  return { id, email, name };
}

async function stewardsLeft(db: Db): Promise<string[]> {
  return liveStewards(await readAccessLog(db), ROOM);
}

test("concurrent steward removals for one room never leave it without a steward", async (t) => {
  const url = process.env.CLAIM_POSTGRES_URL ?? "";
  if (!url) {
    if (process.env.CLAIM_POSTGRES_REQUIRED === "1") {
      throw new Error("Set CLAIM_POSTGRES_URL to the CI Postgres service.");
    }
    t.skip("Set CLAIM_POSTGRES_URL to run the steward race on Postgres.");
    return;
  }
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const name = `steward_race_${randomBytes(4).toString("hex")}`;
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
    const josh = await person(db, "Josh", [
      { role: "member", room: "" },
      { role: "admin", room: "" },
    ]);
    await db.query(
      `insert into member_role (user_id, is_admin, is_council, is_council_chair)
       values ($1, true, true, true)`,
      [josh.id],
    );
    const pair = async (label: string) => ({
      tom: await person(db, `Tom${label}`, [
        { role: "member", room: "" },
        { role: "steward", room: ROOM },
      ]),
      ann: await person(db, `Ann${label}`, [
        { role: "member", room: "" },
        { role: "steward", room: ROOM },
      ]),
    });
    const revoke = (email: string, ms: number) =>
      grantAccess(db, {
        userId: josh.id,
        action: "revoke",
        email,
        roomId: ROOM,
        inviterEmail: "",
        stewardEmail: "",
        role: "steward",
        now: new Date(now.getTime() + ms),
      });

    // Round 1: two revokes at once, as in QA's race log.
    for (let round = 0; round < 5; round += 1) {
      await db.query(`delete from access_log where room_id = $1`, [ROOM]);
      const { tom, ann } = await pair(`r${round}`);
      const results = await Promise.all([revoke(tom.email, 1000), revoke(ann.email, 1001)]);
      const ok = results.filter((result) => result.ok);
      assert.equal(ok.length, 1, `round ${round}: exactly one revoke passes`);
      const refused = results.find((result) => !result.ok);
      assert.equal(refused && !refused.ok ? refused.error : "", LAST_STEWARD_ERROR);
      assert.equal((await stewardsLeft(db)).length, 1, `round ${round}: one steward stays`);
    }

    // Round 2: a revoke and a site bar at once.
    await db.query(`delete from access_log where room_id = $1`, [ROOM]);
    const { tom, ann } = await pair("ban");
    const [revoked, banned] = await Promise.all([
      revoke(tom.email, 2000),
      banMember(db, {
        userId: josh.id,
        email: ann.email,
        name: "Josh",
        reason: "threat",
        now: new Date(now.getTime() + 2001),
      }),
    ]);
    assert.equal([revoked.ok, banned.ok].filter(Boolean).length, 1, "only one removal passes");
    const left = await stewardsLeft(db);
    const bars = await db.query<{ user_id: string }>(`select user_id from board_ban`);
    const standing = left.filter((id) => !bars.some((bar) => bar.user_id === id));
    assert.equal(standing.length, 1, "one steward still stands");
  } finally {
    await pool.end();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  }
});
