import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp } from "../http.ts";
import { openRollCallDb } from "../closed-test/roll-call-db.ts";
import type { Db } from "../db.ts";
import { rememberNamedAccounts } from "./store.ts";
import { listDmPeers, recordAttendance, type DmTransport } from "../../src/lib/e2ee/mailbox.ts";
import { readReach, serverReachReads } from "../../src/lib/board/message-reach-reads.ts";

// QA on #135 (S2): loading a room, Find, a profile or the mailbox must not
// write attendance. The Message buttons' reads are GETs; only the mailbox
// opening a conversation records attendance, which replaces the caller's rows.

async function member(db: Db, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, name, `${name}-${id}@example.com`],
  );
  return id;
}

type Seen = { method: string; path: string }[];

function transport(handler: (r: Request) => Promise<Response>, userId: string, seen: Seen): DmTransport {
  async function call(path: string, method: string, body?: unknown) {
    seen.push({ method, path });
    const headers = new Headers({ origin: "http://localhost:8080", "x-user-id": userId });
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await handler(
      new Request(`http://127.0.0.1:8787${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  return { post: (p, b) => call(p, "POST", b), get: (p) => call(p, "GET") };
}

async function rows(db: Db, userId: string): Promise<string[]> {
  return (
    await db.query<{ meeting_id: string }>(
      `select meeting_id from dm_attendance where user_id = $1 order by meeting_id`,
      [userId],
    )
  ).map((row) => row.meeting_id);
}

test("a page load reads who you may message and writes no attendance, even on a fresh device", async () => {
  const { db, close } = await openRollCallDb();
  const now = new Date("2026-10-30T16:00:00Z");
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
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const errors: unknown[][] = [];
  try {
    const host = await member(db, "TestHost");
    const guest = await member(db, "TestGuest");
    const long = new Date("2026-09-01T00:00:00Z");
    for (const [id, name] of [
      [host, "TestHost"],
      [guest, "TestGuest"],
    ]) {
      await db.query(
        `insert into access_log
         (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
         values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'For the test.', $4)`,
        [randomUUID(), id, name, long],
      );
    }
    for (const room of ["shop", "coop"]) {
      for (const id of [host, guest]) {
        await db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, $2, $3)`, [
          id,
          room,
          long,
        ]);
      }
    }
    // The shop shows its member list; the co-op has it turned off (a 404).
    await db.query(
      `update room set options = array_append(array_remove(options, 'members'), 'members') where id = 'shop'`,
    );
    await db.query(`update room set options = array_remove(options, 'members') where id = 'coop'`);
    const postId = randomUUID();
    await db.query(
      `insert into board_post (id, room_id, author_user_id, author_name, type, claim, came, card_id, created_at)
       values ($1, 'shop', $2, 'TestHost', 'hosted', 'Test write-up.', $3, 's-pageload', now())`,
      [postId, host, ["TestHost", "TestGuest"]],
    );
    await rememberNamedAccounts(db, postId);

    const hostSeen: Seen = [];
    const H = transport(handler, host, hostSeen);
    // The explicit action, as before #135: the mailbox opens a conversation.
    const opened = await recordAttendance(transport(handler, guest, []), ["s-pageload"]);
    assert.equal(opened.ok, true);
    const recorded = await rows(db, guest);
    assert.equal(recorded.length, 1);
    const peersBefore = await listDmPeers(H);
    assert.deepEqual(peersBefore.ok ? peersBefore.peers.map((p) => p.name) : null, ["TestGuest"]);

    // Now the guest loads pages on a fresh device: no local cards at all.
    const seen: Seen = [];
    const G = transport(handler, guest, seen);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input instanceof Request ? input.url : input).replace(/^https?:\/\/[^/]+/, "");
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      seen.push({ method, path });
      return handler(
        new Request(`http://127.0.0.1:8787${path}`, {
          method,
          headers: { origin: "http://localhost:8080", "x-user-id": guest },
          body: init?.body ?? undefined,
        }),
      );
    }) as typeof fetch;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    for (let load = 0; load < 3; load += 1) {
      const answer = await readReach(["shop", "coop"], serverReachReads(G));
      // The hidden co-op list adds nobody and is not an error.
      assert.deepEqual(
        answer.lists.map((list) => list.members.map((m) => m.name).sort()),
        [["TestGuest", "TestHost"]],
      );
      assert.deepEqual(
        answer.peers.map((p) => p.name),
        ["TestHost"],
      );
    }
    console.error = realError;
    globalThis.fetch = realFetch;

    assert.ok(seen.length > 0);
    assert.deepEqual(
      seen.filter((call) => call.method !== "GET" || call.path.includes("/api/dm/attendance")),
      [],
    );
    assert.deepEqual(errors, []);
    // Nothing removed: the guest's attendance and the host's reach are as they were.
    assert.deepEqual(await rows(db, guest), recorded);
    const peersAfter = await listDmPeers(H);
    assert.deepEqual(peersAfter.ok ? peersAfter.peers.map((p) => p.name) : null, ["TestGuest"]);
  } finally {
    console.error = realError;
    globalThis.fetch = realFetch;
    await close();
  }
});
