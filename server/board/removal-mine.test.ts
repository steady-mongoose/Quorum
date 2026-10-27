import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { createPost, listBoard, removePost } from "./store.ts";

// QA, Oct 27, 2026: About matched "your removals" by display name. Two members
// can share a name, so the server now marks the viewer's own rows by user id.

const now = new Date("2026-10-27T15:00:00Z");

async function member(db: Db, name: string, grants: [string, string][] = [["member", ""]]) {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 6)}@example.com`, now],
  );
  for (const [role, room] of grants) {
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, $3, $4, $5, 'grant', 'test', 'test', 'test', 'Granted for the test.', $6)`,
      [randomUUID(), id, name, role, room, now],
    );
  }
  await db.query(`insert into room_member (room_id, user_id) values ('shop', $1)`, [id]);
  return id;
}

test("a removal is 'mine' only for the author's user id, not anyone with that name", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = await member(db, "Maria");
    const otherMaria = await member(db, "Maria");
    const tom = await member(db, "Tom", [
      ["member", ""],
      ["steward", "shop"],
    ]);
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: {
        type: "did",
        claim: "Sharpened the chisels in the shop.",
        reason: "Tom checked them on Thursday.",
        on: "2026-10-18",
      },
      now: new Date(now.getTime() - 60_000),
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

    const later = new Date(now.getTime() + 1_000);
    const mine = await listBoard(db, maria, later);
    const theirs = await listBoard(db, otherMaria, later);
    const steward = await listBoard(db, tom, later);
    const row = (board: typeof mine) =>
      board.ok ? board.value.removals.find((r) => r.postId === posted.value.id) : undefined;
    assert.equal(row(mine)?.mine, true, "the author sees it as theirs");
    assert.notEqual(row(theirs)?.mine, true, "the other Maria does not");
    assert.notEqual(row(steward)?.mine, true, "the steward does not");
    assert.equal(row(mine)?.author, row(theirs)?.author ?? "Maria", "same display name");
  } finally {
    await close();
  }
});
