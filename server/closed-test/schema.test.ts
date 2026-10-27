import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { mintInvite, redeemInvite, seatFoundingAdmin, type CreateAccount, type SignIn } from "./store.ts";
import { openTestDb } from "./test-db.ts";

const headers = new Headers();
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

test("deleting an inviter keeps the invite log and the indexes exist", async () => {
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
    const now = new Date("2026-10-19T12:00:00Z");
    const mariaCode = await mintInvite(
      db,
      { userId: seated.value.userId, maxUses: 1, expiresInDays: 7, attestAdult: true },
      now,
    );
    assert.equal(mariaCode.ok, true);
    if (!mariaCode.ok) return;
    const maria = await redeemInvite(
      db,
      { name: "Maria", email: "maria@example.com", password: "correct-horse", code: mariaCode.value.code, adult: true, consent: true, headers },
      createAccount,
      signIn,
      now,
    );
    assert.equal(maria.ok, true);
    if (!maria.ok) return;
    const luisCode = await mintInvite(
      db,
      { userId: maria.value.user.id, maxUses: 1, expiresInDays: 7, attestAdult: true },
      now,
    );
    assert.equal(luisCode.ok, true);
    if (!luisCode.ok) return;
    const luis = await redeemInvite(
      db,
      { name: "Luis", email: "luis@example.com", password: "correct-horse", code: luisCode.value.code, adult: true, consent: true, headers },
      createAccount,
      signIn,
      now,
    );
    assert.equal(luis.ok, true);

    await db.query(`delete from "user" where email = 'maria@example.com'`);
    const log = await db.query<{ invited_name: string; invited_by_name: string; invited_by_user_id: string | null }>(
      `select invited_name, invited_by_name, invited_by_user_id from invite_redemption where invited_name = 'Luis'`,
    );
    assert.equal(log[0]?.invited_by_name, "Maria");
    assert.equal(log[0]?.invited_by_user_id, null);

    const indexes = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where tablename in ('invite_code', 'invite_redemption')`,
    );
    const names = indexes.map((row) => row.indexname);
    assert.equal(names.includes("invite_code_created_by_idx"), true);
    assert.equal(names.includes("invite_redemption_inviter_idx"), true);
  } finally {
    await close();
  }
});
