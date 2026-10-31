import assert from "node:assert/strict";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { DAY, call, inRoom, member, testApp } from "./reach-harness.ts";
import { ROOM_DAILY_LIMIT, ROOM_MESSAGE_DAILY_STARTS } from "./store.ts";

// QA on the DM routes: 20 parallel opens made 20 conversations with a limit of
// 5, and two people opening the same pair gave one a 400 with Postgres's text.
//
// What this proves: PGlite has one connection and runs one transaction at a
// time, so the advisory lock never waits here. The gates do interleave: every
// open reads the old count before any insert, which is how QA got 20. So these
// tests prove the count is taken again inside the insert's transaction and the
// pair race ends in one thread. open-thread.pg.test.ts is the one that puts the
// lock itself under real concurrent connections.

const now = new Date("2026-10-31T12:00:00.000Z");
const long = new Date(now.getTime() - 20 * DAY);
const ROOM = "shop";

async function settled(db: Db, name: string): Promise<string> {
  const id = await member(db, name, long);
  await inRoom(db, id, ROOM, long);
  return id;
}

const threadsBy = async (db: Db, userId: string) =>
  (
    await db.query<{ n: number }>(`select count(*)::int as n from dm_thread where opened_by = $1`, [
      userId,
    ])
  )[0]?.n;

test("parallel opens stop at the daily limit and the rest get its plain words", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = testApp(db, () => now);
    const racer = await settled(db, "TestRacer");
    const targets: string[] = [];
    for (let i = 0; i < 20; i += 1) targets.push(await settled(db, `TestTarget${i}`));
    const answers = await Promise.all(
      targets.map((id) => call(handler, racer, "POST", "/api/dm/threads", { userId: id })),
    );
    assert.equal(answers.filter((a) => a.status === 201).length, ROOM_MESSAGE_DAILY_STARTS);
    const refused = answers.filter((a) => a.status !== 201);
    assert.equal(refused.length, 20 - ROOM_MESSAGE_DAILY_STARTS);
    for (const answer of refused) {
      assert.equal(answer.status, 429);
      assert.deepEqual(answer.body, { error: ROOM_DAILY_LIMIT });
    }
    assert.equal(await threadsBy(db, racer), ROOM_MESSAGE_DAILY_STARTS);
  } finally {
    await close();
  }
});

test("two people opening the same pair both get the one conversation", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = testApp(db, () => now);
    const anna = await settled(db, "TestAnna");
    const ben = await settled(db, "TestBen");
    const [first, second] = await Promise.all([
      call(handler, anna, "POST", "/api/dm/threads", { userId: ben }),
      call(handler, ben, "POST", "/api/dm/threads", { userId: anna }),
    ]);
    assert.equal(first?.status, 201);
    assert.equal(second?.status, 201);
    const id = (answer: typeof first) => (answer?.body as { id: string }).id;
    assert.equal(id(first), id(second));
    assert.deepEqual(await db.query(`select count(*)::int as n from dm_thread`), [{ n: 1 }]);
    // Only one of them is charged a start.
    assert.equal((await threadsBy(db, anna)) + (await threadsBy(db, ben)), 1);
  } finally {
    await close();
  }
});

test("a double tap on the fifth start gets the conversation, not the limit", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = testApp(db, () => now);
    const anna = await settled(db, "TestAnna");
    for (let i = 0; i < ROOM_MESSAGE_DAILY_STARTS - 1; i += 1) {
      const other = await settled(db, `TestEarlier${i}`);
      const opened = await call(handler, anna, "POST", "/api/dm/threads", { userId: other });
      assert.equal(opened.status, 201);
    }
    const ben = await settled(db, "TestBen");
    const tap = () => call(handler, anna, "POST", "/api/dm/threads", { userId: ben });
    const [first, second] = await Promise.all([tap(), tap()]);
    assert.deepEqual([first?.status, second?.status], [201, 201]);
    assert.deepEqual(first?.body, second?.body);
    assert.equal(await threadsBy(db, anna), ROOM_MESSAGE_DAILY_STARTS);
  } finally {
    await close();
  }
});

test("a database fault on a DM route is a plain 500, never Postgres's own text", async () => {
  const { db, close } = await openTestDb();
  const realError = console.error;
  console.error = () => {};
  try {
    const anna = await settled(db, "TestAnna");
    const ben = await settled(db, "TestBen");
    const raw = 'duplicate key value violates unique constraint "dm_thread_user_a_user_b_key"';
    const failing = (inner: Db): Db => ({
      ...inner,
      async query<T>(text: string, params?: unknown[]) {
        if (text.includes("select id from dm_thread")) throw new Error(raw);
        return inner.query<T>(text, params);
      },
      transaction: (fn) => inner.transaction((tx) => fn(failing(tx))),
    });
    const handler = testApp(failing(db), () => now);
    const answer = await call(handler, anna, "POST", "/api/dm/threads", { userId: ben });
    assert.equal(answer.status, 500);
    assert.doesNotMatch(JSON.stringify(answer.body), /constraint|duplicate/);
  } finally {
    console.error = realError;
    await close();
  }
});
