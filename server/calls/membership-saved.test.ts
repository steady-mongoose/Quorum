import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { joinRoom } from "../board/places-store.ts";
import { roomCallMember } from "./membership.ts";
import { createApp } from "../http.ts";
import { readCallsConfig } from "./config.ts";
import { createCallStore } from "./store.ts";

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

test("a revoked member who saved the room, or a revoked steward, cannot join or get TURN", async () => {
  const { db, close } = await openTestDb();
  try {
    const saver = await member(db, "Gone");
    const stew = await member(db, "GoneStew", "shop");
    assert.equal((await joinRoom(db, { userId: saver, roomId: "shop", now })).ok, true);
    assert.equal((await roomCallMember(db, saver, "shop", now)).kind, "member");
    const later = new Date(now.getTime() + 1000);
    for (const [id, name] of [[saver, "Gone"], [stew, "GoneStew"]]) {
      await db.query(
        `insert into access_log
         (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
         values ($1, $2, $3, 'member', '', 'revoke', 'test', 'test', 'test', 'Revoked for the test.', $4)`,
        [randomUUID(), id, name, later],
      );
    }
    assert.equal((await roomCallMember(db, saver, "shop", later)).kind, "outsider");
    assert.equal((await roomCallMember(db, stew, "shop", later)).kind, "outsider");

    // Over HTTP: 403 and no TURN credential minted.
    let minted = 0;
    const app = createApp({
      db,
      origins: ["http://localhost:8080"],
      now: () => later,
      createAccount: async () => ({ id: "unused" }),
      signIn: async () => ({ ok: false, status: 500, message: "unused" }),
      readSession: async (headers) => {
        const id = headers.get("x-user-id");
        return id ? { id, name: "Gone", email: "gone@example.com" } : null;
      },
      forwardAuth: async () => new Response(null, { status: 500 }),
      calls: {
        config: readCallsConfig({
          CALLS: "on",
          CALLS_STUN_URLS: "stun:turn.example.com:3478",
          CALLS_TURN_URLS: "turn:turn.example.com:3478?transport=udp",
          CALLS_TURN_SECRET: "c".repeat(40),
        }),
        store: createCallStore(),
        now: () => later,
        ice: Object.assign(
          async () => {
            minted += 1;
            return [];
          },
          { release() {} },
        ),
      },
    });
    for (const id of [saver, stew]) {
      const res = await app(
        new Request("http://127.0.0.1:8787/api/calls/rooms/shop/join", {
          method: "POST",
          headers: { "x-user-id": id, "content-type": "application/json" },
          body: "{}",
        }),
      );
      assert.equal(res.status, 403);
      assert.equal(JSON.stringify(await res.json()).includes("credential"), false);
    }
    assert.equal(minted, 0);
  } finally {
    await close();
  }
});
