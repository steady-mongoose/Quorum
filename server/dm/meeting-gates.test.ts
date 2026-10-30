import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import {
  BLOCKED,
  NOT_REACHABLE,
  blockMember,
  listPeers,
  mayMessage,
  memberMessageStates,
  claimBundle,
  openThread,
  postMessage,
  previewBundle,
  rememberNamedAccounts,
  recordAttendance,
  sharesMeeting,
} from "./store.ts";

import type { MessageWire } from "../../src/lib/e2ee/protocol.ts";
import { dmCallMember } from "../calls/dm-membership.ts";

// The "met at a meeting" route must apply the same bar, ban, audience and block
// gates as the shared-room route, for the sender and for the recipient, and
// refuse with the same words as someone they never met.

const now = new Date("2026-10-29T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);
const ROOM = "shop";

async function person(db: Db, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`, daysAgo(30)],
  );
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $4)`,
    [randomUUID(), id, name, daysAgo(30)],
  );
  return id;
}

async function joined(db: Db, userId: string, roomId: string, at: Date): Promise<void> {
  await db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, $2, $3)`, [
    userId,
    roomId,
    at,
  ]);
}

async function gender(db: Db, userId: string, value: "man" | "woman"): Promise<void> {
  await db.query(
    `insert into members (user_id, display_name, gender, gender_confirmed_at)
     values ($1, 'Test', $2, $3)`,
    [userId, value, daysAgo(20)],
  );
}

/** Host and guest met at a meeting in ROOM, and both confirmed it. */
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
     ) values ($1, $2, $3, $4, 'hosted', 'The framing night went well and the next one is set.', $5, 's-gates', $6)`,
    [postId, ROOM, host, hostName, names.map((row) => row.name), now],
  );
  await rememberNamedAccounts(db, postId);
  for (const userId of [host, guest]) {
    assert.equal((await recordAttendance(db, userId, now, ["s-gates"])).ok, true);
  }
}

async function ban(db: Db, userId: string, roomId: string, until = now.getTime() + 10 * DAY) {
  await db.query(
    `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, room_id)
     values ($1, $2, 'x', 'threat', 'test', 1, $3, $4)`,
    [randomUUID(), userId, new Date(until), roomId],
  );
}

/** A later revoke of the member grant. Not a ban: the account is simply no longer a member. */
async function revoke(db: Db, userId: string): Promise<void> {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, 'x', 'member', '', 'revoke', 'test', 'test', 'test', 'Revoked for the test.', $3)`,
    [randomUUID(), userId, daysAgo(1)],
  );
}

async function grantAdmin(db: Db, userId: string): Promise<void> {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, 'x', 'admin', '', 'grant', 'test', 'test', 'test', 'Admin for the test.', $3)`,
    [randomUUID(), userId, daysAgo(2)],
  );
}

async function draft(db: Db, roomId: string): Promise<void> {
  await db.query(`update room set status = 'draft' where id = $1`, [roomId]);
}

type Gate = {
  name: string;
  /** Set up after the meeting, against `who`. */
  apply: (db: Db, who: string) => Promise<void>;
};

const GATES: Gate[] = [
  { name: "a board-wide ban", apply: (db, who) => ban(db, who, "") },
  { name: "a bar from the meeting's room", apply: (db, who) => ban(db, who, ROOM) },
  {
    name: "the room's audience",
    apply: async (db, who) => {
      // The room became men-only after the meeting; `who` is a woman.
      await db.query(`update room set audience = 'men' where id = $1`, [ROOM]);
      await db.query(`update members set gender = 'woman' where user_id = $1`, [who]);
    },
  },
  { name: "a revoked board membership", apply: (db, who) => revoke(db, who) },
  // Room-wide, so the side only says whose turn it is to send.
  { name: "the meeting's room moved to draft", apply: (db) => draft(db, ROOM) },
];

async function setup(db: Db) {
  const anna = await person(db, "Anna");
  const ben = await person(db, "Ben");
  const stranger = await person(db, "Stranger");
  for (const id of [anna, ben, stranger]) await gender(db, id, "man");
  await meet(db, anna, ben);
  return { anna, ben, stranger };
}

test("the meeting route still allows a clean pair, both ways", async () => {
  const { db, close } = await openTestDb();
  try {
    const { anna, ben } = await setup(db);
    assert.deepEqual(await mayMessage(db, anna, ben, now), { ok: true, via: "meeting" });
    assert.deepEqual(await mayMessage(db, ben, anna, now), { ok: true, via: "meeting" });
    assert.equal(await sharesMeeting(db, anna, ben, now), true);
    assert.deepEqual((await listPeers(db, anna, now)).map((peer) => peer.id), [ben]);
    assert.equal((await memberMessageStates(db, anna, [ben], now)).get(ben), "open");
    assert.equal((await openThread(db, anna, ben, now)).ok, true);
  } finally {
    await close();
  }
});

for (const gate of GATES) {
  for (const side of ["recipient", "sender"] as const) {
    test(`the meeting route refuses ${gate.name} on the ${side}`, async () => {
      const { db, close } = await openTestDb();
      try {
        const { anna, ben, stranger } = await setup(db);
        // Anna sends to Ben. The gate lands on Ben (recipient) or Anna (sender).
        await gate.apply(db, side === "recipient" ? ben : anna);
        const never = await mayMessage(db, anna, stranger, now);
        assert.deepEqual(never, { ok: false, status: 403, error: NOT_REACHABLE });

        // Same refusal as someone she never met: nothing says which gate failed.
        assert.deepEqual(await mayMessage(db, anna, ben, now), never);
        assert.deepEqual(await mayMessage(db, anna, ben, now, { starting: true }), never);
        assert.deepEqual(await mayMessage(db, ben, anna, now), never);
        assert.equal(await sharesMeeting(db, anna, ben, now), false);
        const opened = await openThread(db, anna, ben, now);
        assert.deepEqual(opened.ok ? null : [opened.status, opened.error], [403, NOT_REACHABLE]);
        const back = await openThread(db, ben, anna, now);
        assert.deepEqual(back.ok ? null : [back.status, back.error], [403, NOT_REACHABLE]);
        assert.equal((await listPeers(db, anna, now)).some((peer) => peer.id === ben), false);
        assert.equal((await listPeers(db, ben, now)).some((peer) => peer.id === anna), false);
        assert.equal((await memberMessageStates(db, anna, [ben], now)).get(ben), "none");
        assert.equal((await memberMessageStates(db, ben, [anna], now)).get(anna), "none");
      } finally {
        await close();
      }
    });
  }
}

for (const side of ["recipient", "sender"] as const) {
  test(`the meeting route refuses a block by the ${side}`, async () => {
    const { db, close } = await openTestDb();
    try {
      const { anna, ben } = await setup(db);
      if (side === "recipient") await blockMember(db, ben, anna, now);
      else await blockMember(db, anna, ben, now);
      assert.deepEqual(await mayMessage(db, anna, ben, now), {
        ok: false,
        status: 403,
        error: BLOCKED,
      });
      const opened = await openThread(db, anna, ben, now);
      assert.deepEqual(opened.ok ? null : [opened.status, opened.error], [403, BLOCKED]);
      assert.deepEqual(await listPeers(db, anna, now), []);
    } finally {
      await close();
    }
  });
}

test("a lapsed bar, or a bar in another room, does not stop the meeting route", async () => {
  const { db, close } = await openTestDb();
  try {
    const { anna, ben } = await setup(db);
    await ban(db, ben, ROOM, now.getTime() - DAY);
    await ban(db, ben, "baptist");
    await ban(db, anna, "coop");
    assert.deepEqual(await mayMessage(db, anna, ben, now), { ok: true, via: "meeting" });
    assert.deepEqual((await listPeers(db, anna, now)).map((peer) => peer.id), [ben]);
  } finally {
    await close();
  }
});

test("a meeting room's audience that lets both in still allows it", async () => {
  const { db, close } = await openTestDb();
  try {
    const { anna, ben } = await setup(db);
    await db.query(`update room set audience = 'men' where id = $1`, [ROOM]);
    assert.deepEqual(await mayMessage(db, anna, ben, now), { ok: true, via: "meeting" });
  } finally {
    await close();
  }
});

test("the shared-room route is unchanged when only the meeting fails its gate", async () => {
  const { db, close } = await openTestDb();
  try {
    const { anna, ben } = await setup(db);
    await joined(db, anna, "baptist", daysAgo(10));
    await joined(db, ben, "baptist", daysAgo(10));
    // Ben is barred where they met, but not in the room they share.
    await ban(db, ben, ROOM);
    assert.deepEqual(await mayMessage(db, anna, ben, now), { ok: true, via: "room" });
    assert.deepEqual(await mayMessage(db, anna, ben, now, { starting: true }), {
      ok: true,
      via: "room",
    });
    assert.equal((await memberMessageStates(db, anna, [ben], now)).get(ben), "open");
    // A board-wide ban stops both routes, with the same words.
    await ban(db, ben, "");
    assert.deepEqual(await mayMessage(db, anna, ben, now), {
      ok: false,
      status: 403,
      error: NOT_REACHABLE,
    });
  } finally {
    await close();
  }
});

/** A well-formed message that reaches the gate; it is never stored. */
function wire(threadId: string): MessageWire {
  return {
    threadId,
    messageId: randomUUID(),
    senderDeviceId: randomUUID(),
    bodyCiphertext: "x",
    bodyNonce: "x",
    bodySig: "x",
    envelopes: [{}],
  } as unknown as MessageWire;
}

for (const via of ["meeting", "room"] as const) {
  test(`a board-wide ban on the recipient stops every DM route (${via})`, async () => {
    const { db, close } = await openTestDb();
    try {
      const anna = await person(db, "Anna");
      const ben = await person(db, "Ben");
      const stranger = await person(db, "Stranger");
      if (via === "meeting") await meet(db, anna, ben);
      else {
        await joined(db, anna, "baptist", daysAgo(10));
        await joined(db, ben, "baptist", daysAgo(10));
      }
      // The conversation was open before the ban.
      const opened = await openThread(db, anna, ben, now);
      assert.equal(opened.ok, true);
      if (!opened.ok) return;
      assert.deepEqual(await mayMessage(db, anna, ben, now), { ok: true, via });

      await ban(db, ben, "");
      const never = [403, NOT_REACHABLE];
      const result = (r: { ok: boolean; status?: number; error?: string }) =>
        r.ok ? null : [r.status, r.error];
      assert.deepEqual(result(await mayMessage(db, anna, stranger, now)), never);
      assert.deepEqual(result(await mayMessage(db, anna, ben, now)), never);
      assert.deepEqual(result(await mayMessage(db, anna, ben, now, { starting: true })), never);
      assert.deepEqual(result(await openThread(db, anna, ben, now)), never);
      assert.deepEqual(result(await claimBundle(db, anna, ben, now)), never);
      assert.deepEqual(result(await previewBundle(db, anna, ben, now)), never);
      assert.deepEqual(
        result(await postMessage(db, anna, opened.value.id, wire(opened.value.id), now)),
        never,
      );
      assert.equal((await memberMessageStates(db, anna, [ben], now)).get(ben), "none");
      assert.deepEqual(await listPeers(db, anna, now), []);
    } finally {
      await close();
    }
  });
}

const result = (r: { ok: boolean; status?: number; error?: string }) =>
  r.ok ? null : [r.status, r.error];

type ThreadGate = {
  name: string;
  apply: (db: Db, anna: string, ben: string, room: string) => Promise<void>;
};

const THREAD_GATES: ThreadGate[] = [
  { name: "the recipient's membership revoked", apply: (db, _anna, ben) => revoke(db, ben) },
  { name: "the sender's membership revoked", apply: (db, anna) => revoke(db, anna) },
  { name: "the route's room moved to draft", apply: (db, _a, _b, room) => draft(db, room) },
];

for (const via of ["meeting", "room"] as const) {
  for (const gate of THREAD_GATES) {
    test(`${gate.name} stops every DM route on an open conversation (${via})`, async () => {
      const { db, close } = await openTestDb();
      try {
        const anna = await person(db, "Anna");
        const ben = await person(db, "Ben");
        const stranger = await person(db, "Stranger");
        const room = via === "meeting" ? ROOM : "baptist";
        if (via === "meeting") await meet(db, anna, ben);
        else {
          await joined(db, anna, room, daysAgo(10));
          await joined(db, ben, room, daysAgo(10));
        }
        const opened = await openThread(db, anna, ben, now);
        assert.equal(opened.ok, true);
        if (!opened.ok) return;
        const threadId = opened.value.id;
        assert.equal((await dmCallMember(db, anna, threadId, now)).kind, "member");

        await gate.apply(db, anna, ben, room);
        const never = [403, NOT_REACHABLE];
        assert.deepEqual(result(await mayMessage(db, anna, stranger, now)), never);
        for (const [from, to] of [
          [anna, ben],
          [ben, anna],
        ] as const) {
          assert.deepEqual(result(await mayMessage(db, from, to, now)), never);
          assert.deepEqual(result(await mayMessage(db, from, to, now, { starting: true })), never);
          assert.deepEqual(result(await openThread(db, from, to, now)), never);
          assert.deepEqual(result(await claimBundle(db, from, to, now)), never);
          assert.deepEqual(result(await previewBundle(db, from, to, now)), never);
          assert.deepEqual(
            result(await postMessage(db, from, threadId, wire(threadId), now)),
            never,
          );
          assert.equal(await sharesMeeting(db, from, to, now), false);
          assert.equal((await memberMessageStates(db, from, [to], now)).get(to), "none");
          assert.equal(
            (await listPeers(db, from, now)).some((peer) => peer.id === to),
            false,
          );
          assert.notEqual((await dmCallMember(db, from, threadId, now)).kind, "member");
        }
      } finally {
        await close();
      }
    });
  }
}

test("a meeting in a draft room stays open only when both may read it, as on the room route", async () => {
  const { db, close } = await openTestDb();
  try {
    const { anna, ben } = await setup(db);
    await joined(db, anna, "baptist", daysAgo(10));
    await joined(db, ben, "baptist", daysAgo(10));
    await draft(db, ROOM);
    await draft(db, "baptist");
    // An admin can read a draft room; a plain member cannot. One of each: refused.
    await grantAdmin(db, ben);
    const never = { ok: false, status: 403, error: NOT_REACHABLE };
    assert.deepEqual(await mayMessage(db, anna, ben, now), never);
    assert.deepEqual(await mayMessage(db, ben, anna, now), never);
    // Both can read it: the same staff exemption canReadRoom gives the room route.
    await grantAdmin(db, anna);
    assert.deepEqual(await mayMessage(db, anna, ben, now), { ok: true, via: "meeting" });
    assert.deepEqual(await mayMessage(db, ben, anna, now), { ok: true, via: "meeting" });
  } finally {
    await close();
  }
});

/** Every query text the db is asked to run, in order. */
function counting(db: Db): { db: Db; seen: string[] } {
  const seen: string[] = [];
  const wrap = (inner: Db): Db => ({
    async query<T>(text: string, params: unknown[] = []) {
      seen.push(text.replace(/\s+/g, " ").trim());
      return inner.query<T>(text, params);
    },
    transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
    ...(inner.session
      ? { session: <T>(fn: (db: Db) => Promise<T>) => inner.session!((s) => fn(wrap(s))) }
      : {}),
  });
  return { db: wrap(db), seen };
}

test("every refusal runs the same lookups, so a ban is not given away by timing", async () => {
  const runs = new Map<string, string[]>();
  const cases: [string, (db: Db, anna: string, ben: string) => Promise<void>][] = [
    ["clean", async () => {}],
    ["recipient banned", (db, _anna, ben) => ban(db, ben, "")],
    ["sender banned", (db, anna) => ban(db, anna, "")],
    [
      "recipient barred in the rooms",
      async (db, _anna, ben) => {
        await ban(db, ben, ROOM);
        await ban(db, ben, "baptist");
      },
    ],
    ["recipient revoked", (db, _anna, ben) => revoke(db, ben)],
    [
      "rooms in draft",
      async (db) => {
        await draft(db, ROOM);
        await draft(db, "baptist");
      },
    ],
    [
      "recipient outside the audience",
      async (db, _anna, ben) => {
        await db.query(`update members set gender = 'woman' where user_id = $1`, [ben]);
      },
    ],
  ];
  for (const [name, apply] of cases) {
    const { db, close } = await openTestDb();
    try {
      const { anna, ben } = await setup(db);
      await joined(db, anna, "baptist", daysAgo(10));
      await joined(db, ben, "baptist", daysAgo(10));
      // Both rooms are men-only throughout, so the audience lookup runs in every case.
      await db.query(`update room set audience = 'men' where id = any ($1::text[])`, [
        [ROOM, "baptist"],
      ]);
      await apply(db, anna, ben);
      const counted = counting(db);
      const gate = await mayMessage(counted.db, anna, ben, now);
      assert.equal(gate.ok, name === "clean", name);
      runs.set(name, counted.seen);
    } finally {
      await close();
    }
  }
  const clean = runs.get("clean") ?? [];
  // The banned path reaches the meeting and the shared-room lookups.
  const banned = runs.get("recipient banned") ?? [];
  assert.ok(
    banned.some((text) => text.includes("dm_attendance")),
    "meeting lookup ran",
  );
  assert.ok(
    banned.some((text) => text.includes("room_join")),
    "room lookup ran",
  );
  for (const [name, seen] of runs) assert.deepEqual(seen, clean, name);
});
