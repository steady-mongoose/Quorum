import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { listRoomMembers } from "../board/members.ts";
import { requireRoomMember, roomStandings, standingKey } from "../chat/store.ts";
import { actorRole, actorRoles } from "../board/access.ts";
import {
  NOT_REACHABLE,
  ROOM_MESSAGE_DAILY_STARTS,
  ROOM_WAIT,
  blockMember,
  mayMessage,
  memberMessageStates,
  openThread,
  rememberNamedAccounts,
  recordAttendance,
  type MemberMessage,
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
    await grant(db, id, name, role, roomId, "grant", daysAgo(30));
  }
  return id;
}

async function grant(
  db: Db,
  userId: string,
  name: string,
  role: string,
  roomId: string,
  action: "grant" | "revoke",
  at: Date,
): Promise<void> {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, $4, $5, $6, 'test', 'test', 'test', 'For the test.', $7)`,
    [randomUUID(), userId, name, role, roomId, action, at],
  );
}

async function joined(db: Db, userId: string, roomId: string, at: Date): Promise<void> {
  await db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, $2, $3)`, [
    userId,
    roomId,
    at,
  ]);
}

async function meet(db: Db, host: string, guest: string, card: string): Promise<void> {
  const names = await db.query<{ id: string; name: string }>(
    `select id, name from "user" where id in ($1, $2)`,
    [host, guest],
  );
  const hostName = names.find((row) => row.id === host)?.name ?? "";
  const postId = randomUUID();
  await db.query(
    `insert into board_post (
       id, room_id, author_user_id, author_name, type, claim, came, card_id, created_at
     ) values ($1, 'coop', $2, $3, 'hosted', 'The framing night went well and the next one is set.', $4, $5, $6)`,
    [postId, host, hostName, names.map((row) => row.name), card, now],
  );
  await rememberNamedAccounts(db, postId);
  for (const userId of [host, guest]) {
    assert.equal((await recordAttendance(db, userId, now, [card])).ok, true);
  }
}

async function ban(db: Db, userId: string, roomId: string): Promise<void> {
  await db.query(
    `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, room_id)
     values ($1, $2, 'x', 'threat', 'test', 1, $3, $4)`,
    [randomUUID(), userId, new Date(now.getTime() + 10 * DAY), roomId],
  );
}

/** Counts every query the code under test sends. */
function counting(db: Db): { db: Db; count: () => number; reset: () => void } {
  let n = 0;
  const wrap = (inner: Db): Db => ({
    async query<T>(text: string, params?: unknown[]) {
      n += 1;
      return inner.query<T>(text, params);
    },
    transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
    session: (fn) => (inner.session ? inner.session((s) => fn(wrap(s))) : fn(wrap(inner))),
  });
  return { db: wrap(db), count: () => n, reset: () => (n = 0) };
}

/** mayMessage for the conversation the button would open, as a list state. */
async function serverSays(db: Db, caller: string, other: string): Promise<MemberMessage> {
  const [low, high] = caller < other ? [caller, other] : [other, caller];
  const existing = await db.query(`select id from dm_thread where user_a = $1 and user_b = $2`, [
    low,
    high,
  ]);
  const gate = await mayMessage(db, caller, other, now, { starting: !existing[0] });
  if (gate.ok) return "open";
  return gate.error === ROOM_WAIT ? "wait" : "none";
}

test("the member list costs the same number of queries for 5 members as for 50", async () => {
  const { db, close } = await openTestDb();
  try {
    const viewer = await person(db, "Viewer");
    await joined(db, viewer, "shop", daysAgo(10));
    await joined(db, viewer, "coop", daysAgo(10));
    const counted = counting(db);
    const measure = async (size: number) => {
      const have = Number(
        (
          await db.query<{ n: string }>(
            `select count(*)::text as n from room_join where room_id = 'shop'`,
          )
        )[0]?.n,
      );
      for (let i = have; i < size; i += 1) {
        const id = await person(db, `M${String(i).padStart(3, "0")}`);
        await joined(db, id, "shop", daysAgo(i % 2 ? 1 : 10));
        // Some share a second room, some have a conversation, some are blocked or barred.
        if (i % 3 === 0) await joined(db, id, "coop", daysAgo(10));
        if (i % 4 === 0) assert.equal((await openThread(db, id, viewer, now)).ok, true);
        if (i % 7 === 0) await blockMember(db, viewer, id, now);
        if (i % 11 === 0) await blockMember(db, id, viewer, now);
        if (i % 13 === 0) await ban(db, id, "coop");
      }
      counted.reset();
      const list = await listRoomMembers(counted.db, viewer, "shop", now);
      const listed = counted.count();
      assert.equal(list.ok, true);
      if (!list.ok) throw new Error("list");
      assert.equal(list.value.members.length, size);
      const ids = list.value.members.map((row) => row.id);
      counted.reset();
      await memberMessageStates(counted.db, viewer, ids, now);
      return { listed, states: counted.count() };
    };
    const five = await measure(5);
    const fifty = await measure(50);
    assert.deepEqual(fifty, five);
    assert.ok(five.states <= 20, `states took ${five.states} queries`);
    assert.ok(five.listed <= 40, `the list took ${five.listed} queries`);
    console.log(
      `member list queries: 5 members ${JSON.stringify(five)}, 50 ${JSON.stringify(fifty)}`,
    );
  } finally {
    await close();
  }
});

test("each member's list state is what mayMessage says, except that their block is not shown", async () => {
  const { db, close } = await openTestDb();
  try {
    const anna = await person(db, "Anna");
    await joined(db, anna, "shop", daysAgo(10));
    await joined(db, anna, "coop", daysAgo(1));
    const make = async (
      name: string,
      rooms: [string, number][],
      roles: [string, string][] = [],
    ) => {
      const id = await person(db, name, roles);
      for (const [roomId, days] of rooms) await joined(db, id, roomId, daysAgo(days));
      return id;
    };
    const plain = await make("Plain", [["shop", 10]]);
    const newRoomOnly = await make("CoopOnly", [["coop", 10]]);
    const mineBlocked = await make("IBlocked", [["shop", 10]]);
    const theyBlocked = await make("TheyBlocked", [["shop", 10]]);
    const barredShop = await make("BarredShop", [["shop", 10]]);
    const barredAll = await make("BarredAll", [["shop", 10]]);
    const revoked = await make("Revoked", [["shop", 10]]);
    const stranger = await make("Stranger", [["county", 10]]);
    const metOnly = await make("MetOnly", []);
    const talkingGone = await make("TalkingGone", [["shop", 10]]);
    const talkingCoop = await make("TalkingCoop", [["coop", 10]]);
    const womens = await make("Womens", [["baptist", 10]]);

    await blockMember(db, anna, mineBlocked, now);
    await blockMember(db, theyBlocked, anna, now);
    await ban(db, barredShop, "shop");
    await ban(db, barredAll, "");
    await grant(db, revoked, "Revoked", "member", "", "revoke", daysAgo(1));
    await meet(db, metOnly, anna, "s-met-only");
    // Conversations opened while both were in shop; then the other person was barred from it.
    assert.equal((await openThread(db, anna, talkingGone, now)).ok, true);
    await ban(db, talkingGone, "shop");
    assert.equal((await openThread(db, talkingCoop, anna, now)).ok, true);
    // Anna is in baptist too, but it is now a women's room and she has stated nothing.
    await joined(db, anna, "baptist", daysAgo(10));
    await db.query(`update room set audience = 'women' where id = 'baptist'`);

    const everyone = [
      plain,
      newRoomOnly,
      mineBlocked,
      theyBlocked,
      barredShop,
      barredAll,
      revoked,
      stranger,
      metOnly,
      talkingGone,
      talkingCoop,
      womens,
    ];
    const check = async (caller: string, label: string) => {
      const states = await memberMessageStates(db, caller, [caller, ...everyone], now);
      assert.equal(states.has(caller), false);
      for (const other of everyone) {
        if (other === caller) continue;
        const listed = states.get(other);
        const server = await serverSays(db, caller, other);
        if (caller === anna && other === theyBlocked) {
          // Refused by the server, but the row reads like Plain's.
          assert.equal(server, "none");
          assert.equal(listed, states.get(plain), label);
          continue;
        }
        assert.equal(listed, server, `${label}: ${other}`);
      }
      return states;
    };

    const states = await check(anna, "Anna");
    assert.equal(states.get(plain), "open");
    assert.equal(states.get(newRoomOnly), "wait");
    assert.equal(states.get(mineBlocked), "none");
    assert.equal(states.get(theyBlocked), "open");
    assert.equal(states.get(barredShop), "none");
    assert.equal(states.get(barredAll), "none");
    assert.equal(states.get(revoked), "none");
    assert.equal(states.get(stranger), "none");
    assert.equal(states.get(metOnly), "open");
    assert.equal(states.get(talkingGone), "none");
    assert.equal(states.get(talkingCoop), "open");
    assert.equal(states.get(womens), "none");

    // A steward of coop is settled there on the first day.
    const tess = await make("Tess", [["coop", 0]], [["steward", "coop"]]);
    await check(tess, "Tess");
    assert.equal(
      (await memberMessageStates(db, tess, [newRoomOnly], now)).get(newRoomOnly),
      "open",
    );

    // Today's room starts used up (talkingGone was the first): new ones close, existing stay.
    for (let i = 1; i < ROOM_MESSAGE_DAILY_STARTS; i += 1) {
      const other = await make(`Started${i}`, [["shop", 10]]);
      assert.equal((await openThread(db, anna, other, now)).ok, true);
    }
    const capped = await check(anna, "Anna capped");
    assert.equal(capped.get(plain), "none");
    assert.equal(capped.get(talkingCoop), "open");
    assert.equal(capped.get(metOnly), "open");
  } finally {
    await close();
  }
});

test("an existing conversation is open only while the two still share a room or meeting", async () => {
  const { db, close } = await openTestDb();
  try {
    const anna = await person(db, "Anna");
    const bob = await person(db, "Bob");
    await joined(db, anna, "shop", daysAgo(10));
    await joined(db, bob, "shop", daysAgo(10));
    const opened = await openThread(db, anna, bob, now);
    assert.equal(opened.ok, true);
    assert.equal((await memberMessageStates(db, anna, [bob], now)).get(bob), "open");

    // Bob leaves shop: no room or meeting in common any more.
    await db.query(`delete from room_join where user_id = $1`, [bob]);
    await db.query(`delete from room_member where user_id = $1`, [bob]);
    assert.equal((await memberMessageStates(db, anna, [bob], now)).get(bob), "none");
    const again = await openThread(db, anna, bob, now);
    assert.deepEqual(again.ok ? null : [again.status, again.error], [403, NOT_REACHABLE]);
    assert.deepEqual(await mayMessage(db, anna, bob, now), {
      ok: false,
      status: 403,
      error: NOT_REACHABLE,
    });

    // A meeting together opens it again, with no room.
    await meet(db, anna, bob, "s-again");
    assert.equal((await memberMessageStates(db, anna, [bob], now)).get(bob), "open");
    assert.equal((await openThread(db, anna, bob, now)).ok, true);
  } finally {
    await close();
  }
});

test("batched room standing and roles match requireRoomMember and actorRole person by person", async () => {
  const { db, close } = await openTestDb();
  try {
    const people = [
      await person(db, "Plain"),
      await person(db, "Admin", [["admin", ""]]),
      await person(db, "Steward", [["steward", "coop"]]),
      await person(db, "Revoked"),
      await person(db, "Barred"),
      await person(db, "Woman"),
      await person(db, "Nobody"),
    ];
    const [plain, admin, steward, revoked, barred, woman] = people as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    for (const id of [plain, admin, steward, revoked, barred, woman]) {
      await joined(db, id, "shop", daysAgo(10));
      await joined(db, id, "baptist", daysAgo(10));
    }
    await db.query(`insert into room_member (user_id, room_id) values ($1, 'coop')`, [steward]);
    await grant(db, revoked, "Revoked", "member", "", "revoke", daysAgo(1));
    await grant(db, steward, "Steward", "steward", "coop", "revoke", daysAgo(40));
    await ban(db, barred, "baptist");
    await db.query(`update room set audience = 'women' where id = 'baptist'`);
    await db.query(
      `insert into members (user_id, display_name, gender, gender_confirmed_at)
       values ($1, 'Woman', 'woman', $2)`,
      [woman, now],
    );
    await db.query(`update room set status = 'draft' where id = 'coop'`);
    const rooms = ["shop", "baptist", "coop", "county", "nope"];
    const { standing, actors } = await roomStandings(db, people, rooms, now);
    for (const id of people) {
      assert.deepEqual(actors.get(id), await actorRole(db, id));
      for (const roomId of rooms) {
        const one = await requireRoomMember(db, id, roomId, now);
        assert.equal(standing.has(standingKey(id, roomId)), one.ok, `${id} ${roomId}`);
      }
    }
    assert.deepEqual(await actorRoles(db, []), new Map());
  } finally {
    await close();
  }
});
