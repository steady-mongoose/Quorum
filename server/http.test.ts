import assert from "node:assert/strict";
import test from "node:test";
import { createApp, type AppDeps } from "./http.ts";
import { mintInvite, seatFoundingAdmin } from "./closed-test/store.ts";
import { openTestDb } from "./closed-test/test-db.ts";
import type { Db } from "./db.ts";
import { randomUUID } from "node:crypto";

const origins = ["http://localhost:8080"];

function app(db: Db, extra: Partial<AppDeps> = {}) {
  return createApp({
    db,
    origins,
    now: () => new Date("2026-10-19T12:00:00Z"),
    createUser: async (input) => {
      const id = randomUUID();
      await db.query(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ($1, $2, $3, true, now(), now())`,
        [id, input.name, input.email],
      );
      return { ok: true, user: { id, name: input.name, email: input.email } };
    },
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      return { id, name: "Josh", email: "josh@example.com" };
    },
    forwardAuth: async () => {
      throw new Error("auth handler should not see an open sign-up");
    },
    ...extra,
  });
}

test("health reports the database, and a database failure is a JSON 503", async () => {
  const { db, close } = await openTestDb();
  try {
    const ok = await app(db)(new Request("http://127.0.0.1:8787/api/health"));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
    const down = await app(db, {
      db: {
        query: async () => {
          throw new Error("connection refused");
        },
        transaction: async (fn) => fn(db),
      },
    })(new Request("http://127.0.0.1:8787/api/health"));
    assert.equal(down.status, 503);
    assert.deepEqual(await down.json(), { ok: false, error: "db-unavailable" });
  } finally {
    await close();
  }
});

test("open sign-up is refused before Better Auth", async () => {
  const { db, close } = await openTestDb();
  try {
    const response = await app(db)(
      new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
        method: "POST",
        headers: { origin: "http://localhost:8080", "content-type": "application/json" },
        body: JSON.stringify({ email: "a@example.com", password: "correct-horse", name: "A" }),
      }),
    );
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, "invite-only");
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:8080");
  } finally {
    await close();
  }
});

test("signup requires an invite, then a member can read who invited whom", async () => {
  const { db, close } = await openTestDb();
  try {
    const seated = await seatFoundingAdmin(
      db,
      {
        envName: "1",
        email: "josh@example.com",
        password: "correct-horse",
        headers: new Headers(),
      },
      async (input) => {
        const id = randomUUID();
        await db.query(
          `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
           values ($1, $2, $3, true, now(), now())`,
          [id, input.name, input.email],
        );
        return { ok: true, user: { id, name: input.name, email: input.email } };
      },
    );
    assert.equal(seated.ok, true);
    if (!seated.ok) return;
    const handler = app(db);
    const missing = await handler(
      new Request("http://127.0.0.1:8787/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Maria",
          email: "maria@example.com",
          password: "correct-horse",
        }),
      }),
    );
    assert.equal(missing.status, 400);

    const minted = await mintInvite(
      db,
      { userId: seated.value.userId, maxUses: undefined, expiresInDays: undefined },
      new Date("2026-10-19T12:00:00Z"),
    );
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    const signed = await handler(
      new Request("http://127.0.0.1:8787/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:8080" },
        body: JSON.stringify({
          name: "Maria",
          email: "maria@example.com",
          password: "correct-horse",
          inviteCode: minted.value.code,
        }),
      }),
    );
    assert.equal(signed.status, 200);
    const log = await handler(
      new Request("http://127.0.0.1:8787/api/invite-log", {
        headers: { "x-user-id": seated.value.userId },
      }),
    );
    assert.equal(log.status, 200);
    const body = (await log.json()) as {
      entries: Array<{ invitedName: string; invitedByName: string }>;
    };
    assert.deepEqual(
      body.entries.map((entry) => `${entry.invitedByName}->${entry.invitedName}`),
      ["Josh->Maria"],
    );
    const anonymous = await handler(
      new Request("http://127.0.0.1:8787/api/invites", { method: "POST" }),
    );
    assert.equal(anonymous.status, 401);
  } finally {
    await close();
  }
});

test("sign-in is forwarded and a stranger origin is not echoed", async () => {
  const { db, close } = await openTestDb();
  try {
    let forwarded = false;
    const handler = app(db, {
      forwardAuth: async () => {
        forwarded = true;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const response = await handler(
      new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: "{}",
      }),
    );
    assert.equal(forwarded, true);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
    await close();
  }
});
