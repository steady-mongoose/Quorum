import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { AGE_SIGNUP_ERROR } from "../../src/lib/board/age.ts";
import { createApp } from "../http.ts";
import { AGE_EXEMPT_ROUTES, AGE_REQUIRED, ageExempt } from "./age-gate.ts";
import { openTestDb } from "./test-db.ts";

const origin = "http://localhost:8080";
const now = new Date("2026-10-29T22:40:00Z");

async function setup(options: { admin?: boolean } = {}) {
  const opened = await openTestDb({ ageUnconfirmed: true });
  const { db } = opened;
  const id = randomUUID();
  // An account from before the 18+ check: age_confirmed_at is null.
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, 'Ada', 'ada@example.com', true, now(), now())`,
    [id],
  );
  if (options.admin) await db.query(`insert into member_role (user_id, is_admin) values ($1, true)`, [id]);
  let clock = now;
  const signedOut: string[] = [];
  const app = createApp({
    db,
    origins: [origin],
    now: () => clock,
    createAccount: async () => ({ id: randomUUID() }),
    signIn: async (input) => ({ ok: true, user: { id: input.userId, name: input.name, email: input.email } }),
    readSession: async (headers) =>
      headers.get("x-user-id") === id ? { id, name: "Ada", email: "ada@example.com" } : null,
    forwardAuth: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/api/auth/get-session") {
        if (request.headers.get("x-user-id") !== id) return Response.json(null);
        return Response.json({ session: { id: "s1" }, user: { id, name: "Ada", email: "ada@example.com" } });
      }
      if (url.pathname === "/api/auth/sign-out") {
        signedOut.push(id);
        return Response.json({ success: true });
      }
      return new Response("no", { status: 404 });
    },
  });
  const call = (path: string, init: RequestInit & { signedIn?: boolean } = {}) => {
    const headers = new Headers(init.headers);
    headers.set("origin", origin);
    if (init.signedIn !== false) headers.set("x-user-id", id);
    if (init.body) headers.set("content-type", "application/json");
    return app(new Request(`http://127.0.0.1:8787${path}`, { ...init, headers }));
  };
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  return { ...opened, id, call, signedOut, advance };
}

async function errorOf(response: Response): Promise<string | undefined> {
  return ((await response.json()) as { error?: string }).error;
}

test("a member with no 18+ confirmation is held at every member route until they confirm", async () => {
  const { db, id, call, close, advance } = await setup();
  try {
    for (const [method, path] of [
      ["GET", "/api/invite-log"],
      ["POST", "/api/invites"],
      ["GET", "/api/dm/threads"],
      ["GET", "/api/admin/export"],
    ] as const) {
      const held = await call(path, { method, body: method === "POST" ? "{}" : undefined });
      assert.equal(held.status, 403, path);
      const body = (await held.json()) as { error?: string; message?: string };
      assert.equal(body.error, AGE_REQUIRED, path);
      assert.equal(body.message, "Confirm you are 18 or older to continue.");
    }

    // The session read still answers, and says the step is due.
    const session = await call("/api/auth/get-session");
    assert.equal(session.status, 200);
    assert.equal(((await session.json()) as { ageConfirmed?: boolean }).ageConfirmed, false);

    // Only a boolean true counts. Nothing is stored for anything else.
    for (const adult of ["true", 1, "yes", null, false]) {
      const refused = await call("/api/age/confirm", { method: "POST", body: JSON.stringify({ adult }) });
      assert.equal(refused.status, 400, String(adult));
      assert.equal(await errorOf(refused), AGE_SIGNUP_ERROR);
    }
    const missing = await call("/api/age/confirm", { method: "POST", body: "{}" });
    assert.equal(missing.status, 400);
    const stillNull = await db.query<{ age_confirmed_at: Date | null }>(
      `select age_confirmed_at from "user" where id = $1`,
      [id],
    );
    assert.equal(stillNull[0]?.age_confirmed_at, null);
    assert.equal((await call("/api/invite-log")).status, 403);

    // No session, no confirmation.
    const anonymous = await call("/api/age/confirm", {
      method: "POST",
      body: JSON.stringify({ adult: true }),
      signedIn: false,
    });
    assert.equal(anonymous.status, 401);

    const confirmed = await call("/api/age/confirm", { method: "POST", body: JSON.stringify({ adult: true }) });
    assert.equal(confirmed.status, 200);
    const stored = await db.query<{ age_confirmed_at: Date }>(
      `select age_confirmed_at from "user" where id = $1`,
      [id],
    );
    assert.equal(new Date(stored[0]?.age_confirmed_at ?? 0).toISOString(), now.toISOString());

    // Cleared: member routes answer for themselves again, and the session says so.
    const open = await call("/api/invite-log");
    assert.notEqual(await errorOf(open), AGE_REQUIRED);
    const after = await call("/api/auth/get-session");
    assert.equal(((await after.json()) as { ageConfirmed?: boolean }).ageConfirmed, true);

    // Never asked again: a repeat, later, keeps the first time.
    advance(60 * 60 * 1000);
    const again = await call("/api/age/confirm", { method: "POST", body: JSON.stringify({ adult: true }) });
    assert.equal(again.status, 200);
    const kept = await db.query<{ age_confirmed_at: Date }>(
      `select age_confirmed_at from "user" where id = $1`,
      [id],
    );
    assert.equal(new Date(kept[0]?.age_confirmed_at ?? 0).toISOString(), now.toISOString());
  } finally {
    await close();
  }
});

test("sign-out works while the step is due", async () => {
  const { call, signedOut, close } = await setup();
  try {
    const out = await call("/api/auth/sign-out", { method: "POST", body: "{}" });
    assert.equal(out.status, 200);
    assert.equal(signedOut.length, 1);
  } finally {
    await close();
  }
});

test("the exemption list is exact method and path, and nothing else", () => {
  assert.deepEqual(
    AGE_EXEMPT_ROUTES.map(([method, path]) => `${method} ${path}`),
    [
      "GET /api/health",
      "GET /api/auth/get-session",
      "POST /api/auth/sign-in/email",
      "POST /api/auth/sign-out",
      "POST /api/signup",
      "GET /api/mfa/status",
      "POST /api/mfa/challenge",
      "POST /api/mfa/enroll/start",
      "POST /api/mfa/enroll/confirm",
      "POST /api/age/confirm",
      "GET /api/calls/status",
      "GET /api/media/status",
    ],
  );
  for (const [method, path] of AGE_EXEMPT_ROUTES) assert.equal(ageExempt(path, method), true, `${method} ${path}`);
  for (const [method, path] of [
    ["GET", "/api/age/confirm"],
    ["POST", "/api/health"],
    ["POST", "/api/auth/get-session"],
    ["GET", "/api/auth/sign-out"],
    ["POST", "/api/auth/sign-in/social"],
    ["POST", "/api/auth/sign-in"],
    ["POST", "/api/auth/change-password"],
    ["GET", "/api/mfa/reset"],
    ["POST", "/api/mfa/reset/request"],
    ["POST", "/api/mfa/reset/abc-123/approve"],
    ["POST", "/api/mfa/disable"],
    ["POST", "/api/mfa/step-up"],
    ["DELETE", "/api/mfa/status"],
    ["PUT", "/api/mfa/challenge"],
    ["POST", "/api/mfa/status"],
    ["GET", "/api/mfa/challenge"],
    ["GET", "/api/mfa/status/"],
    ["GET", "/api/mfax"],
    ["POST", "/api/calls/status"],
    ["GET", "/api/calls/rings"],
    ["POST", "/api/rooms/hall/posts"],
    ["POST", "/api/invites"],
    ["GET", "/api/profile"],
  ] as const) {
    assert.equal(ageExempt(path, method), false, `${method} ${path}`);
  }
});

test("an unconfirmed admin gets 403 age_required on every /api/mfa route outside the sign-in steps", async () => {
  const { call, close } = await setup({ admin: true });
  try {
    for (const [method, path, body] of [
      ["GET", "/api/mfa/reset", undefined],
      ["POST", "/api/mfa/reset/request", JSON.stringify({ userId: "someone" })],
      ["POST", "/api/mfa/reset/abc-123/approve", "{}"],
      ["POST", "/api/mfa/disable", JSON.stringify({ code: "123456" })],
      ["POST", "/api/mfa/step-up", JSON.stringify({ action: "mfa-reset", code: "123456" })],
      ["DELETE", "/api/mfa/status", undefined],
      ["DELETE", "/api/mfa/reset", undefined],
      ["PUT", "/api/mfa/enroll/start", "{}"],
      ["GET", "/api/mfa/unknown", undefined],
    ] as const) {
      const held = await call(path, { method, body });
      assert.equal(held.status, 403, `${method} ${path}`);
      assert.equal(await errorOf(held), AGE_REQUIRED, `${method} ${path}`);
    }

    // The sign-in steps still answer for themselves.
    const status = await call("/api/mfa/status");
    assert.equal(status.status, 200);
    const enroll = await call("/api/mfa/enroll/start", { method: "POST", body: JSON.stringify({ kind: "totp" }) });
    assert.notEqual(await errorOf(enroll), AGE_REQUIRED);
    const challenge = await call("/api/mfa/challenge", { method: "POST", body: JSON.stringify({ code: "000000" }) });
    assert.notEqual(await errorOf(challenge), AGE_REQUIRED);
  } finally {
    await close();
  }
});

test("an unconfirmed admin with no authenticator can confirm their age, then reach the authenticator setup", async () => {
  const { db, id, call, close } = await setup({ admin: true });
  try {
    // Before the fix this answered 403 mfa_required, step enroll: the age step
    // dead-ended, and the setup on You sits behind it.
    const confirmed = await call("/api/age/confirm", { method: "POST", body: JSON.stringify({ adult: true }) });
    assert.equal(confirmed.status, 200);
    assert.deepEqual(await confirmed.json(), { ok: true, ageConfirmed: true });
    const stored = await db.query<{ age_confirmed_at: Date | null }>(
      `select age_confirmed_at from "user" where id = $1`,
      [id],
    );
    assert.notEqual(stored[0]?.age_confirmed_at, null);

    // Through the step, the session says the authenticator is due, and the setup answers.
    const session = await call("/api/auth/get-session");
    const body = (await session.json()) as { ageConfirmed?: boolean; mfa?: string };
    assert.equal(body.ageConfirmed, true);
    assert.equal(body.mfa, "enroll");
    const start = await call("/api/mfa/enroll/start", { method: "POST", body: JSON.stringify({ kind: "totp" }) });
    assert.notEqual(start.status, 403);
    const startError = await errorOf(start);
    assert.notEqual(startError, "mfa_required");
    assert.notEqual(startError, AGE_REQUIRED);

    // MFA is not weakened elsewhere: admin work still waits on the authenticator.
    for (const [method, path] of [
      ["GET", "/api/admin/export"],
      ["POST", "/api/access"],
      ["GET", "/api/mfa/reset"],
    ] as const) {
      const held = await call(path, { method, body: method === "POST" ? "{}" : undefined });
      assert.equal(held.status, 403, `${method} ${path}`);
      const failure = (await held.json()) as { error?: string; step?: string };
      assert.equal(failure.error, "mfa_required", `${method} ${path}`);
      assert.equal(failure.step, "enroll", `${method} ${path}`);
    }
  } finally {
    await close();
  }
});
