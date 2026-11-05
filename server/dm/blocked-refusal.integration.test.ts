import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { listRoomMembers } from "../board/members.ts";
import { dmCallMember } from "../calls/dm-membership.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { DAY, call, inRoom, member, testApp } from "./reach-harness.ts";
import { BLOCKED, NOT_REACHABLE, blockMember, openThread } from "./store.ts";

// QA on the DM routes: a refusal told the blocked person who blocked them. Now
// someone you blocked reads as "you blocked them", and someone who blocked you
// reads exactly as someone you never had reach to, on every route.

const now = new Date("2026-10-31T12:00:00.000Z");
const ROOM = "shop";

/** Every DM route that checks reach, answered for one caller and one target. */
async function everyRoute(db: Db, caller: string, target: string, threadId: string) {
  const handler = testApp(db, () => now);
  const message = randomUUID();
  return {
    open: await call(handler, caller, "POST", "/api/dm/threads", { userId: target }),
    claim: await call(handler, caller, "POST", "/api/dm/bundles", { userId: target }),
    preview: await call(handler, caller, "GET", `/api/dm/keys?userId=${target}`),
    send: await call(handler, caller, "POST", `/api/dm/threads/${threadId}/messages`, {
      messageId: message,
      threadId,
      senderDeviceId: randomUUID(),
      bodyNonce: "n",
      bodyCiphertext: "c",
      bodySig: "s",
      envelopes: [
        { recipientDeviceId: randomUUID(), nonce: "n", ciphertext: "c", ephemeralPublic: "e" },
      ],
    }),
  };
}

async function people(db: Db) {
  const long = new Date(now.getTime() - 20 * DAY);
  const anna = await member(db, "TestAnna", long);
  const ben = await member(db, "TestBen", long);
  await inRoom(db, anna, ROOM, long);
  await inRoom(db, ben, ROOM, long);
  return { anna, ben };
}

for (const started of [false, true]) {
  test(`blocked by them answers as no reach on every route, conversation ${started ? "open" : "not open"}`, async () => {
    // The yardstick: the same two people with the shared room gone and no block.
    const never = await openTestDb();
    const theirs = await openTestDb();
    try {
      const plain = await people(never.db);
      const blocked = await people(theirs.db);
      const opened = async (db: Db, a: string, b: string) => {
        if (!started) return randomUUID();
        const thread = await openThread(db, a, b, now);
        assert.ok(thread.ok);
        return thread.value.id;
      };
      const plainThread = await opened(never.db, plain.anna, plain.ben);
      const blockedThread = await opened(theirs.db, blocked.anna, blocked.ben);

      await never.db.query(`delete from room_join where user_id = $1`, [plain.ben]);
      await blockMember(theirs.db, blocked.ben, blocked.anna, now);

      const noReach = await everyRoute(never.db, plain.anna, plain.ben, plainThread);
      const refused = await everyRoute(theirs.db, blocked.anna, blocked.ben, blockedThread);
      assert.equal(noReach.open.status, 403);
      assert.deepEqual(noReach.open.body, { error: NOT_REACHABLE });
      assert.deepEqual(refused, noReach);
      if (started) assert.equal(refused.send.status, 403);

      // The call route says the same as for anyone it would turn away.
      if (started) {
        const call = await dmCallMember(theirs.db, blocked.anna, blockedThread, now);
        assert.equal(call.kind, "outsider");
      }
      // Nothing about the block shows on the caller's own list of blocks.
      const handler = testApp(theirs.db, () => now);
      const mine = await call(handler, blocked.anna, "GET", "/api/dm/blocks");
      assert.deepEqual(mine.body, { blocked: [] });
    } finally {
      await never.close();
      await theirs.close();
    }
  });
}

test("the member list reads the same before and after they block you", async () => {
  const { db, close } = await openTestDb();
  try {
    const { anna, ben } = await people(db);
    const before = await listRoomMembers(db, anna, ROOM, now);
    assert.ok(before.ok);
    assert.equal(before.value.members.find((row) => row.id === ben)?.message, "open");
    await blockMember(db, ben, anna, now);
    assert.deepEqual(await listRoomMembers(db, anna, ROOM, now), before);
  } finally {
    await close();
  }
});

test("someone you blocked keeps the honest words, on every route and with a block both ways", async () => {
  const { db, close } = await openTestDb();
  try {
    const { anna, ben } = await people(db);
    const opened = await openThread(db, anna, ben, now);
    assert.ok(opened.ok);
    await blockMember(db, anna, ben, now);
    const check = async () => {
      const routes = await everyRoute(db, anna, ben, opened.value.id);
      for (const answer of Object.values(routes)) {
        assert.equal(answer.status, 403);
        assert.deepEqual(answer.body, { error: BLOCKED });
      }
    };
    await check();
    await blockMember(db, ben, anna, now);
    await check();
    const list = await listRoomMembers(db, anna, ROOM, now);
    assert.ok(list.ok);
    assert.equal(list.value.members.find((row) => row.id === ben)?.message, "none");
  } finally {
    await close();
  }
});
