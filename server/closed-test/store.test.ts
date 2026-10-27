import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Db } from "../db.ts";
import { GENERIC_SIGNUP_ERROR, hashInviteCode } from "./rules.ts";
import {
  mintInvite,
  redeemInvite,
  seatFoundingAdmin,
  type CreateAccount,
  type CreateUser,
  type SignIn,
} from "./store.ts";
import { openTestDb } from "./test-db.ts";

function fakeUsers(db: Db): CreateUser {
  return async (input) => {
    const id = randomUUID();
    await db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, $2, $3, true, now(), now())`,
      [id, input.name, input.email],
    );
    return { ok: true, user: { id, name: input.name, email: input.email } };
  };
}

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

const headers = new Headers();

async function seat(db: Db) {
  return seatFoundingAdmin(
    db,
    { envName: "Josh", email: "josh@example.com", password: "correct-horse", headers },
    fakeUsers(db),
  );
}

test("Josh is seated once and a second run is refused", async () => {
  const { db, close } = await openTestDb();
  try {
    const first = await seat(db);
    assert.equal(first.ok, true);
    const second = await seat(db);
    assert.equal(second.ok, false);
    if (!second.ok) assert.match(second.error, /already seated/);
    const rows = await db.query<{ note: string; role: string }>(
      `select role, note from access_log order by role asc`,
    );
    assert.deepEqual(
      rows.map((row) => `${row.role}:${row.note}`),
      ["admin:Founding admin and council chair.", "member:Founding member."],
    );
    const role = await db.query<{ is_admin: boolean; is_council_chair: boolean }>(
      `select is_admin, is_council_chair from member_role`,
    );
    assert.equal(role[0]?.is_admin, true);
    assert.equal(role[0]?.is_council_chair, true);
    const people = await db.query(`select id from "user"`);
    assert.equal(people.length, 1);
  } finally {
    await close();
  }
});

test("a blank or non-Josh bootstrap does not write a user", async () => {
  const { db, close } = await openTestDb();
  try {
    const blank = await seatFoundingAdmin(
      db,
      { envName: "", email: "josh@example.com", password: "correct-horse", headers },
      fakeUsers(db),
    );
    assert.equal(blank.ok, false);
    const other = await seatFoundingAdmin(
      db,
      { envName: "Tom", email: "tom@example.com", password: "correct-horse", headers },
      fakeUsers(db),
    );
    assert.equal(other.ok, false);
    if (!other.ok) assert.match(other.error, /Josh/);
    assert.equal((await db.query(`select id from "user"`)).length, 0);
  } finally {
    await close();
  }
});

test("a single-use code logs who invited whom and cannot be reused", async () => {
  const { db, close } = await openTestDb();
  try {
    const seated = await seat(db);
    assert.equal(seated.ok, true);
    if (!seated.ok) return;
    const now = new Date("2026-10-19T12:00:00Z");
    const minted = await mintInvite(
      db,
      { userId: seated.value.userId, maxUses: 1, expiresInDays: 7, attestAdult: true },
      now,
    );
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    const stored = await db.query<{ code_hash: string; note: string }>(
      `select code_hash, note from invite_code`,
    );
    assert.equal(stored[0]?.code_hash, hashInviteCode(minted.value.code));
    assert.equal(JSON.stringify(stored).includes(minted.value.code), false);

    const first = await redeemInvite(
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
    assert.equal(first.ok, true);
    const second = await redeemInvite(
      db,
      {
        name: "Luis",
        email: "luis@example.com",
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
    assert.equal(second.ok, false);
    if (!second.ok) assert.match(second.error, /used up/);
    const log = await db.query<{ invited_name: string; invited_by_name: string }>(
      `select invited_name, invited_by_name from invite_redemption`,
    );
    assert.deepEqual(log, [{ invited_name: "Maria", invited_by_name: "Josh" }]);
    const grant = await db.query<{ note: string; vouched_by: string }>(
      `select note, vouched_by from access_log where name = 'Maria'`,
    );
    assert.equal(grant[0]?.note, "Member, one inviter.");
    assert.equal(grant[0]?.vouched_by, "Josh");
  } finally {
    await close();
  }
});

test("a limited code stops at its max uses", async () => {
  const { db, close } = await openTestDb();
  try {
    const seated = await seat(db);
    assert.equal(seated.ok, true);
    if (!seated.ok) return;
    const now = new Date("2026-10-19T12:00:00Z");
    const minted = await mintInvite(
      db,
      { userId: seated.value.userId, maxUses: 2, expiresInDays: 7, attestAdult: true },
      now,
    );
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    for (const name of ["Maria", "Luis"]) {
      const result = await redeemInvite(
        db,
        {
          name,
          email: `${name.toLowerCase()}@example.com`,
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
      assert.equal(result.ok, true, name);
    }
    const third = await redeemInvite(
      db,
      {
        name: "Ruth",
        email: "ruth@example.com",
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
    assert.equal(third.ok, false);
    assert.equal((await db.query(`select id from invite_redemption`)).length, 2);
  } finally {
    await close();
  }
});

test("an expired code is refused and does not create a user", async () => {
  const { db, close } = await openTestDb();
  try {
    const seated = await seat(db);
    assert.equal(seated.ok, true);
    if (!seated.ok) return;
    const minted = await mintInvite(
      db,
      { userId: seated.value.userId, maxUses: 1, expiresInDays: 1, attestAdult: true },
      new Date("2026-10-01T00:00:00Z"),
    );
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    let created = 0;
    const result = await redeemInvite(
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
      async () => {
        created += 1;
        return { id: "nope" };
      },
      signIn,
      new Date("2026-10-19T00:00:00Z"),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /expired/);
    assert.equal(created, 0);
  } finally {
    await close();
  }
});

test("a failed account create gives the code back", async () => {
  const { db, close } = await openTestDb();
  try {
    const seated = await seat(db);
    assert.equal(seated.ok, true);
    if (!seated.ok) return;
    const now = new Date("2026-10-19T12:00:00Z");
    const minted = await mintInvite(
      db,
      { userId: seated.value.userId, maxUses: 1, expiresInDays: 7, attestAdult: true },
      now,
    );
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    const failed = await redeemInvite(
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
      async () => {
        throw new Error("That email already has an account.");
      },
      signIn,
      now,
    );
    assert.equal(failed.ok, false);
    if (!failed.ok) {
      assert.equal(failed.error, GENERIC_SIGNUP_ERROR);
      assert.equal(failed.error.includes("email"), false);
    }
    const uses = await db.query<{ uses: number }>(`select uses from invite_code`);
    assert.equal(Number(uses[0]?.uses), 0);
    const again = await redeemInvite(
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
    assert.equal(again.ok, true);
  } finally {
    await close();
  }
});

test("a failed member grant rolls back the account and the invite claim", async () => {
  const { db, close } = await openTestDb();
  try {
    const seated = await seat(db);
    assert.equal(seated.ok, true);
    if (!seated.ok) return;
    const now = new Date("2026-10-19T12:00:00Z");
    const minted = await mintInvite(
      db,
      { userId: seated.value.userId, maxUses: 1, expiresInDays: 7, attestAdult: true },
      now,
    );
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    const failed = await redeemInvite(
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
      async (tx, input) => {
        const account = await createAccount(tx, input);
        throw new Error(`grant failed after ${account.id}`);
      },
      signIn,
      now,
    );
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.equal(failed.error, GENERIC_SIGNUP_ERROR);
    assert.equal((await db.query(`select id from "user"`)).length, 1);
    assert.equal((await db.query(`select id from invite_redemption`)).length, 0);
    assert.equal((await db.query(`select id from access_log where name = 'Maria'`)).length, 0);
    const uses = await db.query<{ uses: number }>(`select uses from invite_code`);
    assert.equal(Number(uses[0]?.uses), 0);
  } finally {
    await close();
  }
});
