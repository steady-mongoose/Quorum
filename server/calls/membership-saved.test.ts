import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { joinRoom } from "../board/places-store.ts";
import { roomCallMember, roomMemberStanding } from "./membership.ts";
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

test("a revoked member who had posted cannot join or get TURN; a posted-only member still can", async () => {
  const { db, close } = await openTestDb();
  try {
    const poster = await member(db, "Poster");
    const plain = randomUUID();
    await db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'Plain', $2, true, $3, $3)`,
      [plain, `plain-${plain.slice(0, 8)}@example.com`, now],
    );
    for (const id of [poster, plain]) {
      await db.query(`insert into room_member (room_id, user_id) values ('shop', $1)`, [id]);
    }
    assert.equal((await roomCallMember(db, poster, "shop", now)).kind, "member");
    assert.equal((await roomCallMember(db, plain, "shop", now)).kind, "member", "posted-only, no grant row");
    const later = new Date(now.getTime() + 1000);
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, 'Poster', 'member', '', 'revoke', 'test', 'test', 'test', 'Revoked for the test.', $3)`,
      [randomUUID(), poster, later],
    );
    assert.equal((await roomCallMember(db, poster, "shop", later)).kind, "outsider");
    assert.equal((await roomCallMember(db, plain, "shop", later)).kind, "member");

    let minted = 0;
    const app = createApp({
      db,
      origins: ["http://localhost:8080"],
      now: () => later,
      createAccount: async () => ({ id: "unused" }),
      signIn: async () => ({ ok: false, status: 500, message: "unused" }),
      readSession: async (headers) => {
        const id = headers.get("x-user-id");
        return id ? { id, name: "Poster", email: "poster@example.com" } : null;
      },
      forwardAuth: async () => new Response(null, { status: 500 }),
      calls: {
        config: readCallsConfig({
          CALLS: "on",
          CALLS_STUN_URLS: "stun:turn.example.com:3478",
          CALLS_TURN_URLS: "turn:turn.example.com:3478?transport=udp",
          CALLS_TURN_SECRET: "d".repeat(40),
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
    const res = await app(
      new Request("http://127.0.0.1:8787/api/calls/rooms/shop/join", {
        method: "POST",
        headers: { "x-user-id": poster, "content-type": "application/json" },
        body: "{}",
      }),
    );
    assert.equal(res.status, 403);
    assert.equal(JSON.stringify(await res.json()).includes("credential"), false);
    assert.equal(minted, 0, "no relay login for a revoked member");
  } finally {
    await close();
  }
});

async function log(db: Db, id: string, action: "grant" | "revoke", roomId: string, at: Date, rowId = randomUUID()) {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, 'X', 'member', $3, $4, 'test', 'test', 'test', 'For the test.', $5)`,
    [rowId, id, roomId, action, at],
  );
}
const t = (s: number) => new Date(now.getTime() + s * 1000);

test("QA repro: a room revoke in shop is not undone by a later grant in other", async () => {
  const { db, close } = await openTestDb();
  try {
    const m = await member(db, "Shopper");
    await joinRoom(db, { userId: m, roomId: "shop", now });
    await log(db, m, "revoke", "shop", t(1));
    await log(db, m, "grant", "other", t(2));
    assert.equal((await roomCallMember(db, m, "shop", t(3))).kind, "outsider");
    await db.query(`insert into room_member (room_id, user_id) values ('shop', $1)`, [m]);
    assert.equal((await roomCallMember(db, m, "shop", t(3))).kind, "outsider", "posted path too");
    await log(db, m, "grant", "shop", t(4));
    assert.equal((await roomCallMember(db, m, "shop", t(5))).kind, "member", "a later shop grant restores");
  } finally {
    await close();
  }
});

test("a posted member who leaves the room loses call access until they come back", async () => {
  const { db, close } = await openTestDb();
  try {
    const m = await member(db, "Leaver");
    await db.query(`insert into room_member (room_id, user_id) values ('shop', $1)`, [m]);
    await joinRoom(db, { userId: m, roomId: "shop", now });
    assert.equal((await roomCallMember(db, m, "shop", now)).kind, "member");
    await joinRoom(db, { userId: m, roomId: "shop", now, leave: true });
    assert.equal((await roomCallMember(db, m, "shop", now)).kind, "outsider");
    await joinRoom(db, { userId: m, roomId: "shop", now });
    assert.equal((await roomCallMember(db, m, "shop", now)).kind, "member", "rejoining restores it");
  } finally {
    await close();
  }
});

test("a grant and a revoke at the same instant: the revoke wins, whatever the ids", async () => {
  const at = t(1);
  for (const [g, r] of [["a", "b"], ["b", "a"]]) {
    assert.equal(
      roomMemberStanding([
        { id: g, room_id: "shop", action: "grant", at },
        { id: r, room_id: "shop", action: "revoke", at },
      ]),
      "revoked",
    );
  }
  const { db, close } = await openTestDb();
  try {
    const m = await member(db, "Tie");
    await joinRoom(db, { userId: m, roomId: "shop", now });
    await log(db, m, "grant", "shop", t(1), "00000000-0000-0000-0000-00000000000f");
    await log(db, m, "revoke", "shop", t(1), "00000000-0000-0000-0000-000000000001");
    assert.equal((await roomCallMember(db, m, "shop", t(2))).kind, "outsider");
  } finally {
    await close();
  }
});

test("a site-wide revoke beats a room grant until a later site-wide grant", async () => {
  const { db, close } = await openTestDb();
  try {
    const m = await member(db, "Site");
    await joinRoom(db, { userId: m, roomId: "shop", now });
    await log(db, m, "revoke", "", t(1));
    await log(db, m, "grant", "shop", t(2));
    assert.equal((await roomCallMember(db, m, "shop", t(3))).kind, "outsider");
    await log(db, m, "grant", "", t(4));
    assert.equal((await roomCallMember(db, m, "shop", t(5))).kind, "member");
  } finally {
    await close();
  }
});

test("a later site-wide grant does not undo a room revoke; a later room grant does", async () => {
  const { db, close } = await openTestDb();
  try {
    const m = await member(db, "Roomed");
    await joinRoom(db, { userId: m, roomId: "shop", now });
    await log(db, m, "revoke", "shop", t(1));
    await log(db, m, "grant", "", t(2));
    assert.equal((await roomCallMember(db, m, "shop", t(3))).kind, "outsider");
    await log(db, m, "grant", "shop", t(4));
    assert.equal((await roomCallMember(db, m, "shop", t(5))).kind, "member");
  } finally {
    await close();
  }
});
