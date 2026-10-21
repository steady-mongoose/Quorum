import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp, type AppDeps } from "../http.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import { CLIENT_IP_HEADER } from "../proxy.ts";
import { BOARD_WRITE_LIMIT } from "../rate-limit.ts";
import type { Db } from "../db.ts";

const now = new Date("2026-10-19T12:00:00Z");

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
      return {
        id,
        name: headers.get("x-user-name") ?? "Josh",
        email: headers.get("x-user-email") ?? "josh@example.com",
      };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
  } satisfies AppDeps);
}

test("the board requires a session", async () => {
  const { db, close } = await openTestDb();
  try {
    const response = await app(db)(new Request("http://127.0.0.1:8787/api/board"));
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, "Sign in first.");
  } finally {
    await close();
  }
});

test("board writes are rate limited per address", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = app(db);
    const request = () =>
      new Request("http://127.0.0.1:8787/api/rooms", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CLIENT_IP_HEADER]: "203.0.113.77",
          "x-user-id": "user-a",
        },
        body: JSON.stringify({ id: "woodshop", name: "Woodshop", what: "A bench night." }),
      });
    for (let n = 0; n < BOARD_WRITE_LIMIT.max; n += 1) {
      const response = await handler(request());
      assert.equal(response.status, 403);
    }
    const blocked = await handler(request());
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
    const other = await handler(
      new Request("http://127.0.0.1:8787/api/rooms", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CLIENT_IP_HEADER]: "203.0.113.78",
          "x-user-id": "user-b",
        },
        body: JSON.stringify({ id: "woodshop", name: "Woodshop", what: "A bench night." }),
      }),
    );
    assert.equal(other.status, 403);
  } finally {
    await close();
  }
});

test("two signed-in members see the same post", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    for (const [id, name, email] of [
      [maria, "Maria", "maria@example.com"],
      [josh, "Josh", "josh@example.com"],
    ] as const) {
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
    }
    const handler = app(db);
    const filed = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop/posts", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": maria, "x-user-name": "Maria" },
        body: JSON.stringify({
          type: "did",
          claim: "Sharpened the chisels in the shop.",
          reason: "Tom checked them on Thursday.",
          on: "2026-10-18",
        }),
      }),
    );
    assert.equal(filed.status, 201);
    const seen = await handler(
      new Request("http://127.0.0.1:8787/api/board", {
        headers: { "x-user-id": josh, "x-user-name": "Josh" },
      }),
    );
    assert.equal(seen.status, 200);
    const body = (await seen.json()) as { posts: Array<{ author: string; claim: string }> };
    assert.equal(
      body.posts.some((post) => post.author === "Maria" && post.claim.includes("chisels")),
      true,
    );
  } finally {
    await close();
  }
});

test("a barred member cannot read the board, the invite log, or a picture", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    await db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'Maria', 'maria@example.com', true, now(), now())`,
      [maria],
    );
    await db.query(
      `insert into access_log
       (id, user_id, name, role, action, vouched_by, approved_by, by_actor, note)
       values ($1, $2, 'Maria', 'member', 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
      [randomUUID(), maria],
    );
    await db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, created_at)
       values ($1, $2, 'Maria', 'threat', 'Tom', 1, $3, $4)`,
      [randomUUID(), maria, new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), now],
    );
    const handler = app(db);
    const headers = { "x-user-id": maria, "x-user-name": "Maria" };
    for (const path of [
      "/api/board",
      "/api/board?room=shop",
      "/api/home",
      "/api/invite-log",
      "/api/media/11111111-1111-4111-8111-111111111111",
    ]) {
      const response = await handler(
        new Request(`http://127.0.0.1:8787${path}`, { headers }),
      );
      assert.equal(response.status, 403, path);
      const body = (await response.json()) as { error?: string; ban?: { reason?: string } };
      assert.equal(body.error, "banned", path);
      assert.equal(body.ban?.reason, "threat", path);
    }
  } finally {
    await close();
  }
});
