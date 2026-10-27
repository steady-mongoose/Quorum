import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CONSENT_ERROR, LEGAL_VERSION } from "../../src/lib/board/consent.ts";
import { createApp } from "../http.ts";
import { mintInvite, redeemInvite, seatFoundingAdmin, type CreateAccount, type SignIn } from "./store.ts";
import { openTestDb } from "./test-db.ts";
import { randomUUID } from "node:crypto";

const headers = new Headers();
const now = new Date("2026-10-19T12:00:00Z");

const createAccount: CreateAccount = async (tx, input) => {
  const id = randomUUID();
  await tx.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, input.name, input.email],
  );
  return { id };
};

const signIn: SignIn = async (input) => ({
  ok: true,
  user: { id: input.userId, name: input.name, email: input.email },
});

test("migration 0035 adds member_consent and touches nothing on production", () => {
  const sql = readFileSync(new URL("../../migrations/0035_signup_consent.sql", import.meta.url), "utf8");
  assert.match(sql, /Numbered 0035/);
  assert.match(sql, /create table if not exists member_consent/);
  assert.match(sql, /version text not null/);
  assert.match(sql, /accepted_at timestamptz/);
  assert.equal(/create or replace function/i.test(sql), false);
  assert.equal(/alter table/i.test(sql), false);
});

test("signup is refused without consent, and the version and time are stored", async () => {
  const { db, close } = await openTestDb();
  try {
    const seated = await seatFoundingAdmin(
      db,
      { envName: "Josh", email: "josh@example.com", password: "correct-horse", headers },
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
      { userId: seated.value.userId, maxUses: 1, expiresInDays: 7, attestAdult: true },
      now,
    );
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    const base = {
      name: "Maria",
      email: "maria@example.com",
      password: "correct-horse",
      code: minted.value.code,
      adult: true,
      headers,
    };

    for (const consent of [undefined, false, "true", 1]) {
      const refused = await redeemInvite(db, { ...base, consent }, createAccount, signIn, now);
      assert.equal(refused.ok, false, String(consent));
      if (refused.ok) return;
      assert.equal(refused.error, CONSENT_ERROR);
    }
    assert.equal((await db.query(`select id from "user" where email = 'maria@example.com'`)).length, 0);
    assert.equal((await db.query(`select id from member_consent`)).length, 0);
    const uses = await db.query<{ uses: number }>(`select uses from invite_code`);
    assert.equal(Number(uses[0]?.uses), 0);

    const handler = createApp({
      db,
      origins: ["http://localhost:8080"],
      now: () => now,
      createAccount,
      signIn,
      readSession: async () => null,
      forwardAuth: async () => new Response("no", { status: 500 }),
    });
    const httpRefused = await handler(
      new Request("http://127.0.0.1:8787/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Maria",
          email: "maria@example.com",
          password: "correct-horse",
          inviteCode: minted.value.code,
          adult: true,
        }),
      }),
    );
    assert.equal(httpRefused.status, 400);
    assert.equal(((await httpRefused.json()) as { error?: string }).error, CONSENT_ERROR);

    const saved = await redeemInvite(db, { ...base, consent: true }, createAccount, signIn, now);
    assert.equal(saved.ok, true);
    const rows = await db.query<{ user_id: string; kind: string; version: string; accepted_at: Date }>(
      `select c.user_id, c.kind, c.version, c.accepted_at
       from member_consent c join "user" u on u.id = c.user_id
       where u.email = 'maria@example.com'`,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.kind, "terms_privacy");
    assert.equal(rows[0]?.version, LEGAL_VERSION);
    assert.equal(new Date(rows[0]?.accepted_at ?? 0).toISOString(), now.toISOString());
  } finally {
    await close();
  }
});
