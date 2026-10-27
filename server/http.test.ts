import assert from "node:assert/strict";
import test from "node:test";
import { createApp, type AppDeps } from "./http.ts";
import { markOnboarded } from "./profile/gate.ts";
import { GENERIC_SIGNUP_ERROR } from "./closed-test/rules.ts";
import {
  mintInvite,
  seatFoundingAdmin,
  type CreateAccount,
  type SignIn,
} from "./closed-test/store.ts";
import { CLIENT_IP_HEADER } from "./proxy.ts";
import { ATTEMPT_LIMIT } from "./rate-limit.ts";
import { openTestDb } from "./closed-test/test-db.ts";
import type { Db } from "./db.ts";
import { randomUUID } from "node:crypto";

const origins = ["http://localhost:8080"];

function app(db: Db, extra: Partial<AppDeps> = {}) {
  return createApp({
    db,
    origins,
    now: () => new Date("2026-10-19T12:00:00Z"),
    createAccount: (async (tx, input) => {
      const id = randomUUID();
      await tx.query(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ($1, $2, $3, true, now(), now())`,
        [id, input.name, input.email],
      );
      return { id };
    }) satisfies CreateAccount,
    signIn: (async (input) => ({
      ok: true,
      user: { id: input.userId, name: input.name, email: input.email },
    })) satisfies SignIn,
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      await markOnboarded(db, id, "Josh");
      return { id, name: "Josh", email: headers.get("x-user-email") ?? "josh@example.com" };
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
    const missingBody = (await missing.json()) as { error?: string; code?: string };
    assert.equal(missingBody.error, "Enter the invite code.");
    assert.equal(missingBody.code, "invite_invalid");
    const wrong = await handler(
      new Request("http://127.0.0.1:8787/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Maria",
          email: "maria@example.com",
          password: "correct-horse",
          inviteCode: "NOT-A-CODE",
        }),
      }),
    );
    assert.equal(wrong.status, 400);
    const wrongBody = (await wrong.json()) as { error?: string; code?: string };
    assert.equal(wrongBody.error, "That code is not valid.");
    assert.equal(wrongBody.code, "invite_invalid");
    const named = await handler(
      new Request("http://127.0.0.1:8787/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "",
          email: "maria@example.com",
          password: "correct-horse",
          inviteCode: "NOT-A-CODE",
        }),
      }),
    );
    const namedBody = (await named.json()) as { error?: string; code?: string };
    assert.equal(namedBody.error, "Enter your name.");
    assert.equal(namedBody.code, undefined);

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

test("a preflight allows DELETE and authorization, and an unknown origin is rejected", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = app(db, { origins: ["https://avouchsocial.com"] });
    const gathering = await handler(
      new Request("http://127.0.0.1:8787/api/gatherings/3f2a9c1e-8241-4c3e-9a11-8241abcd1234", {
        method: "OPTIONS",
        headers: {
          origin: "https://avouchsocial.com",
          "access-control-request-method": "DELETE",
          "access-control-request-headers": "content-type, authorization",
        },
      }),
    );
    assert.equal(gathering.status, 204);
    assert.equal(gathering.headers.get("access-control-allow-origin"), "https://avouchsocial.com");
    assert.equal(gathering.headers.get("access-control-allow-credentials"), "true");
    const methods = (gathering.headers.get("access-control-allow-methods") ?? "")
      .split(",")
      .map((item) => item.trim());
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      assert.equal(methods.includes(method), true, method);
    }
    const allowHeaders = (gathering.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    assert.equal(allowHeaders.includes("content-type"), true);
    assert.equal(allowHeaders.includes("authorization"), true);

    const join = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop/join", {
        method: "OPTIONS",
        headers: {
          origin: "https://avouchsocial.com",
          "access-control-request-method": "DELETE",
          "access-control-request-headers": "authorization",
        },
      }),
    );
    assert.equal(join.status, 204);
    assert.match(join.headers.get("access-control-allow-methods") ?? "", /\bDELETE\b/);
    assert.match(join.headers.get("access-control-allow-headers") ?? "", /authorization/i);
    assert.equal(join.headers.get("access-control-allow-credentials"), "true");

    const stranger = await handler(
      new Request("http://127.0.0.1:8787/api/gatherings/3f2a9c1e-8241-4c3e-9a11-8241abcd1234", {
        method: "OPTIONS",
        headers: {
          origin: "https://evil.example",
          "access-control-request-method": "DELETE",
          "access-control-request-headers": "authorization",
        },
      }),
    );
    assert.equal(stranger.status, 403);
    assert.equal(stranger.headers.get("access-control-allow-origin"), null);
    assert.equal(stranger.headers.get("access-control-allow-credentials"), null);
    assert.equal(stranger.headers.get("vary"), "Origin");
    assert.equal(gathering.headers.get("vary"), "Origin");
  } finally {
    await close();
  }
});

test("DELETE /api/rooms/:id/join leaves the room for an allowed origin", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    await db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, $2, $3, true, now(), now())`,
      [maria, "Maria", "maria@example.com"],
    );
    await db.query(
      `insert into access_log
       (id, user_id, name, role, action, vouched_by, approved_by, by_actor, note)
       values ($1, $2, $3, 'member', 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
      [randomUUID(), maria, "Maria"],
    );
    const handler = app(db, { origins: ["https://avouchsocial.com"] });
    const response = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop/join", {
        method: "DELETE",
        headers: { origin: "https://avouchsocial.com", "x-user-id": maria, "x-user-name": "Maria" },
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { roomId: "shop", joined: false });
    assert.equal(response.headers.get("access-control-allow-origin"), "https://avouchsocial.com");
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  } finally {
    await close();
  }
});

test("a text/plain POST from an unknown origin is rejected, and a caller with no origin is not", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = app(db, { origins: ["https://avouchsocial.com"] });
    const evil = await handler(
      new Request("http://127.0.0.1:8787/api/signup", {
        method: "POST",
        headers: { origin: "https://evil.com", "content-type": "text/plain" },
        body: "name=Ada",
      }),
    );
    assert.equal(evil.status, 403);
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
    assert.equal(evil.headers.get("vary"), "Origin");
    const referred = await handler(
      new Request("http://127.0.0.1:8787/api/signup", {
        method: "POST",
        headers: { referer: "https://evil.com/phish", "content-type": "text/plain" },
        body: "name=Ada",
      }),
    );
    assert.equal(referred.status, 403);
    const health = await handler(new Request("http://127.0.0.1:8787/api/health"));
    assert.equal(health.status, 200);
    const sameOrigin = await handler(
      new Request("http://127.0.0.1:8787/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ada" }),
      }),
    );
    assert.notEqual(sameOrigin.status, 403);
    const listedReferer = await handler(
      new Request("http://127.0.0.1:8787/api/signup", {
        method: "POST",
        headers: {
          referer: "https://avouchsocial.com/find",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Ada" }),
      }),
    );
    assert.notEqual(listedReferer.status, 403);
  } finally {
    await close();
  }
});

test("sign-in from an allowed origin is forwarded, and a stranger origin is rejected", async () => {
  const { db, close } = await openTestDb();
  try {
    let forwarded = "";
    const handler = app(db, {
      forwardAuth: async (request) => {
        forwarded = await request.text();
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const response = await handler(
      new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
        method: "POST",
        headers: { origin: "http://localhost:8080", "content-type": "application/json" },
        body: JSON.stringify({ email: "josh@example.com", password: "correct-horse" }),
      }),
    );
    assert.equal(
      forwarded,
      JSON.stringify({ email: "josh@example.com", password: "correct-horse" }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:8080");
    forwarded = "";
    const stranger = await handler(
      new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ email: "josh@example.com", password: "correct-horse" }),
      }),
    );
    assert.equal(forwarded, "");
    assert.equal(stranger.status, 403);
    assert.equal(stranger.headers.get("access-control-allow-origin"), null);
    assert.equal(stranger.headers.get("vary"), "Origin");
  } finally {
    await close();
  }
});

test("signup errors do not say whether the email is registered", async () => {
  const { db, close } = await openTestDb();
  try {
    const seated = await seatFoundingAdmin(
      db,
      {
        envName: "Josh",
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
    const minted = await mintInvite(
      db,
      { userId: seated.value.userId, maxUses: 1, expiresInDays: 7 },
      new Date("2026-10-19T12:00:00Z"),
    );
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    const handler = app(db, {
      createAccount: async () => {
        throw new Error("User already exists. Use another email. maria@example.com");
      },
    });
    const response = await handler(
      new Request("http://127.0.0.1:8787/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json", [CLIENT_IP_HEADER]: "203.0.113.9" },
        body: JSON.stringify({
          name: "Maria",
          email: "maria@example.com",
          password: "correct-horse",
          inviteCode: minted.value.code,
        }),
      }),
    );
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, GENERIC_SIGNUP_ERROR);
    assert.equal(JSON.stringify(body).includes("maria@example.com"), false);
    assert.equal(JSON.stringify(body).includes("already"), false);
    const uses = await db.query<{ uses: number }>(`select uses from invite_code`);
    assert.equal(Number(uses[0]?.uses), 0);
  } finally {
    await close();
  }
});

function attempt(path: string, ip: string, body: string, headers: Record<string, string> = {}) {
  return new Request(`http://127.0.0.1:8787${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", [CLIENT_IP_HEADER]: ip, ...headers },
    body,
  });
}

test("signup is limited per address and per email", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = app(db);
    const body = JSON.stringify({ name: "A", email: "A@Example.com", password: "short" });
    for (let n = 0; n < ATTEMPT_LIMIT.max; n += 1) {
      const response = await handler(attempt("/api/signup", "203.0.113.10", body));
      assert.equal(response.status, 400);
    }
    const blocked = await handler(attempt("/api/signup", "203.0.113.10", body));
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
    const sameEmail = await handler(
      attempt(
        "/api/signup",
        "203.0.113.11",
        JSON.stringify({ name: "A", email: "a@example.com", password: "short" }),
      ),
    );
    assert.equal(sameEmail.status, 429);
    assert.ok(Number(sameEmail.headers.get("retry-after")) >= 1);
    const otherEmail = await handler(
      attempt(
        "/api/signup",
        "203.0.113.12",
        JSON.stringify({ name: "B", email: "b@example.com", password: "short" }),
      ),
    );
    assert.equal(otherEmail.status, 400);
  } finally {
    await close();
  }
});

test("sign-in is limited per address and per email and a blocked attempt is not forwarded", async () => {
  const { db, close } = await openTestDb();
  try {
    let forwarded = 0;
    const handler = app(db, {
      forwardAuth: async () => {
        forwarded += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    const body = JSON.stringify({ email: "Maria@Example.com", password: "correct-horse" });
    for (let n = 0; n < ATTEMPT_LIMIT.max; n += 1) {
      const response = await handler(attempt("/api/auth/sign-in/email", "203.0.113.20", body));
      assert.equal(response.status, 200);
    }
    const blocked = await handler(attempt("/api/auth/sign-in/email", "203.0.113.20", body));
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
    assert.equal(forwarded, ATTEMPT_LIMIT.max);
    const sameEmail = await handler(
      attempt(
        "/api/auth/sign-in/email",
        "203.0.113.21",
        JSON.stringify({ email: "maria@example.com", password: "correct-horse" }),
      ),
    );
    assert.equal(sameEmail.status, 429);
    assert.equal(forwarded, ATTEMPT_LIMIT.max);
  } finally {
    await close();
  }
});

test("a bad email is refused and does not become a rate-limit key", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = app(db);
    const huge = `${"a".repeat(190)}@example.com`;
    const response = await handler(
      attempt(
        "/api/signup",
        "203.0.113.40",
        JSON.stringify({ name: "A", email: huge, password: "short" }),
      ),
    );
    assert.equal(response.status, 400);
    const keys = (await db.query<{ key: string }>(`select "key" from "rateLimit"`)).map(
      (row) => row.key,
    );
    assert.deepEqual(keys, ["signup:ip:203.0.113.40"]);
    assert.equal(
      keys.some((key) => key.includes(huge)),
      false,
    );
  } finally {
    await close();
  }
});

test("gmail dots share an email bucket, other domains keep dots, and one IPv6 /64 shares an address bucket", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = app(db);
    const dotted = JSON.stringify({ name: "A", email: "A.B+tag@Gmail.com", password: "short" });
    for (let n = 0; n < ATTEMPT_LIMIT.max; n += 1) {
      const response = await handler(attempt("/api/signup", "2001:db8:4:5::1", dotted));
      assert.equal(response.status, 400);
    }
    const sameEmail = await handler(
      attempt(
        "/api/signup",
        "203.0.113.41",
        JSON.stringify({ name: "A", email: "ab@googlemail.com", password: "short" }),
      ),
    );
    assert.equal(sameEmail.status, 429);
    const corp = JSON.stringify({ name: "B", email: "first.last@corp.com", password: "short" });
    for (let n = 0; n < ATTEMPT_LIMIT.max; n += 1) {
      const response = await handler(attempt("/api/signup", `203.0.113.${50 + n}`, corp));
      assert.equal(response.status, 400);
    }
    const otherMailbox = await handler(
      attempt(
        "/api/signup",
        "203.0.113.60",
        JSON.stringify({ name: "B", email: "firstlast@corp.com", password: "short" }),
      ),
    );
    assert.equal(otherMailbox.status, 400);
    const samePrefix = await handler(
      attempt(
        "/api/signup",
        "2001:db8:4:5:ffff::99",
        JSON.stringify({ name: "C", email: "c@example.com", password: "short" }),
      ),
    );
    assert.equal(samePrefix.status, 429);
    const otherPrefix = await handler(
      attempt(
        "/api/signup",
        "2001:db8:4:6::1",
        JSON.stringify({ name: "D", email: "d@example.com", password: "short" }),
      ),
    );
    assert.equal(otherPrefix.status, 400);
  } finally {
    await close();
  }
});

test("invites are limited per address and per signed-in email", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = app(db);
    const body = "{}";
    for (let n = 0; n < ATTEMPT_LIMIT.max; n += 1) {
      const response = await handler(
        attempt("/api/invites", "203.0.113.30", body, {
          "x-user-id": "user-a",
          "x-user-email": "Host@Example.com",
        }),
      );
      assert.equal(response.status, 403);
    }
    const blocked = await handler(
      attempt("/api/invites", "203.0.113.30", body, {
        "x-user-id": "user-a",
        "x-user-email": "host@example.com",
      }),
    );
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
    const sameEmail = await handler(
      attempt("/api/invites", "203.0.113.31", body, {
        "x-user-id": "user-b",
        "x-user-email": "host@example.com",
      }),
    );
    assert.equal(sameEmail.status, 429);
  } finally {
    await close();
  }
});
