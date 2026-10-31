import "../../src/lib/board/test-storage.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openRollCallDb } from "../closed-test/roll-call-db.ts";
import type { Db } from "../db.ts";
import { newCard, type MeetingCard } from "../../src/lib/board/model.ts";
import { useBoard } from "../../src/lib/board/store.ts";
import { DAY, call, inRoom, member, testApp } from "./reach-harness.ts";
import { rememberNamedAccounts } from "./store.ts";

// "I went" is the member's own act, so it may tell the server. A card id on the
// signed-in board is the gathering's id, the same id the host's write-up files
// as card_id, so it passes CONFIRMABLE when the write-up names this member.

const now = new Date("2026-10-31T12:00:00.000Z");
const long = new Date(now.getTime() - 20 * DAY);

/** test-storage makes window the global, and PGlite then looks for window.location. */
async function openDb() {
  const window = Object.getOwnPropertyDescriptor(globalThis, "window");
  Reflect.deleteProperty(globalThis, "window");
  try {
    return await openRollCallDb();
  } finally {
    if (window) Object.defineProperty(globalThis, "window", window);
  }
}

async function writeUp(db: Db, host: string, cardId: string, came: string[]) {
  const postId = randomUUID();
  await db.query(
    `insert into board_post (id, room_id, author_user_id, author_name, type, claim, came, card_id, created_at)
     values ($1, 'shop', $2, 'TestHost', 'hosted', 'The night went well.', $3, $4, $5)`,
    [postId, host, came, cardId, new Date(now.getTime() - DAY)],
  );
  await rememberNamedAccounts(db, postId);
}

function meeting(id: string, kind: MeetingCard["kind"] = "meeting"): MeetingCard {
  return newCard({ id, room: "shop", kind, name: "Night", place: "Hall", time: "Tue", host: "" });
}

function tapAs(handler: ReturnType<typeof testApp>, userId: string, posts: string[]) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "");
    posts.push(`${init?.method ?? "GET"} ${path} ${String(init?.body ?? "")}`);
    return handler(
      new Request(`http://127.0.0.1:8787${path}`, {
        method: init?.method ?? "GET",
        headers: {
          origin: "http://localhost:8080",
          "x-user-id": userId,
          "content-type": "application/json",
        },
        body: init?.body ?? undefined,
      }),
    );
  }) as typeof fetch;
}

async function guests(db: Db) {
  return (
    await db.query<{ user_id: string; meeting_id: string }>(
      `select user_id, meeting_id from dm_attendance order by user_id`,
    )
  ).map((row) => [row.user_id, row.meeting_id]);
}

test("tapping I went, signed in, gives reach when the write-up names you", async () => {
  const { db, close } = await openDb();
  const realFetch = globalThis.fetch;
  try {
    const handler = testApp(db, () => now);
    const host = await member(db, "TestHost", long);
    const guest = await member(db, "TestGuest", long);
    await inRoom(db, host, "shop", long);
    const card = randomUUID();
    await writeUp(db, host, card, ["TestHost", "TestGuest"]);

    const peers = async (who: string) => (await call(handler, who, "GET", "/api/dm/peers")).body;
    assert.deepEqual(await peers(host), { peers: [] }, "no reach before the tap");

    const posts: string[] = [];
    tapAs(handler, guest, posts);
    useBoard.setState({ remote: true, me: "TestGuest", cards: [meeting(card)], boardError: "" });
    await useBoard.getState().visited(card);

    assert.deepEqual(posts, [`POST /api/dm/attendance {"cardIds":["${card}"]}`]);
    assert.deepEqual(await guests(db), [[guest, card]]);
    assert.deepEqual(await peers(guest), { peers: [{ id: host, name: "TestHost" }] });
    // The host has no attendance row and needs none, so a write-up posts nothing.
    assert.deepEqual(await peers(host), { peers: [{ id: guest, name: "TestGuest" }] });
    const opened = await call(handler, guest, "POST", "/api/dm/threads", { userId: host });
    assert.equal(opened.status, 201);
  } finally {
    globalThis.fetch = realFetch;
    await close();
  }
});

test("the tap stores nothing and gives no reach when no write-up names you", async () => {
  const { db, close } = await openDb();
  const realFetch = globalThis.fetch;
  try {
    const handler = testApp(db, () => now);
    const host = await member(db, "TestHost", long);
    const guest = await member(db, "TestGuest", long);
    const named = randomUUID();
    const notYet = randomUUID();
    await writeUp(db, host, named, ["TestHost"]);
    const posts: string[] = [];
    tapAs(handler, guest, posts);
    useBoard.setState({
      remote: true,
      me: "TestGuest",
      cards: [meeting(named), meeting(notYet)],
      boardError: "",
    });
    await useBoard.getState().visited(named);
    await useBoard.getState().visited(notYet);
    assert.equal(posts.length, 2, "both taps are sent");
    assert.deepEqual(await guests(db), [], "the server keeps neither");
    assert.deepEqual(useBoard.getState().boardError, "");
    for (const item of useBoard.getState().cards) {
      assert.deepEqual(item.wentBy, ["TestGuest"]);
    }
  } finally {
    globalThis.fetch = realFetch;
    await close();
  }
});

test("a failed POST leaves the tap standing and says nothing", async () => {
  const realFetch = globalThis.fetch;
  const answers: (() => Promise<Response>)[] = [
    async () => {
      throw new Error("offline");
    },
    async () => new Response(JSON.stringify({ error: "No." }), { status: 500 }),
  ];
  try {
    for (const answer of answers) {
      const card = randomUUID();
      globalThis.fetch = answer as typeof fetch;
      useBoard.setState({ remote: true, me: "TestGuest", cards: [meeting(card)], boardError: "" });
      const tap = useBoard.getState().visited(card);
      // The tap shows before the request is answered.
      assert.deepEqual(useBoard.getState().cards[0]?.wentBy, ["TestGuest"]);
      await tap;
      assert.deepEqual(useBoard.getState().cards[0]?.wentBy, ["TestGuest"]);
      assert.equal(useBoard.getState().cards[0]?.unverified, false);
      assert.equal(useBoard.getState().boardError, "");
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("only a signed-in tap on a meeting sends anything", async () => {
  const realFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = (async () => {
    sent += 1;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  try {
    const local = randomUUID();
    useBoard.setState({ remote: false, me: "TestGuest", cards: [meeting(local)] });
    await useBoard.getState().visited(local);
    assert.deepEqual(useBoard.getState().cards[0]?.wentBy, ["TestGuest"]);
    const candidate = randomUUID();
    useBoard.setState({ remote: true, cards: [meeting(candidate, "candidate")] });
    await useBoard.getState().visited(candidate);
    assert.equal(sent, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
