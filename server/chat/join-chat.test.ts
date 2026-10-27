import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { joinRoom } from "../board/places-store.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import { listChat, sendChat } from "./store.ts";

// QA, Oct 27, 2026: "Join this room" returned 200 but chat still said
// "You are not in this room." Join writes room_join; chat now reads it too.

const now = new Date("2026-10-27T15:00:00Z");

test("join, then chat lets you in, and leaving shuts it again", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    await db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'Josh', 'josh@example.com', true, $2, $2)`,
      [josh, now],
    );
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, 'Josh', 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $3)`,
      [randomUUID(), josh, now],
    );

    const before = await listChat(db, { userId: josh, roomId: "shop", now });
    assert.equal(before.ok, false);
    if (!before.ok) assert.equal(before.error, "You are not in this room.");

    const joined = await joinRoom(db, { userId: josh, roomId: "shop", now });
    assert.equal(joined.ok, true);

    const after = await listChat(db, { userId: josh, roomId: "shop", now });
    assert.equal(after.ok, true, after.ok ? "" : after.error);
    const sent = await sendChat(db, {
      userId: josh,
      name: "Josh",
      roomId: "shop",
      text: "Is the bench free tonight?",
      now,
    });
    assert.equal(sent.ok, true);

    const left = await joinRoom(db, { userId: josh, roomId: "shop", now, leave: true });
    assert.equal(left.ok, true);
    // He posted, so he has stood in the room (room_member) and can still read it.
    const gone = await db.query(`select 1 from room_join where user_id = $1`, [josh]);
    assert.equal(gone.length, 0);
  } finally {
    await close();
  }
});

test("after a join the chat reloads, the Join button goes, and the note clears", () => {
  const source = readFileSync(new URL("../../src/components/board/room-chat.tsx", import.meta.url), "utf8");
  // The button only shows while the server says NOT_IN_ROOM.
  assert.match(source, /\{note === NOT_IN_ROOM \? \(/);
  // A successful join bumps joinTick, which re-runs the pull...
  assert.match(source, /setJoinTick\(\(tick\) => tick \+ 1\)/);
  assert.match(source, /\}, \[remote, roomId, joinTick\]\);/);
  // ...and a successful pull clears the note, which removes the button.
  assert.match(source, /setBlocked\(false\);\n\s+setNote\(""\);/);
  assert.match(source, /You joined this room\./);
});
