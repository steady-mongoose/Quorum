import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp, type AppDeps } from "../http.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";

const start = new Date("2026-10-19T12:00:00Z").getTime();

function app(db: Db) {
  let clock = start;
  return {
    clock: () => {
      clock += 1000;
      return clock;
    },
    handler: createApp({
      db,
      origins: ["http://localhost:8080"],
      now: () => new Date(clock),
      createAccount: async () => ({ id: "unused" }),
      signIn: async () => ({ ok: false, status: 500, message: "unused" }),
      readSession: async (headers) => {
        const id = headers.get("x-user-id");
        if (!id) return null;
        return {
          id,
          name: headers.get("x-user-name") ?? "Josh",
          email: headers.get("x-user-email") ?? "josh@example.com",
        };
      },
      forwardAuth: async () => new Response(null, { status: 500 }),
    } satisfies AppDeps),
  };
}

test("group routes require a session", async () => {
  const { db, close } = await openTestDb();
  try {
    const response = await app(db).handler(new Request("http://127.0.0.1:8787/api/groups"));
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, "Sign in first.");
  } finally {
    await close();
  }
});

test("a group post is newest first over HTTP, with no likes or scores", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    const stamp = new Date(start);
    for (const [id, name, email] of [
      [maria, "Maria", "maria@example.com"],
      [josh, "Josh", "josh@example.com"],
    ] as const) {
      await db.query(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ($1, $2, $3, true, $4, $4)`,
        [id, name, email, stamp],
      );
      await db.query(
        `insert into access_log
         (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
         values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $4)`,
        [randomUUID(), id, name, stamp],
      );
    }
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, 'Josh', 'steward', 'shop', 'grant', 'test', 'test', 'test', 'Granted for the test.', $3)`,
      [randomUUID(), josh, stamp],
    );
    await db.query(`insert into room_member (room_id, user_id) values ('shop', $1)`, [maria]);

    const { handler, clock } = app(db);
    const ask = await handler(
      new Request("http://127.0.0.1:8787/api/group-requests", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": maria, "x-user-name": "Maria" },
        body: JSON.stringify({
          name: "Beekeeping",
          about: "Hives and the first spring check.",
          roomId: "shop",
          likes: 12,
          score: 9,
        }),
      }),
    );
    assert.equal(ask.status, 201);
    const asked = (await ask.json()) as {
      id: string;
      groupId: string;
      likes?: number;
      score?: number;
    };
    assert.equal(asked.groupId, "beekeeping");
    assert.equal(asked.likes, undefined);
    assert.equal(asked.score, undefined);
    clock();

    const approved = await handler(
      new Request(`http://127.0.0.1:8787/api/group-requests/${asked.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": josh, "x-user-name": "Josh" },
        body: JSON.stringify({ decision: "approved", note: "Members asked for this group." }),
      }),
    );
    assert.equal(approved.status, 200);
    clock();

    const older = await handler(
      new Request("http://127.0.0.1:8787/api/groups/beekeeping/posts", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": maria, "x-user-name": "Maria" },
        body: JSON.stringify({
          body: "Saturday bench, bring a hand plane.",
          on: "2026-10-25",
          likes: 4,
        }),
      }),
    );
    assert.equal(older.status, 201);
    const olderBody = (await older.json()) as { id: string; likes?: number };
    assert.equal(olderBody.likes, undefined);
    clock();

    await handler(
      new Request("http://127.0.0.1:8787/api/groups/beekeeping/join", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": josh, "x-user-name": "Josh" },
        body: "{}",
      }),
    );
    clock();
    const newer = await handler(
      new Request("http://127.0.0.1:8787/api/groups/beekeeping/posts", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": josh, "x-user-name": "Josh" },
        body: JSON.stringify({ body: "The Saturday pour is at the hall.", on: "" }),
      }),
    );
    assert.equal(newer.status, 201);
    clock();

    const marked = await handler(
      new Request(`http://127.0.0.1:8787/api/group-posts/${olderBody.id}/mark`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": maria, "x-user-name": "Maria" },
        body: JSON.stringify({
          mark: "sloppy",
          reason: "The note does not say which Saturday.",
        }),
      }),
    );
    assert.equal(marked.status, 200);

    const listed = await handler(
      new Request("http://127.0.0.1:8787/api/groups/beekeeping", {
        headers: { "x-user-id": maria, "x-user-name": "Maria" },
      }),
    );
    assert.equal(listed.status, 200);
    const page = (await listed.json()) as {
      posts: Array<{ id: string; author: string; mark: string | null; score?: number }>;
      group: { admins: string[] };
    };
    assert.deepEqual(
      page.posts.map((post) => post.author),
      ["Josh", "Maria"],
    );
    assert.equal(page.posts[1]?.mark, "sloppy");
    assert.equal(page.posts[0]?.score, undefined);
    assert.deepEqual(page.group.admins, ["Maria"]);
  } finally {
    await close();
  }
});
