import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp, type AppDeps } from "../http.ts";
import { markOnboarded } from "../profile/gate.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { CHAT_UNAVAILABLE } from "./ready.ts";

const now = new Date("2026-10-21T15:00:00Z");

function app(db: Db) {
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => now,
    createAccount: async () => ({ id: "unused" }),
    signIn: async () => ({ ok: false, status: 500, message: "unused" }),
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      const name = headers.get("x-user-name") ?? "Josh";
      await markOnboarded(db, id, name);
      return {
        id,
        name,
        email: headers.get("x-user-email") ?? "josh@example.com",
      };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
  } satisfies AppDeps);
}

async function member(db: Db, id: string, name: string, email: string, roomId: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, name, email],
  );
  await db.query(
    `insert into access_log
     (id, user_id, name, role, action, vouched_by, approved_by, by_actor, note)
     values ($1, $2, $3, 'member', 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
    [randomUUID(), id, name],
  );
  await db.query(`insert into room_member (room_id, user_id) values ($1, $2)`, [roomId, id]);
}

test("room chat requires a session", async () => {
  const { db, close } = await openTestDb();
  try {
    const response = await app(db)(new Request("http://127.0.0.1:8787/api/rooms/shop/chat"));
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, "Sign in first.");
  } finally {
    await close();
  }
});

test("two members poll the room in time order, and a ban or removal stops the next poll", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    await member(db, maria, "Maria", "maria@example.com", "shop");
    await member(db, josh, "Josh", "josh@example.com", "shop");
    const handler = app(db);
    const first = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": maria,
          "x-user-name": "Maria",
        },
        body: JSON.stringify({
          text: "The bench is clear.",
          like: 3,
          score: 10,
          reaction: "heart",
        }),
      }),
    );
    assert.equal(first.status, 201);
    const firstBody = (await first.json()) as {
      message?: { id?: string; seq?: number; text?: string };
    };
    assert.equal(firstBody.message?.text, "The bench is clear.");
    assert.equal("like" in (firstBody.message ?? {}), false);
    assert.equal("score" in (firstBody.message ?? {}), false);
    assert.equal("reaction" in (firstBody.message ?? {}), false);

    const second = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": josh,
          "x-user-name": "Josh",
        },
        body: JSON.stringify({ text: "I will bring the oil." }),
      }),
    );
    assert.equal(second.status, 201);
    const seen = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop/chat", {
        headers: { "x-user-id": josh, "x-user-name": "Josh" },
      }),
    );
    assert.equal(seen.status, 200);
    const page = (await seen.json()) as { messages?: Array<{ text?: string; seq?: number }> };
    assert.deepEqual(
      page.messages?.map((message) => message.text),
      ["The bench is clear.", "I will bring the oil."],
    );
    const seqs = (page.messages ?? []).map((message) => Number(message.seq));
    assert.deepEqual(
      seqs,
      [...seqs].sort((a, b) => a - b),
    );

    const outsider = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/county/chat", {
        headers: { "x-user-id": josh, "x-user-name": "Josh" },
      }),
    );
    assert.equal(outsider.status, 403);
    const outsiderBody = (await outsider.json()) as { error?: string };
    assert.equal(outsiderBody.error, "You are not in this room.");

    await db.query(`delete from room_member where room_id = 'shop' and user_id = $1`, [josh]);
    const dropped = await handler(
      new Request(
        `http://127.0.0.1:8787/api/rooms/shop/chat?after=${firstBody.message?.seq ?? 0}`,
        { headers: { "x-user-id": josh, "x-user-name": "Josh" } },
      ),
    );
    assert.equal(dropped.status, 403);
    const droppedBody = (await dropped.json()) as { error?: string };
    assert.equal(droppedBody.error, "You are not in this room.");

    await db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, created_at)
       values ($1, $2, 'Maria', 'porn', 'Tom', 1, $3, $4)`,
      [randomUUID(), maria, new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), now],
    );
    const barred = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop/chat", {
        headers: { "x-user-id": maria, "x-user-name": "Maria" },
      }),
    );
    assert.equal(barred.status, 403);
    const barredBody = (await barred.json()) as { error?: string; ban?: { reason?: string } };
    assert.equal(barredBody.error, "banned");
    assert.equal(barredBody.ban?.reason, "porn");
  } finally {
    await close();
  }
});

test("a missing chat table leaves the board up and says chat is not available", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    await member(db, maria, "Maria", "maria-early@example.com", "shop");
    await db.query(`drop table room_chat_removal, room_chat_message cascade`);
    const handler = app(db);
    const headers = { "x-user-id": maria, "x-user-name": "Maria" };
    const board = await handler(new Request("http://127.0.0.1:8787/api/board", { headers }));
    assert.equal(board.status, 200);
    const read = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop/chat", { headers }),
    );
    assert.equal(read.status, 503);
    const readBody = (await read.json()) as { error?: string };
    assert.equal(readBody.error, CHAT_UNAVAILABLE);
    const sent = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop/chat", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ text: "The bench is clear." }),
      }),
    );
    assert.equal(sent.status, 503);
    const sentBody = (await sent.json()) as { error?: string };
    assert.equal(sentBody.error, CHAT_UNAVAILABLE);
    const removed = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop/chat/line-1/remove", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ reason: "threat" }),
      }),
    );
    assert.equal(removed.status, 503);
  } finally {
    await close();
  }
});
