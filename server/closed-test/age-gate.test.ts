import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { AGE_SIGNUP_ERROR } from "../../src/lib/board/age.ts";
import { createApp } from "../http.ts";
import { AGE_REQUIRED, ageExempt } from "./age-gate.ts";
import { openTestDb } from "./test-db.ts";

const origin = "http://localhost:8080";
const now = new Date("2026-10-29T22:40:00Z");

async function setup() {
  const opened = await openTestDb({ ageUnconfirmed: true });
  const { db } = opened;
  const id = randomUUID();
  // An account from before the 18+ check: age_confirmed_at is null.
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, 'Ada', 'ada@example.com', true, now(), now())`,
    [id],
  );
  const signedOut: string[] = [];
  const app = createApp({
    db,
    origins: [origin],
    now: () => now,
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
  return { ...opened, id, call, signedOut };
}

async function errorOf(response: Response): Promise<string | undefined> {
  return ((await response.json()) as { error?: string }).error;
}

test("a member with no 18+ confirmation is held at every member route until they confirm", async () => {
  const { db, id, call, close } = await setup();
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

    // Never asked again: a repeat keeps the first time.
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

test("only the session read, sign-in and sign-out, the second factor, and the confirm step are exempt", () => {
  assert.equal(ageExempt("/api/auth/get-session", "GET"), true);
  assert.equal(ageExempt("/api/auth/sign-out", "POST"), true);
  assert.equal(ageExempt("/api/auth/sign-in/email", "POST"), true);
  assert.equal(ageExempt("/api/age/confirm", "POST"), true);
  assert.equal(ageExempt("/api/mfa/challenge", "POST"), true);
  assert.equal(ageExempt("/api/health", "GET"), true);
  assert.equal(ageExempt("/api/age/confirm", "GET"), false);
  assert.equal(ageExempt("/api/auth/change-password", "POST"), false);
  assert.equal(ageExempt("/api/rooms/hall/posts", "POST"), false);
  assert.equal(ageExempt("/api/invites", "POST"), false);
  assert.equal(ageExempt("/api/profile", "GET"), false);
});
