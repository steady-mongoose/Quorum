import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { roomCallMember } from "../calls/membership.ts";
import { requireRoomMember } from "../chat/store.ts";
import { joinRoom } from "./places-store.ts";
import { createPost, replyToPost } from "./store.ts";

const now = new Date("2026-10-27T12:00:00.000Z");
const did = {
  type: "did",
  claim: "Sharpened the chisels in the shop.",
  reason: "Tom checked them on Thursday.",
  on: "2026-10-18",
};

async function person(db: Db, name: string, roles: [string, string][] = [["member", ""]]) {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`, now],
  );
  for (const [role, roomId] of roles) {
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, $3, $4, $5, 'grant', 'test', 'test', 'test', 'Granted for the test.', $6)`,
      [randomUUID(), id, name, role, roomId, now],
    );
  }
  return id;
}

async function stood(db: Db, userId: string, roomId: string): Promise<boolean> {
  const rows = await db.query<{ user_id: string }>(
    `select user_id from room_member where room_id = $1 and user_id = $2`,
    [roomId, userId],
  );
  return rows.length > 0;
}

test("a member who joined can post and reply; a member who never joined is refused", async () => {
  const { db, close } = await openTestDb();
  try {
    const joined = await person(db, "Joiner");
    const outsider = await person(db, "Outsider");
    assert.equal((await joinRoom(db, { userId: joined, roomId: "shop", now })).ok, true);
    const post = await createPost(db, {
      userId: joined,
      name: "Joiner",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(post.ok, true);
    if (!post.ok) return;
    const reply = await replyToPost(db, {
      userId: joined,
      name: "Joiner",
      postId: post.value.id,
      claim: "They cut clean now.",
      now,
    });
    assert.equal(reply.ok, true);

    const refused = await createPost(db, {
      userId: outsider,
      name: "Outsider",
      roomId: "shop",
      body: did,
      now,
    });
    assert.deepEqual(refused.ok ? null : [refused.status, refused.error], [
      403,
      "Join this room to post.",
    ]);
    const refusedReply = await replyToPost(db, {
      userId: outsider,
      name: "Outsider",
      postId: post.value.id,
      claim: "Nice work.",
      now,
    });
    assert.deepEqual(refusedReply.ok ? null : [refusedReply.status, refusedReply.error], [
      403,
      "Join this room to post.",
    ]);
    assert.equal(await stood(db, outsider, "shop"), false);
  } finally {
    await close();
  }
});

test("after leaving, a post or reply is refused and call and chat access stay revoked", async () => {
  const { db, close } = await openTestDb();
  try {
    const leaver = await person(db, "Leaver");
    const other = await person(db, "Other");
    await joinRoom(db, { userId: other, roomId: "shop", now });
    const parent = await createPost(db, {
      userId: other,
      name: "Other",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(parent.ok, true);
    if (!parent.ok) return;

    await joinRoom(db, { userId: leaver, roomId: "shop", now });
    const first = await createPost(db, {
      userId: leaver,
      name: "Leaver",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(first.ok, true);
    assert.equal(await stood(db, leaver, "shop"), true);
    await joinRoom(db, { userId: leaver, roomId: "shop", now, leave: true });
    assert.equal((await roomCallMember(db, leaver, "shop", now)).kind, "outsider");

    const post = await createPost(db, {
      userId: leaver,
      name: "Leaver",
      roomId: "shop",
      body: did,
      now,
    });
    assert.deepEqual(post.ok ? null : [post.status, post.error], [403, "Join this room to post."]);
    const reply = await replyToPost(db, {
      userId: leaver,
      name: "Leaver",
      postId: parent.value.id,
      claim: "Back again.",
      now,
    });
    assert.deepEqual(reply.ok ? null : [reply.status, reply.error], [
      403,
      "Join this room to post.",
    ]);

    // Nothing put them back in the room.
    assert.equal(await stood(db, leaver, "shop"), false);
    assert.equal((await roomCallMember(db, leaver, "shop", now)).kind, "outsider");
    const chat = await requireRoomMember(db, leaver, "shop", now);
    assert.equal(chat.ok, false);
    if (!chat.ok) assert.equal(chat.status, 403);

    // Rejoining lets them post again.
    await joinRoom(db, { userId: leaver, roomId: "shop", now });
    const back = await createPost(db, {
      userId: leaver,
      name: "Leaver",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(back.ok, true);
  } finally {
    await close();
  }
});

test("a steward of the room and an admin may post without joining", async () => {
  const { db, close } = await openTestDb();
  try {
    const stew = await person(db, "Stew", [
      ["member", ""],
      ["steward", "shop"],
    ]);
    const admin = await person(db, "Admin", [
      ["member", ""],
      ["admin", ""],
    ]);
    const otherStew = await person(db, "Elsewhere", [
      ["member", ""],
      ["steward", "county"],
    ]);
    for (const [id, name] of [
      [stew, "Stew"],
      [admin, "Admin"],
    ] as const) {
      const post = await createPost(db, { userId: id, name, roomId: "shop", body: did, now });
      assert.equal(post.ok, true, name);
    }
    const refused = await createPost(db, {
      userId: otherStew,
      name: "Elsewhere",
      roomId: "shop",
      body: did,
      now,
    });
    assert.deepEqual(refused.ok ? null : [refused.status, refused.error], [
      403,
      "Join this room to post.",
    ]);
  } finally {
    await close();
  }
});
