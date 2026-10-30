import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp } from "../http.ts";
import { openRollCallDb } from "../closed-test/roll-call-db.ts";
import type { Db } from "../db.ts";
import { listPeers, recordAttendance, rememberNamedAccounts } from "./store.ts";

// POST /api/dm/attendance adds the cards sent and never removes earlier rows.
// Before, it deleted all of the caller's rows and re-inserted only the cards
// sent, so a device showing fewer "went" cards, or an empty list, dropped them.

const now = new Date("2026-10-30T16:00:00Z");

async function member(db: Db, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, name, `${name}-${id}@example.com`],
  );
  return id;
}

async function hosted(db: Db, room: string, hostId: string, came: string[], cardId: string) {
  const postId = randomUUID();
  await db.query(
    `insert into board_post (id, room_id, author_user_id, author_name, type, claim, came, card_id, created_at)
     values ($1, $2, $3, 'Host', 'hosted', 'Test write-up.', $4, $5, now())`,
    [postId, room, hostId, came, cardId],
  );
  await rememberNamedAccounts(db, postId);
}

async function rows(
  db: Db,
  userId: string,
): Promise<{ meeting_id: string; recorded_at: string }[]> {
  return (
    await db.query<{ meeting_id: string; recorded_at: Date | string }>(
      `select meeting_id, recorded_at from dm_attendance where user_id = $1 order by meeting_id`,
      [userId],
    )
  ).map((row) => ({
    meeting_id: row.meeting_id,
    recorded_at: new Date(row.recorded_at).toISOString(),
  }));
}

async function setup() {
  const opened = await openRollCallDb();
  const { db } = opened;
  const host = await member(db, "Host");
  const guest = await member(db, "Guest");
  const other = await member(db, "Other");
  await hosted(db, "shop", host, ["Host", "Guest"], "s-one");
  await hosted(db, "shop", host, ["Host", "Guest"], "s-two");
  await hosted(db, "coop", host, ["Host", "Guest"], "s-three");
  await hosted(db, "shop", host, ["Host", "Other"], "s-not-guest");
  return { ...opened, host, guest, other };
}

test("an empty list changes nothing", async () => {
  const { db, close, guest, host } = await setup();
  try {
    assert.equal((await recordAttendance(db, guest, now, ["s-one", "s-two"])).ok, true);
    const before = await rows(db, guest);
    assert.deepEqual(
      before.map((row) => row.meeting_id),
      ["s-one", "s-two"],
    );
    assert.deepEqual(await recordAttendance(db, guest, new Date(now.getTime() + 60_000), []), {
      ok: true,
      value: null,
    });
    assert.deepEqual(await rows(db, guest), before);
    assert.deepEqual(
      (await listPeers(db, host)).map((peer) => peer.id),
      [guest],
    );
  } finally {
    await close();
  }
});

test("a smaller list keeps the earlier rows and adds the new one", async () => {
  const { db, close, guest } = await setup();
  try {
    assert.equal((await recordAttendance(db, guest, now, ["s-one", "s-two"])).ok, true);
    const first = await rows(db, guest);
    assert.equal(
      (await recordAttendance(db, guest, new Date(now.getTime() + 60_000), ["s-two"])).ok,
      true,
    );
    assert.deepEqual(await rows(db, guest), first);
    assert.equal((await recordAttendance(db, guest, now, ["s-three"])).ok, true);
    assert.deepEqual(
      (await rows(db, guest)).map((row) => row.meeting_id),
      ["s-one", "s-three", "s-two"],
    );
  } finally {
    await close();
  }
});

test("duplicates in one list or across calls make one row, and the first time stays", async () => {
  const { db, close, guest } = await setup();
  try {
    assert.equal((await recordAttendance(db, guest, now, ["s-one", "s-one", " s-one "])).ok, true);
    const later = new Date(now.getTime() + 3_600_000);
    assert.equal((await recordAttendance(db, guest, later, ["s-one"])).ok, true);
    assert.deepEqual(await rows(db, guest), [
      { meeting_id: "s-one", recorded_at: now.toISOString() },
    ]);
  } finally {
    await close();
  }
});

test("the gates still refuse: a card you were not named on, and a room whose audience rule keeps you out", async () => {
  const { db, close, guest } = await setup();
  try {
    assert.equal((await recordAttendance(db, guest, now, ["s-one"])).ok, true);
    // Not named on that write-up: accepted, but nothing is stored for it.
    assert.equal((await recordAttendance(db, guest, now, ["s-not-guest", "s-made-up"])).ok, true);
    assert.deepEqual(
      (await rows(db, guest)).map((row) => row.meeting_id),
      ["s-one"],
    );
    // The co-op becomes men-only and Guest has stated no gender: the room's
    // audience rule refuses the whole request and nothing changes.
    await db.query(`update room set audience = 'men' where id = 'coop'`);
    const refused = await recordAttendance(db, guest, now, ["s-two", "s-three"]);
    assert.equal(refused.ok, false);
    assert.deepEqual(
      (await rows(db, guest)).map((row) => row.meeting_id),
      ["s-one"],
    );
  } finally {
    await close();
  }
});

test("the route keeps its response shape", async () => {
  const { db, close, guest } = await setup();
  try {
    const handler = createApp({
      db,
      origins: ["http://localhost:8080"],
      now: () => now,
      createAccount: async () => {
        throw new Error("unused");
      },
      signIn: async () => {
        throw new Error("unused");
      },
      readSession: async (headers) => {
        const id = headers.get("x-user-id");
        const found = await db.query<{ id: string; name: string; email: string }>(
          `select id, name, email from "user" where id = $1`,
          [id],
        );
        return found[0] ?? null;
      },
      forwardAuth: async () => new Response(null, { status: 404 }),
    });
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, 'Guest', 'member', '', 'grant', 'test', 'test', 'test', 'For the test.', $3)`,
      [randomUUID(), guest, new Date("2026-09-01T00:00:00Z")],
    );
    const post = async (cardIds: string[]) => {
      const response = await handler(
        new Request("http://127.0.0.1:8787/api/dm/attendance", {
          method: "POST",
          headers: {
            origin: "http://localhost:8080",
            "x-user-id": guest,
            "content-type": "application/json",
          },
          body: JSON.stringify({ cardIds }),
        }),
      );
      return { status: response.status, body: await response.json() };
    };
    assert.deepEqual(await post(["s-one"]), { status: 200, body: { ok: true } });
    assert.deepEqual(await post([]), { status: 200, body: { ok: true } });
    assert.deepEqual(
      (await rows(db, guest)).map((row) => row.meeting_id),
      ["s-one"],
    );
  } finally {
    await close();
  }
});

test("a meeting older than the 12-month retention window cannot be confirmed, or re-sent after the purge", async () => {
  const { db, close, guest } = await setup();
  try {
    // s-one's write-up is dated 13 months back; s-two was filed (no date) 13 months back.
    await db.query(`update board_post set on_date = '2025-09-29' where card_id = 's-one'`);
    await db.query(
      `update board_post set on_date = '', created_at = '2025-09-29T12:00:00Z' where card_id = 's-two'`,
    );
    assert.deepEqual(await recordAttendance(db, guest, now, ["s-one", "s-two", "s-three"]), {
      ok: true,
      value: null,
    });
    assert.deepEqual(
      (await rows(db, guest)).map((row) => row.meeting_id),
      ["s-three"],
    );
    // Just inside the window still counts.
    await db.query(`update board_post set on_date = '2025-10-30' where card_id = 's-one'`);
    assert.equal((await recordAttendance(db, guest, now, ["s-one"])).ok, true);
    assert.deepEqual(
      (await rows(db, guest)).map((row) => row.meeting_id),
      ["s-one", "s-three"],
    );
  } finally {
    await close();
  }
});
