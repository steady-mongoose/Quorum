import { randomUUID } from "node:crypto";
import { isUniqueViolation, type Db } from "../db.ts";
import { AGE_INVITE_ERROR, AGE_SIGNUP_ERROR, confirmedAdult } from "../../src/lib/board/age.ts";
import { CONSENT_ERROR, LEGAL_VERSION, confirmedConsent } from "../../src/lib/board/consent.ts";
import {
  FOUNDING_ADMIN,
  FOUNDING_ADMIN_NOTE,
  FOUNDING_MEMBER_NOTE,
  GENERIC_SIGNUP_ERROR,
  MEMBER_NOTE,
  founderNameFromEnv,
  generateInviteCode,
  hashInviteCode,
  INVITE_INVALID,
  inviteBlock,
  isLiveGrant,
  normalizeInviteCode,
  readExpiry,
  readMaxUses,
  validEmail,
  validPassword,
  validPersonName,
  type AccessRow,
} from "./rules.ts";

export type CreatedUser = {
  id: string;
  name: string;
  email: string;
  response?: Response;
};

export type CreateUser = (input: {
  name: string;
  email: string;
  password: string;
  headers: Headers;
}) => Promise<{ ok: true; user: CreatedUser } | { ok: false; status: number; message: string }>;

/** Inserts the user and credential row on the caller's transaction. */
export type CreateAccount = (
  tx: Db,
  input: { name: string; email: string; password: string },
) => Promise<{ id: string }>;

export type SignIn = (input: {
  userId: string;
  name: string;
  email: string;
  password: string;
  headers: Headers;
}) => Promise<{ ok: true; user: CreatedUser } | { ok: false; status: number; message: string }>;

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; status: number; error: string; code?: string };
export type Result<T> = Ok<T> | Err;

function fail(status: number, error: string, code?: string): Err {
  return code ? { ok: false, status, error, code } : { ok: false, status, error };
}

type InviteRecord = {
  id: string;
  uses: number;
  max_uses: number;
  expires_at: Date | string;
  created_by: string;
  room_id: string;
  age_attested_at: Date | string | null;
};

async function liveRole(db: Db, userId: string, role: AccessRow["role"]): Promise<boolean> {
  const rows = await db.query<{ id: string; action: "grant" | "revoke"; at: Date | string }>(
    `select id, action, at from access_log where user_id = $1 and role = $2`,
    [userId, role],
  );
  return isLiveGrant(
    rows.map((row) => ({
      id: row.id,
      userId,
      role,
      action: row.action,
      at: new Date(row.at).getTime(),
    })),
    userId,
    role,
  );
}

export async function isAdmin(db: Db, userId: string): Promise<boolean> {
  const roles = await db.query<{ is_admin: boolean }>(
    `select is_admin from member_role where user_id = $1`,
    [userId],
  );
  if (roles[0]?.is_admin) return true;
  return liveRole(db, userId, "admin");
}

export async function mintInvite(
  db: Db,
  input: {
    userId: string;
    maxUses: unknown;
    expiresInDays: unknown;
    note?: unknown;
    roomId?: unknown;
    /** The inviter confirms the invitee is 18 or older. Required. */
    attestAdult?: unknown;
  },
  now: Date,
): Promise<Result<{ id: string; code: string; maxUses: number; expiresAt: string }>> {
  if (!(await liveRole(db, input.userId, "member"))) {
    return fail(403, "Only a member can invite someone.");
  }
  const maxUses = readMaxUses(input.maxUses);
  if (!maxUses.ok) return fail(400, maxUses.error);
  const expiry = readExpiry(input.expiresInDays, now);
  if (!expiry.ok) return fail(400, expiry.error);
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 200) : "";
  const roomId = typeof input.roomId === "string" ? input.roomId.trim().slice(0, 80) : "";
  if (roomId) {
    const { guardRoomAudience } = await import("../board/audience.ts");
    const gate = await guardRoomAudience(db, {
      userId: input.userId,
      roomId,
      now,
      path: "invite",
      detail: "mint",
    });
    if (!gate.ok) return fail(gate.status, gate.error, gate.code);
  }
  if (!confirmedAdult(input.attestAdult)) return fail(400, AGE_INVITE_ERROR);
  const code = generateInviteCode();
  const id = randomUUID();
  await db.query(
    `insert into invite_code
     (id, code_hash, created_by, max_uses, expires_at, note, room_id, age_attested_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, hashInviteCode(code), input.userId, maxUses.maxUses, expiry.expiresAt, note, roomId, now],
  );
  return {
    ok: true,
    value: { id, code, maxUses: maxUses.maxUses, expiresAt: expiry.expiresAt.toISOString() },
  };
}

async function explainBlockedCode(db: Db, code: string, now: Date): Promise<Err> {
  const existing = await db.query<InviteRecord>(
    `select id, uses, max_uses, expires_at, created_by, room_id, age_attested_at
     from invite_code where code_hash = $1`,
    [hashInviteCode(code)],
  );
  const row = existing[0];
  const blocked = inviteBlock(
    row
      ? { uses: Number(row.uses), maxUses: Number(row.max_uses), expiresAt: row.expires_at }
      : null,
    now,
  );
  if (blocked) return fail(400, blocked, INVITE_INVALID);
  if (!row?.age_attested_at) return fail(400, "That code has no age confirmation.", INVITE_INVALID);
  return fail(400, "That code is not valid.", INVITE_INVALID);
}

/**
 * Claims the invite, creates the account, and writes the member grant in one
 * transaction. A failure rolls all three back. The session cookie is opened
 * after commit.
 */
export async function redeemInvite(
  db: Db,
  input: {
    name: string;
    email: string;
    password: string;
    code: string;
    headers: Headers;
    /** The new member confirms they are 18 or older. Required. */
    adult?: unknown;
    /** The new member agrees to the Terms and Privacy Notice. Required. */
    consent?: unknown;
  },
  createAccount: CreateAccount,
  signIn: SignIn,
  now: Date,
): Promise<Result<{ user: CreatedUser }>> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const code = normalizeInviteCode(input.code);
  if (!validPersonName(name)) return fail(400, "Enter your name.");
  if (!validEmail(email)) return fail(400, "Enter an email address.");
  if (!validPassword(input.password)) return fail(400, "Use a password of 8 to 128 characters.");
  if (!code) return fail(400, "Enter the invite code.", INVITE_INVALID);
  if (!confirmedAdult(input.adult)) return fail(400, AGE_SIGNUP_ERROR);
  if (!confirmedConsent(input.consent)) return fail(400, CONSENT_ERROR);

  let reservedId = "";
  let invitedBy = "";
  let userId = "";
  try {
    const saved = await db.transaction(async (tx) => {
      const rows = await tx.query<InviteRecord>(
        `update invite_code
         set uses = uses + 1
         where code_hash = $1 and uses < max_uses and expires_at > $2
           and age_attested_at is not null
         returning id, uses, max_uses, expires_at, created_by, room_id, age_attested_at`,
        [hashInviteCode(code), now],
      );
      const reserved = rows[0];
      if (!reserved) return null;
      const inviter = await tx.query<{ name: string }>(`select name from "user" where id = $1`, [
        reserved.created_by,
      ]);
      const invitedByName = inviter[0]?.name ?? "unknown";
      const account = await createAccount(tx, { name, email, password: input.password });
      await tx.query(`update "user" set age_confirmed_at = $2 where id = $1`, [account.id, now]);
      await tx.query(
        `insert into member_consent (id, user_id, kind, version, accepted_at)
         values ($1, $2, 'terms_privacy', $3, $4)`,
        [randomUUID(), account.id, LEGAL_VERSION, now],
      );
      await tx.query(
        `insert into invite_redemption
         (id, invite_id, invited_user_id, invited_by_user_id, invited_name, invited_by_name)
         values ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), reserved.id, account.id, reserved.created_by, name, invitedByName],
      );
      await tx.query(
        `insert into access_log
         (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note)
         values ($1, $2, $3, 'member', $4, 'grant', $5, '', $5, $6)`,
        [randomUUID(), account.id, name, reserved.room_id, invitedByName, MEMBER_NOTE],
      );
      if (reserved.room_id) {
        const { roomAudience } = await import("../board/audience.ts");
        const audience = await roomAudience(tx, reserved.room_id);
        if (!audience || audience === "all") {
          await tx.query(
            `insert into room_member (room_id, user_id)
             select id, $2 from room where id = $1
             on conflict do nothing`,
            [reserved.room_id, account.id],
          );
        }
      }
      return { inviteId: reserved.id, invitedBy: reserved.created_by, userId: account.id };
    });
    if (!saved) return explainBlockedCode(db, code, now);
    reservedId = saved.inviteId;
    invitedBy = saved.invitedBy;
    userId = saved.userId;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "signup-rolled-back",
        code: isUniqueViolation(error) ? "unique" : "failed",
      }),
    );
    return fail(400, GENERIC_SIGNUP_ERROR);
  }

  const signedIn = await signIn({
    userId,
    name,
    email,
    password: input.password,
    headers: input.headers,
  });
  console.log(
    JSON.stringify({
      event: "invite-redeemed",
      inviteId: reservedId,
      invitedUserId: userId,
      invitedByUserId: invitedBy,
    }),
  );
  if (!signedIn.ok) {
    return {
      ok: true,
      value: { user: { id: userId, name, email } },
    };
  }
  return { ok: true, value: { user: signedIn.user } };
}

export async function listInviteLog(
  db: Db,
  userId: string,
): Promise<
  Array<{
    invitedName: string;
    invitedByName: string;
    redeemedAt: string;
  }>
> {
  const admin = await isAdmin(db, userId);
  const rows = await db.query<{
    invited_name: string;
    invited_by_name: string;
    redeemed_at: Date | string;
  }>(
    admin
      ? `select invited_name, invited_by_name, redeemed_at from invite_redemption order by redeemed_at asc`
      : `select invited_name, invited_by_name, redeemed_at from invite_redemption
         where invited_by_user_id = $1 order by redeemed_at asc`,
    admin ? [] : [userId],
  );
  return rows.map((row) => ({
    invitedName: row.invited_name,
    invitedByName: row.invited_by_name,
    redeemedAt: new Date(row.redeemed_at).toISOString(),
  }));
}

/**
 * Seats Josh once as founding admin and council chair.
 * A second call refuses before it creates another account.
 */
export async function seatFoundingAdmin(
  db: Db,
  input: { envName: string; email: string; password: string; headers: Headers },
  createUser: CreateUser,
): Promise<Result<{ userId: string }>> {
  const named = founderNameFromEnv(input.envName);
  if (!named) return fail(400, "Set BOOTSTRAP_OWNER=Josh to seat the founding admin.");
  if (named !== FOUNDING_ADMIN) return fail(400, "The founding admin is Josh.");
  if (!validEmail(input.email)) return fail(400, "Set BOOTSTRAP_OWNER_EMAIL to Josh's email.");
  if (!validPassword(input.password)) {
    return fail(400, "Set BOOTSTRAP_OWNER_PASSWORD to 8 to 128 characters.");
  }

  const seated = await db.query<{ id: string }>(
    `select id from bootstrap_seat where id = 'founding'`,
  );
  if (seated.length > 0) return fail(409, "The founding admin is already seated. This runs once.");
  const people = await db.query<{ id: string }>(`select id from "user" limit 1`);
  if (people.length > 0) return fail(409, "The founding seat runs before anyone else is added.");

  const created = await createUser({
    name: FOUNDING_ADMIN,
    email: input.email.trim().toLowerCase(),
    password: input.password,
    headers: input.headers,
  });
  if (!created.ok) return fail(created.status, created.message);

  try {
    await db.transaction(async (tx) => {
      await tx.query(`insert into bootstrap_seat (id, user_id) values ('founding', $1)`, [
        created.user.id,
      ]);
      await tx.query(
        `insert into member_role (user_id, is_admin, is_council, is_council_chair) values ($1, true, true, true)`,
        [created.user.id],
      );
      await tx.query(
        `insert into access_log
         (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note)
         values ($1, $2, $3, 'member', '', 'grant', 'bootstrap', '', 'bootstrap', $4)`,
        [randomUUID(), created.user.id, FOUNDING_ADMIN, FOUNDING_MEMBER_NOTE],
      );
      await tx.query(
        `insert into access_log
         (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note)
         values ($1, $2, $3, 'admin', '', 'grant', 'bootstrap', 'bootstrap', 'bootstrap', $4)`,
        [randomUUID(), created.user.id, FOUNDING_ADMIN, FOUNDING_ADMIN_NOTE],
      );
    });
  } catch (error) {
    await db.query(`delete from "user" where id = $1`, [created.user.id]);
    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("bootstrap_seat") ||
      message.includes("duplicate") ||
      message.includes("unique")
    ) {
      return fail(409, "The founding admin is already seated. This runs once.");
    }
    throw error;
  }

  console.log(JSON.stringify({ event: "founding-seat", userId: created.user.id }));
  return { ok: true, value: { userId: created.user.id } };
}
