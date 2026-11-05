import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { listRoomMembers } from "../board/members.ts";
import { mintInvite, redeemInvite, type CreateAccount, type SignIn } from "../closed-test/store.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { DAY, call, inRoom, member, testApp } from "./reach-harness.ts";
import { ROOM_WAIT } from "./store.ts";

// QA on the DM routes: a room invite wrote room_member and no room_join, and a
// missing join date counted as never settled, so the 3-day wait never ended.

const start = new Date("2026-10-31T12:00:00.000Z");
const ROOM = "shop";
const long = new Date(start.getTime() - 20 * DAY);

const signIn: SignIn = async (input) => ({
  ok: true,
  user: { id: input.userId, name: input.name, email: input.email },
});

function accountAt(at: Date): CreateAccount {
  return async (tx, input) => {
    const id = randomUUID();
    await tx.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, $2, $3, true, $4, $4)`,
      [id, input.name, input.email, at],
    );
    return { id };
  };
}

async function listState(db: Db, viewer: string, other: string, now: Date) {
  const listed = await listRoomMembers(db, viewer, ROOM, now);
  return listed.ok ? listed.value.members.find((row) => row.id === other)?.message : listed.error;
}

test("someone invited into a room waits three days from the invite, then can start", async () => {
  const { db, close } = await openTestDb();
  try {
    const old = await member(db, "TestOld", long);
    await inRoom(db, old, ROOM, long);
    const invite = await mintInvite(
      db,
      { userId: old, maxUses: 1, expiresInDays: 7, roomId: ROOM, attestAdult: true },
      start,
    );
    assert.ok(invite.ok);
    const redeemed = await redeemInvite(
      db,
      {
        name: "TestInvited",
        email: "invited@example.com",
        password: "correct-horse",
        code: invite.value.code,
        adult: true,
        headers: new Headers(),
      },
      accountAt(start),
      signIn,
      start,
    );
    assert.ok(redeemed.ok);
    const invited = redeemed.value.user.id;

    const joins = await db.query<{ room_id: string; joined_at: Date }>(
      `select room_id, joined_at from room_join where user_id = $1`,
      [invited],
    );
    assert.equal(joins.length, 1);
    assert.equal(joins[0]?.room_id, ROOM);
    assert.equal(new Date(joins[0]?.joined_at ?? 0).getTime(), start.getTime());

    const open = (now: Date) =>
      call(
        testApp(db, () => now),
        invited,
        "POST",
        "/api/dm/threads",
        { userId: old },
      );
    const twoDays = new Date(start.getTime() + 2 * DAY);
    const refused = await open(twoDays);
    assert.equal(refused.status, 403);
    assert.deepEqual(refused.body, { error: ROOM_WAIT });
    assert.equal(await listState(db, invited, old, twoDays), "wait");

    const threeDays = new Date(start.getTime() + 3 * DAY);
    assert.equal(await listState(db, invited, old, threeDays), "open");
    assert.equal((await open(threeDays)).status, 201);
  } finally {
    await close();
  }
});

test("a room_member row with no join date counts from account creation", async () => {
  const { db, close } = await openTestDb();
  try {
    const old = await member(db, "TestOld", long);
    await inRoom(db, old, ROOM, long);
    const rowOnly = async (name: string, created: Date) => {
      const id = await member(db, name, created);
      await db.query(`insert into room_member (room_id, user_id) values ($1, $2)`, [ROOM, id]);
      return id;
    };
    const veteran = await rowOnly("TestVeteran", new Date(start.getTime() - 30 * DAY));
    const recent = await rowOnly("TestRecent", new Date(start.getTime() - DAY));
    const handler = testApp(db, () => start);
    const open = (from: string) => call(handler, from, "POST", "/api/dm/threads", { userId: old });

    // The rule is unchanged: under three days still waits, on both answers.
    assert.equal(await listState(db, recent, old, start), "wait");
    const refused = await open(recent);
    assert.equal(refused.status, 403);
    assert.deepEqual(refused.body, { error: ROOM_WAIT });

    assert.equal(await listState(db, veteran, old, start), "open");
    assert.equal((await open(veteran)).status, 201);

    // The list keeps saying the date is unknown; only the wait reads the account date.
    const listed = await listRoomMembers(db, veteran, ROOM, start);
    assert.ok(listed.ok);
    assert.equal(listed.value.members.find((row) => row.id === veteran)?.joinedOn, "");
  } finally {
    await close();
  }
});
