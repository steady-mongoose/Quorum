import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { joinRoom } from "../board/places-store.ts";
import { roomCallMember } from "./membership.ts";

const now = new Date("2026-10-27T12:00:00.000Z");

async function member(db: Db, name: string, stewardOf = ""): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`, now],
  );
  const grants: [string, string][] = [["member", ""]];
  if (stewardOf) grants.push(["steward", stewardOf]);
  for (const [role, roomId] of grants) {
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, $3, $4, $5, 'grant', 'test', 'test', 'test', 'Granted for the test.', $6)`,
      [randomUUID(), id, name, role, roomId, now],
    );
  }
  return id;
}

test("a saved room or a steward grant lets a member join the room call", async () => {
  const { db, close } = await openTestDb();
  try {
    const saver = await member(db, "Saver");
    const stranger = await member(db, "Stranger");
    const stew = await member(db, "Stew", "shop");

    assert.equal((await roomCallMember(db, saver, "shop", now)).kind, "outsider");
    const saved = await joinRoom(db, { userId: saver, roomId: "shop", now });
    assert.equal(saved.ok, true);
    assert.equal((await roomCallMember(db, saver, "shop", now)).kind, "member");

    // Leaving the saved room ends call access again.
    await joinRoom(db, { userId: saver, roomId: "shop", now, leave: true });
    assert.equal((await roomCallMember(db, saver, "shop", now)).kind, "outsider");

    // A steward of the room may join without a post or a saved room.
    assert.equal((await roomCallMember(db, stew, "shop", now)).kind, "member");
    assert.equal((await roomCallMember(db, stranger, "shop", now)).kind, "outsider");
  } finally {
    await close();
  }
});
