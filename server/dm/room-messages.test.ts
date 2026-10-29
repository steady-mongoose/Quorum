import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { joinRoom } from "../board/places-store.ts";
import {
  BLOCKED,
  NOT_REACHABLE,
  ROOM_DAILY_LIMIT,
  ROOM_MESSAGE_DAILY_STARTS,
  ROOM_WAIT,
  blockMember,
  listBlocked,
  listPeers,
  mayMessage,
  memberMessageStates,
  openThread,
  rememberNamedAccounts,
  recordAttendance,
  unblockMember,
} from "./store.ts";

const now = new Date("2026-10-29T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

async function person(db: Db, name: string, roles: [string, string][] = []): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`, daysAgo(30)],
  );
  for (const [role, roomId] of [["member", ""] as [string, string], ...roles]) {
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, $3, $4, $5, 'grant', 'test', 'test', 'test', 'Granted for the test.', $6)`,
      [randomUUID(), id, name, role, roomId, daysAgo(30)],
    );
  }
  return id;
}

async function joined(db: Db, userId: string, roomId: string, at: Date): Promise<void> {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     select $1, u.id, u.name, 'member', $2, 'grant', 'test', 'test', 'test', 'Invited for the test.', $3
     from "user" u where u.id = $4`,
    [randomUUID(), roomId, at, userId],
  );
  await db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, $2, $3)`, [
    userId,
    roomId,
    at,
  ]);
}

async function meet(db: Db, host: string, guest: string): Promise<void> {
  const names = await db.query<{ id: string; name: string }>(
    `select id, name from "user" where id in ($1, $2)`,
    [host, guest],
  );
  const hostName = names.find((row) => row.id === host)?.name ?? "";
  const postId = randomUUID();
  await db.query(
    `insert into board_post (
       id, room_id, author_user_id, author_name, type, claim, came, card_id, created_at
     ) values ($1, 'shop', $2, $3, 'hosted', 'The framing night went well and the next one is set.', $4, 's-framing', $5)`,
    [postId, host, hostName, names.map((row) => row.name), now],
  );
  await rememberNamedAccounts(db, postId);
  for (const userId of [host, guest]) {
    assert.equal((await recordAttendance(db, userId, now, ["s-framing"])).ok, true);
  }
}

test("two members of the same room can message each other once the opener has been in it three days", async () => {
  const { db, close } = await openTestDb();
  try {
    const anna = await person(db, "Anna");
    const ben = await person(db, "Ben");
    const cora = await person(db, "Cora");
    await joined(db, anna, "baptist", daysAgo(10));
    await joined(db, ben, "baptist", daysAgo(1));

    // Ben joined yesterday. He cannot start a conversation through the room yet.
    const early = await openThread(db, ben, anna, now);
    assert.deepEqual(early.ok ? null : [early.status, early.error], [403, ROOM_WAIT]);

    // Anna has been in the room ten days. She can start one, and Ben can answer it.
    const opened = await openThread(db, anna, ben, now);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const stored = await db.query<{ opened_by: string; opened_via: string }>(
      `select opened_by, opened_via from dm_thread where id = $1`,
      [opened.value.id],
    );
    assert.deepEqual(stored[0], { opened_by: anna, opened_via: "room" });
    assert.deepEqual(await mayMessage(db, ben, anna, now), { ok: true, via: "room" });
    const reopened = await openThread(db, ben, anna, now);
    assert.equal(reopened.ok && reopened.value.id, opened.value.id);

    // Cora is in no room with either of them.
    await joined(db, cora, "shop", daysAgo(10));
    const outside = await openThread(db, cora, anna, now);
    assert.deepEqual(outside.ok ? null : [outside.status, outside.error], [403, NOT_REACHABLE]);

    // The room path does not add anyone to the list of people you have met.
    assert.deepEqual(await listPeers(db, anna), []);
  } finally {
    await close();
  }
});

test("a steward of the room does not wait three days", async () => {
  const { db, close } = await openTestDb();
  try {
    const steward = await person(db, "Pastor", [["steward", "baptist"]]);
    const newcomer = await person(db, "Newcomer");
    await joined(db, steward, "baptist", now);
    await joined(db, newcomer, "baptist", now);
    assert.equal((await openThread(db, steward, newcomer, now)).ok, true);
  } finally {
    await close();
  }
});

test("leaving the room ends the room path, for new and open conversations", async () => {
  const { db, close } = await openTestDb();
  try {
    const anna = await person(db, "Anna");
    const ben = await person(db, "Ben");
    await joined(db, anna, "shop", daysAgo(10));
    await joined(db, ben, "shop", daysAgo(10));
    assert.equal((await openThread(db, anna, ben, now)).ok, true);
    assert.equal((await joinRoom(db, { userId: ben, roomId: "shop", now, leave: true })).ok, true);
    assert.deepEqual(await mayMessage(db, anna, ben, now), {
      ok: false,
      status: 403,
      error: NOT_REACHABLE,
    });
    assert.deepEqual(await mayMessage(db, ben, anna, now), {
      ok: false,
      status: 403,
      error: NOT_REACHABLE,
    });
  } finally {
    await close();
  }
});

test("a member starts at most five conversations a day through rooms; meetings do not count", async () => {
  const { db, close } = await openTestDb();
  try {
    const anna = await person(db, "Anna");
    await joined(db, anna, "shop", daysAgo(10));
    const others: string[] = [];
    for (let i = 0; i < ROOM_MESSAGE_DAILY_STARTS + 1; i += 1) {
      const other = await person(db, `Member${i}`);
      await joined(db, other, "shop", daysAgo(10));
      others.push(other);
    }
    for (const other of others.slice(0, ROOM_MESSAGE_DAILY_STARTS)) {
      assert.equal((await openThread(db, anna, other, now)).ok, true);
    }
    const last = others[ROOM_MESSAGE_DAILY_STARTS] ?? "";
    const capped = await openThread(db, anna, last, now);
    assert.deepEqual(capped.ok ? null : [capped.status, capped.error], [429, ROOM_DAILY_LIMIT]);

    // Someone she met at a gathering is not held to the room limit.
    const friend = await person(db, "Friend");
    await meet(db, anna, friend);
    assert.equal((await openThread(db, anna, friend, now)).ok, true);

    // An open conversation keeps going, and the next day she can start more.
    assert.deepEqual(await mayMessage(db, anna, others[0] ?? "", now), { ok: true, via: "room" });
    const tomorrow = new Date(now.getTime() + DAY + 1000);
    assert.equal((await openThread(db, anna, last, tomorrow)).ok, true);
  } finally {
    await close();
  }
});

test("a block stops messages both ways, from a room or a meeting, until it is lifted", async () => {
  const { db, close } = await openTestDb();
  try {
    const anna = await person(db, "Anna");
    const ben = await person(db, "Ben");
    await joined(db, anna, "shop", daysAgo(10));
    await joined(db, ben, "shop", daysAgo(10));
    await meet(db, anna, ben);
    assert.deepEqual(
      (await listPeers(db, anna)).map((peer) => peer.id),
      [ben],
    );

    assert.equal((await blockMember(db, anna, ben, now)).ok, true);
    assert.equal((await blockMember(db, anna, ben, now)).ok, true, "blocking twice is fine");
    for (const [from, to] of [
      [anna, ben],
      [ben, anna],
    ] as const) {
      assert.deepEqual(await mayMessage(db, from, to, now), {
        ok: false,
        status: 403,
        error: BLOCKED,
      });
      const opened = await openThread(db, from, to, now);
      assert.deepEqual(opened.ok ? null : [opened.status, opened.error], [403, BLOCKED]);
    }
    assert.deepEqual(await listPeers(db, anna), []);
    assert.deepEqual(await listPeers(db, ben), []);
    assert.deepEqual(
      (await listBlocked(db, anna)).map((row) => row.id),
      [ben],
    );
    assert.deepEqual(await listBlocked(db, ben), [], "Ben is not told who blocked him");

    // Only the blocker can lift it.
    assert.equal((await unblockMember(db, ben, anna)).ok, true);
    assert.equal((await mayMessage(db, ben, anna, now)).ok, false);
    assert.equal((await unblockMember(db, anna, ben)).ok, true);
    assert.deepEqual(await mayMessage(db, ben, anna, now), { ok: true, via: "meeting" });

    const self = await blockMember(db, anna, anna, now);
    assert.equal(self.ok, false);
    const nobody = await blockMember(db, anna, randomUUID(), now);
    assert.deepEqual(nobody.ok ? null : nobody.status, 404);
  } finally {
    await close();
  }
});

test("the member list offers Message where the server would allow it, and hides only your own block", async () => {
  const { db, close } = await openTestDb();
  try {
    const anna = await person(db, "Anna");
    const bea = await person(db, "Bea");
    const cal = await person(db, "Cal");
    const dee = await person(db, "Dee");
    const eli = await person(db, "Eli");
    for (const id of [anna, bea, cal, dee, eli]) await joined(db, id, "shop", daysAgo(10));
    await blockMember(db, anna, cal, now);
    await blockMember(db, dee, anna, now);
    const states = await memberMessageStates(db, anna, [anna, bea, cal, dee, eli], now);
    assert.equal(states.has(anna), false);
    assert.equal(states.get(bea), "open");
    assert.equal(states.get(cal), "none");
    // Dee blocked Anna: the button stays; the server refuses when she opens it.
    assert.equal(states.get(dee), "open");
    const refused = await openThread(db, anna, dee, now);
    assert.deepEqual(refused.ok ? null : [refused.status, refused.error], [403, BLOCKED]);

    // A member who has not posted gets the button like anyone else; nothing here reads posts.
    // New to the room: the wait line, not a button.
    const new1 = await person(db, "Newt");
    await joined(db, new1, "shop", daysAgo(1));
    assert.equal((await memberMessageStates(db, new1, [bea], now)).get(bea), "wait");

    // Today's starts used up: new conversations hide, open ones stay.
    const others: string[] = [];
    for (let i = 0; i < ROOM_MESSAGE_DAILY_STARTS; i += 1) {
      const other = await person(db, `Started${i}`);
      await joined(db, other, "shop", daysAgo(10));
      assert.equal((await openThread(db, anna, other, now)).ok, true);
      others.push(other);
    }
    const capped = await memberMessageStates(db, anna, [bea, others[0] ?? ""], now);
    assert.equal(capped.get(bea), "none");
    assert.equal(capped.get(others[0] ?? ""), "open");
  } finally {
    await close();
  }
});
