import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { fileAppeal, listBoard, markPost, removePost } from "./store.ts";
import { createPost } from "./test-posting.ts";

const now = new Date("2026-10-19T12:00:00Z");

async function user(db: Db, id: string, name: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}@example.test`, now],
  );
}

async function grant(db: Db, userId: string, name: string, role: string, roomId = "") {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, $4, $5, 'grant', 'test', 'test', 'test', 'Granted for the test.', $6)`,
    [randomUUID(), userId, name, role, roomId, now],
  );
}

const did = {
  type: "did",
  claim: "Sharpened the chisels in the shop.",
  reason: "Tom checked them on Thursday.",
  on: "2026-10-18",
};

test("the marked member, not only a steward, gets the mark appeal form", () => {
  const room = readFileSync(
    new URL("../../src/components/board/room-view.tsx", import.meta.url),
    "utf8",
  );
  const stewardBlock = room.indexOf("      {steward ? (\n        <div");
  const form = room.indexOf("{mine && appealing ? (");
  assert.ok(stewardBlock > 0);
  assert.ok(form > stewardBlock, "the appeal form renders outside the steward block");
  const blockEnd = room.indexOf("      ) : null}\n      {mine && appealing ? (");
  assert.ok(blockEnd > stewardBlock && blockEnd < form);
});

test("a removed author still sees the removal and can appeal it after the room bar", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    const ann = randomUUID();
    await user(db, maria, "Maria");
    await user(db, tom, "Tom");
    await user(db, ann, "Ann");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, ann, "Ann", "member");
    await grant(db, tom, "Tom", "steward", "shop");
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const removed = await removePost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      reason: "threat",
      now,
    });
    assert.equal(removed.ok, true);

    const board = await listBoard(db, maria, now);
    assert.equal(board.ok, true);
    if (!board.ok) return;
    assert.equal(
      board.value.rooms.some((room) => room.id === "shop"),
      false,
    );
    assert.deepEqual(
      board.value.removals.map((row) => row.postId),
      [posted.value.id],
    );

    const other = await listBoard(db, ann, now);
    assert.equal(other.ok, true);
    if (!other.ok) return;
    assert.equal(other.value.removals.length, 0, "another member does not see the removal");

    const appealed = await fileAppeal(db, {
      userId: maria,
      name: "Maria",
      postId: posted.value.id,
      kind: "removal",
      reason: "The post named no one and threatened no one.",
      now,
    });
    assert.equal(appealed.ok, true);
    const steward = await listBoard(db, tom, now);
    assert.equal(steward.ok, true);
    if (!steward.ok) return;
    assert.equal(
      steward.value.appeals.some((row) => row.postId === posted.value.id && row.kind === "removal"),
      true,
      "the room's steward sees the appeal to decide it",
    );
  } finally {
    await close();
  }
});

test("the marked author can file a mark appeal", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    await user(db, maria, "Maria");
    await user(db, tom, "Tom");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, tom, "Tom", "steward", "shop");
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const marked = await markPost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      mark: "sloppy",
      reason: "The proof does not say who was there.",
      now,
    });
    assert.equal(marked.ok, true);
    const appealed = await fileAppeal(db, {
      userId: maria,
      name: "Maria",
      postId: posted.value.id,
      kind: "mark",
      reason: "Tom was there and checked them.",
      now,
    });
    assert.equal(appealed.ok, true);
  } finally {
    await close();
  }
});
