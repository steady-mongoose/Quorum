import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { INVITE_TRACKER_SQL } from "../admin/invite-tracker.ts";
import { AGE_INVITE_ERROR, AGE_SIGNUP_ERROR } from "../../src/lib/board/age.ts";
import { createApp } from "../http.ts";
import { hashInviteCode } from "./rules.ts";
import {
  mintInvite,
  redeemInvite,
  seatFoundingAdmin,
  type CreateAccount,
  type SignIn,
} from "./store.ts";
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

test("migration 0047 stores the two age times and leaves production moderation files alone", () => {
  const sql = readFileSync(new URL("../../migrations/0047_age_attestation.sql", import.meta.url), "utf8");
  assert.match(sql, /Numbered 0047/);
  assert.match(sql, /age_attested_at timestamptz/);
  assert.match(sql, /age_confirmed_at timestamptz/);
  assert.equal(/create or replace function/i.test(sql), false);
  assert.equal(/0010_moderation/.test(sql), false);
  assert.equal(sql.includes("board_csam_hold"), false);
  // No made-up confirmation and no deletion.
  assert.equal(/set\s+age_attested_at/i.test(sql), false);
  assert.equal(/delete from|drop table|drop column/i.test(sql), false);
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

const MIGRATION_0047 = readFileSync(
  new URL("../../migrations/0047_age_attestation.sql", import.meta.url),
  "utf8",
);

/** A code minted the way production minted them before 0047: no age column at all. */
async function legacyCode(
  db: Awaited<ReturnType<typeof openTestDb>>["db"],
  input: { id: string; code: string; createdBy: string; maxUses: number; expiresAt: Date; note: string },
) {
  await db.query(
    `insert into invite_code (id, code_hash, created_by, max_uses, expires_at, note, room_id, created_at)
     values ($1, $2, $3, $4, $5, $6, '', $7)`,
    [
      input.id,
      hashInviteCode(input.code),
      input.createdBy,
      input.maxUses,
      input.expiresAt,
      input.note,
      new Date("2026-10-29T20:19:00Z"),
    ],
  );
}

async function seatJosh(db: Awaited<ReturnType<typeof openTestDb>>["db"]) {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, 'Josh', 'josh@example.com', true, now(), now())`,
    [id],
  );
  return id;
}

test("0047 keeps a code minted before it usable, only with the new member's own 18+ confirmation", async () => {
  const { db, pg, close } = await openTestDb({ before: "0047_" });
  try {
    const josh = await seatJosh(db);
    // Shaped like the open code minted on 29 Oct: general (no room), single use,
    // tracked, eight characters. The real code is not in the repo.
    const wesleyId = randomUUID();
    const wesleyCode = "7QKX2HPD";
    const expires = new Date("2026-11-05T21:19:00Z");
    await legacyCode(db, {
      id: wesleyId,
      code: wesleyCode,
      createdBy: josh,
      maxUses: 1,
      expiresAt: expires,
      note: "Wesley",
    });

    await pg.exec(MIGRATION_0047);
    // A rerun is harmless and does not mark anything new.
    await pg.exec(MIGRATION_0047);

    const marked = await db.query<{ age_attested_at: Date | null; minted_before_age_check: boolean }>(
      `select age_attested_at, minted_before_age_check from invite_code where id = $1`,
      [wesleyId],
    );
    assert.equal(marked[0]?.minted_before_age_check, true);
    // No inviter confirmation is invented for it.
    assert.equal(marked[0]?.age_attested_at, null);

    // Without the member's own confirmation the code is not spent and no account is made.
    const noBox = await redeemInvite(
      db,
      { name: "Wesley", email: "wesley@example.com", password: "correct-horse", code: wesleyCode, headers },
      createAccount,
      signIn,
      now,
    );
    assert.equal(noBox.ok, false);
    if (noBox.ok) return;
    assert.equal(noBox.error, AGE_SIGNUP_ERROR);
    const notString = await redeemInvite(
      db,
      {
        name: "Wesley",
        email: "wesley@example.com",
        password: "correct-horse",
        code: wesleyCode,
        adult: "true",
        headers,
      },
      createAccount,
      signIn,
      now,
    );
    assert.equal(notString.ok, false);
    assert.equal((await db.query(`select id from "user" where email = 'wesley@example.com'`)).length, 0);
    assert.equal(
      Number((await db.query<{ uses: number }>(`select uses from invite_code where id = $1`, [wesleyId]))[0]?.uses),
      0,
    );

    const saved = await redeemInvite(
      db,
      {
        name: "Wesley",
        email: "wesley@example.com",
        password: "correct-horse",
        code: wesleyCode.toLowerCase(),
        adult: true,
        headers,
      },
      createAccount,
      signIn,
      now,
    );
    assert.equal(saved.ok, true, saved.ok ? "" : saved.error);
    const confirmed = await db.query<{ age_confirmed_at: Date }>(
      `select age_confirmed_at from "user" where email = 'wesley@example.com'`,
    );
    assert.equal(new Date(confirmed[0]?.age_confirmed_at ?? 0).toISOString(), now.toISOString());

    // Single use: a second signup on the same code is refused.
    const again = await redeemInvite(
      db,
      { name: "Other", email: "other@example.com", password: "correct-horse", code: wesleyCode, adult: true, headers },
      createAccount,
      signIn,
      now,
    );
    assert.equal(again.ok, false);

    // Tracked: the invite tracker shows the code and who redeemed it.
    const tracked = await db.query<{ id: string; invited_name: string | null; note: string }>(INVITE_TRACKER_SQL);
    const row = tracked.find((r) => r.id === wesleyId);
    assert.equal(row?.invited_name, "Wesley");
    assert.equal(row?.note, "Wesley");
  } finally {
    await close();
  }
});

test("after 0047 a code with no inviter confirmation is still refused, and an expired old code stays expired", async () => {
  const { db, pg, close } = await openTestDb({ before: "0047_" });
  try {
    const josh = await seatJosh(db);
    await legacyCode(db, {
      id: "old-expired",
      code: "OLDGONE1",
      createdBy: josh,
      maxUses: 1,
      expiresAt: new Date("2026-10-01T00:00:00Z"),
      note: "",
    });
    await pg.exec(MIGRATION_0047);

    // A row written after the migration without a confirmation (not something
    // mintInvite can do) is not treated as an old code.
    await legacyCode(db, {
      id: "after-cutoff",
      code: "NEWNOAGE",
      createdBy: josh,
      maxUses: 1,
      expiresAt: new Date("2026-11-05T00:00:00Z"),
      note: "",
    });
    await pg.exec(MIGRATION_0047);
    const flags = await db.query<{ id: string; minted_before_age_check: boolean }>(
      `select id, minted_before_age_check from invite_code order by id`,
    );
    assert.deepEqual(
      flags.map((f) => [f.id, f.minted_before_age_check]),
      [
        ["after-cutoff", false],
        ["old-expired", true],
      ],
    );

    const refused = await redeemInvite(
      db,
      { name: "Maria", email: "maria@example.com", password: "correct-horse", code: "NEWNOAGE", adult: true, headers },
      createAccount,
      signIn,
      now,
    );
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.error, "That code has no age confirmation.");

    const expired = await redeemInvite(
      db,
      { name: "Ned", email: "ned@example.com", password: "correct-horse", code: "OLDGONE1", adult: true, headers },
      createAccount,
      signIn,
      now,
    );
    assert.equal(expired.ok, false);
    assert.equal((await db.query(`select id from "user" where email in ('maria@example.com', 'ned@example.com')`)).length, 0);
  } finally {
    await close();
  }
});
