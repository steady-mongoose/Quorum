import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AGE_INVITE_ERROR, AGE_SIGNUP_ERROR } from "../../src/lib/board/age.ts";
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

test("migration 0028 stores the two age times and leaves production moderation files alone", () => {
  const sql = readFileSync(new URL("../../migrations/0028_age_attestation.sql", import.meta.url), "utf8");
  assert.match(sql, /Numbered 0028/);
  assert.match(sql, /age_attested_at timestamptz/);
  assert.match(sql, /age_confirmed_at timestamptz/);
  assert.equal(/create or replace function/i.test(sql), false);
  assert.equal(/0010_moderation/.test(sql), false);
  assert.equal(sql.includes("board_csam_hold"), false);
});

test("minting and signup are refused without the 18+ confirmation, and the times are stored", async () => {
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

    const refused = await mintInvite(
      db,
      { userId: seated.value.userId, maxUses: 1, expiresInDays: 7 },
      now,
    );
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.error, AGE_INVITE_ERROR);
    assert.equal((await db.query(`select id from invite_code`)).length, 0);

    const word = await mintInvite(
      db,
      { userId: seated.value.userId, maxUses: 1, expiresInDays: 7, attestAdult: "true" },
      now,
    );
    assert.equal(word.ok, false);

    const minted = await mintInvite(
      db,
      { userId: seated.value.userId, maxUses: 1, expiresInDays: 7, attestAdult: true },
      now,
    );
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    const attested = await db.query<{ age_attested_at: Date }>(
      `select age_attested_at from invite_code`,
    );
    assert.equal(new Date(attested[0]?.age_attested_at ?? 0).toISOString(), now.toISOString());

    const noBox = await redeemInvite(
      db,
      {
        name: "Maria",
        email: "maria@example.com",
        password: "correct-horse",
        code: minted.value.code,
        headers,
      },
      createAccount,
      signIn,
      now,
    );
    assert.equal(noBox.ok, false);
    if (noBox.ok) return;
    assert.equal(noBox.error, AGE_SIGNUP_ERROR);
    assert.equal((await db.query(`select id from "user" where email = 'maria@example.com'`)).length, 0);
    const uses = await db.query<{ uses: number }>(`select uses from invite_code`);
    assert.equal(Number(uses[0]?.uses), 0);

    const handler = createApp({
      db,
      origins: ["http://localhost:8080"],
      now: () => now,
      createAccount,
      signIn,
      readSession: async (requestHeaders) => {
        const id = requestHeaders.get("x-user-id");
        if (!id) return null;
        return { id, name: "Josh", email: "josh@example.com" };
      },
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
          adult: "yes",
        }),
      }),
    );
    assert.equal(httpRefused.status, 400);
    assert.equal(((await httpRefused.json()) as { error?: string }).error, AGE_SIGNUP_ERROR);

    const saved = await redeemInvite(
      db,
      {
        name: "Maria",
        email: "maria@example.com",
        password: "correct-horse",
        code: minted.value.code,
        adult: true,
        consent: true,
        headers,
      },
      createAccount,
      signIn,
      now,
    );
    assert.equal(saved.ok, true);
    const confirmed = await db.query<{ age_confirmed_at: Date }>(
      `select age_confirmed_at from "user" where email = 'maria@example.com'`,
    );
    assert.equal(new Date(confirmed[0]?.age_confirmed_at ?? 0).toISOString(), now.toISOString());
  } finally {
    await close();
  }
});
