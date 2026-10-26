import { randomBytes, randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import { consumeLimit } from "../rate-limit.ts";
import { actorRole } from "../board/access.ts";
import {
  MFA_FAIL_LIMIT,
  MFA_LOCK_MS,
  MFA_RATE,
  STEP_UP_MS,
  actorRequiresMfa,
  phaseFor,
  type MfaPhase,
  type StepUpAction,
} from "./policy.ts";
import {
  generateRecoveryCode,
  hashRecoveryCode,
  matchRecoveryCode,
  RECOVERY_COUNT,
} from "./recovery.ts";
import { qrModules } from "./qr.ts";
import { MfaKeyError, openSecret, sealSecret } from "./secret.ts";
import { base32Encode, otpauthUrl, verifyTotp } from "./totp.ts";

export type MfaFailure = {
  status: number;
  error: string;
  message: string;
  step?: "challenge" | "enroll";
  action?: StepUpAction;
  retryAfter?: number;
};

export type SessionRef = { id: string; sessionId?: string; email?: string };

type FactorRow = {
  id: string;
  status: string;
  secret_ciphertext: string;
  secret_iv: string;
  key_id: string;
  last_accepted_step: string | number | null;
};

function fail(
  status: number,
  error: string,
  message: string,
  extra: Partial<MfaFailure> = {},
): MfaFailure {
  return { status, error, message, ...extra };
}

async function audit(
  db: Db,
  actorId: string | null,
  subjectId: string | null,
  action: string,
  detail: string,
): Promise<void> {
  await db.query(
    `insert into mfa_audit (id, actor_user_id, subject_user_id, action, detail)
     values ($1, $2, $3, $4, $5)`,
    [randomUUID(), actorId, subjectId, action, detail.slice(0, 200)],
  );
}

async function liveFactor(db: Db, userId: string, status: "pending" | "active"): Promise<FactorRow | null> {
  const rows = await db.query<FactorRow>(
    `select id, status, secret_ciphertext, secret_iv, key_id, last_accepted_step
     from mfa_factor
     where user_id = $1 and kind = 'totp' and status = $2
     limit 1`,
    [userId, status],
  );
  return rows[0] ?? null;
}

function lastStep(row: FactorRow): bigint | null {
  if (row.last_accepted_step === null || row.last_accepted_step === undefined) return null;
  return BigInt(row.last_accepted_step);
}

function plainSecret(row: FactorRow): Buffer | null {
  return openSecret({
    ciphertext: row.secret_ciphertext,
    iv: row.secret_iv,
    keyId: row.key_id,
  });
}

export async function mfaView(
  db: Db,
  user: SessionRef,
): Promise<{
  required: boolean;
  enrolled: boolean;
  pending: boolean;
  recoveryRemaining: number;
  mfa: MfaPhase;
}> {
  const required = await actorRequiresMfa(db, user.id);
  const active = await liveFactor(db, user.id, "active");
  const pending = await liveFactor(db, user.id, "pending");
  const enrolled = Boolean(active);
  let verified = !enrolled;
  if (enrolled && user.sessionId) {
    const rows = await db.query<{ verified_at: Date | string | null }>(
      `select verified_at from mfa_assurance where session_id = $1 and user_id = $2`,
      [user.sessionId, user.id],
    );
    verified = Boolean(rows[0]?.verified_at);
  }
  let recoveryRemaining = 0;
  if (active) {
    const counts = await db.query<{ n: string | number }>(
      `select count(*) as n from mfa_recovery_code where factor_id = $1 and used_at is null`,
      [active.id],
    );
    recoveryRemaining = Number(counts[0]?.n ?? 0);
  }
  return {
    required,
    enrolled,
    pending: Boolean(pending),
    recoveryRemaining,
    mfa: phaseFor({ required, enrolled, verified }),
  };
}

export async function noteSignIn(
  db: Db,
  user: SessionRef,
): Promise<{ mfa: MfaPhase; mfaEnrolled: boolean }> {
  const view = await mfaView(db, user);
  if (view.enrolled && user.sessionId) {
    await db.query(
      `insert into mfa_assurance (session_id, user_id, verified_at)
       values ($1, $2, null)
       on conflict (session_id) do update
         set user_id = excluded.user_id, verified_at = null`,
      [user.sessionId, user.id],
    );
    return { mfa: "challenge", mfaEnrolled: true };
  }
  return { mfa: view.mfa, mfaEnrolled: view.enrolled };
}

async function lockState(
  db: Db,
  userId: string,
  now: Date,
): Promise<{ failCount: number; lockedUntil: Date | null }> {
  const rows = await db.query<{ fail_count: number; locked_until: Date | string | null }>(
    `select fail_count, locked_until from mfa_lock where user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return { failCount: 0, lockedUntil: null };
  const lockedUntil = row.locked_until ? new Date(row.locked_until) : null;
  if (lockedUntil && lockedUntil.getTime() <= now.getTime()) {
    await db.query(`update mfa_lock set fail_count = 0, locked_until = null where user_id = $1`, [
      userId,
    ]);
    return { failCount: 0, lockedUntil: null };
  }
  return { failCount: Number(row.fail_count), lockedUntil };
}

async function recordFailure(db: Db, userId: string, now: Date): Promise<MfaFailure | null> {
  const current = await lockState(db, userId, now);
  const next = current.failCount + 1;
  if (next >= MFA_FAIL_LIMIT) {
    const until = new Date(now.getTime() + MFA_LOCK_MS);
    await db.query(
      `insert into mfa_lock (user_id, fail_count, locked_until)
       values ($1, $2, $3)
       on conflict (user_id) do update set fail_count = $2, locked_until = $3`,
      [userId, next, until],
    );
    return fail(429, "mfa_locked", "Too many attempts. Wait and try again.", {
      retryAfter: Math.ceil(MFA_LOCK_MS / 1000),
    });
  }
  await db.query(
    `insert into mfa_lock (user_id, fail_count, locked_until)
     values ($1, $2, null)
     on conflict (user_id) do update set fail_count = $2, locked_until = null`,
    [userId, next],
  );
  return null;
}

async function clearLock(db: Db, userId: string): Promise<void> {
  await db.query(`delete from mfa_lock where user_id = $1`, [userId]);
}

async function rateLimited(db: Db, userId: string, ip: string, now: Date): Promise<MfaFailure | null> {
  const userHit = await consumeLimit(db, `mfa:user:${userId}`, MFA_RATE, now.getTime());
  if (!userHit.allowed) {
    return fail(429, "mfa_rate", "Too many attempts. Wait and try again.", {
      retryAfter: userHit.retryAfter,
    });
  }
  const ipHit = await consumeLimit(db, `mfa:ip:${ip}`, MFA_RATE, now.getTime());
  if (!ipHit.allowed) {
    return fail(429, "mfa_rate", "Too many attempts. Wait and try again.", {
      retryAfter: ipHit.retryAfter,
    });
  }
  return null;
}

type CodeCheck =
  | { ok: true; step: bigint | null; recoveryId: string | null; factorId: string }
  | { ok: false; failure: MfaFailure };

async function checkCode(
  db: Db,
  userId: string,
  code: string,
  now: Date,
  ip: string,
): Promise<CodeCheck> {
  const limited = await rateLimited(db, userId, ip, now);
  if (limited) return { ok: false, failure: limited };
  const locked = await lockState(db, userId, now);
  if (locked.lockedUntil) {
    const retryAfter = Math.max(1, Math.ceil((locked.lockedUntil.getTime() - now.getTime()) / 1000));
    return {
      ok: false,
      failure: fail(429, "mfa_locked", "Too many attempts. Wait and try again.", { retryAfter }),
    };
  }
  const factor = await liveFactor(db, userId, "active");
  const row = factor;
  if (!row) {
    return {
      ok: false,
      failure: fail(400, "mfa_invalid", "That code is not valid."),
    };
  }
  const secret = plainSecret(row);
  if (!secret) {
    return {
      ok: false,
      failure: fail(503, "mfa_unconfigured", "Authenticator enrollment is not available on this server yet."),
    };
  }
  const totp = verifyTotp(secret, code, now.getTime(), lastStep(row));
  if (totp.ok) {
    const updated = await db.query<{ last_accepted_step: string }>(
      `update mfa_factor
         set last_accepted_step = $2
       where id = $1
         and (last_accepted_step is null or last_accepted_step < $2)
       returning last_accepted_step`,
      [row.id, totp.step.toString()],
    );
    if (!updated[0]) {
      const lock = await recordFailure(db, userId, now);
      return {
        ok: false,
        failure: lock ?? fail(401, "mfa_replay", "That code was already used."),
      };
    }
    await clearLock(db, userId);
    return { ok: true, step: totp.step, recoveryId: null, factorId: row.id };
  }
  if (totp.reason === "replay") {
    const lock = await recordFailure(db, userId, now);
    return {
      ok: false,
      failure: lock ?? fail(401, "mfa_replay", "That code was already used."),
    };
  }
  if (factor && (/[A-Za-z-]/.test(code) || code.trim().length > 6)) {
    const codes = await db.query<{ id: string; code_hash: string; used_at: Date | null }>(
      `select id, code_hash, used_at from mfa_recovery_code where factor_id = $1 order by id`,
      [factor.id],
    );
    const matched = await matchRecoveryCode(
      code,
      codes.map((item) => ({ id: item.id, codeHash: item.code_hash, used: Boolean(item.used_at) })),
    );
    if (matched) {
      const spent = await db.query<{ id: string }>(
        `update mfa_recovery_code set used_at = $2 where id = $1 and used_at is null returning id`,
        [matched.id, now],
      );
      if (!spent[0]) {
        const lock = await recordFailure(db, userId, now);
        return {
          ok: false,
          failure: lock ?? fail(401, "mfa_replay", "That code was already used."),
        };
      }
      await clearLock(db, userId);
      await audit(db, userId, userId, "recovery-use", "recovery");
      return { ok: true, step: null, recoveryId: matched.id, factorId: factor.id };
    }
  }
  const lock = await recordFailure(db, userId, now);
  return {
    ok: false,
    failure: lock ?? fail(401, "mfa_invalid", "That code is not valid."),
  };
}

export async function startEnroll(
  db: Db,
  user: SessionRef,
  kind: string,
): Promise<{ ok: true; secret: string; otpauth: string; modules: number[][] } | { ok: false; failure: MfaFailure }> {
  if (kind === "passkey") {
    return {
      ok: false,
      failure: fail(501, "passkey_later", "Passkeys are not available yet."),
    };
  }
  if (kind !== "totp") {
    return { ok: false, failure: fail(400, "mfa_kind", "That authenticator is not available.") };
  }
  const active = await liveFactor(db, user.id, "active");
  if (active) {
    const required = await actorRequiresMfa(db, user.id);
    return {
      ok: false,
      failure: fail(
        409,
        "mfa_active",
        required
          ? "An admin reset is how this comes off."
          : "Authenticator is already on. Enter a code to turn it off.",
      ),
    };
  }
  const shown = randomBytes(20);
  let packed;
  try {
    packed = sealSecret(shown);
  } catch (error) {
    shown.fill(0);
    if (error instanceof MfaKeyError) {
      return {
        ok: false,
        failure: fail(503, "mfa_unconfigured", "Authenticator enrollment is not available on this server yet."),
      };
    }
    throw error;
  }
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      `delete from mfa_factor where user_id = $1 and kind = 'totp' and status = 'pending'`,
      [user.id],
    );
    await tx.query(
      `insert into mfa_factor
        (id, user_id, kind, status, secret_ciphertext, secret_iv, key_id)
       values ($1, $2, 'totp', 'pending', $3, $4, $5)`,
      [id, user.id, packed.ciphertext, packed.iv, packed.keyId],
    );
    await audit(tx, user.id, user.id, "enroll", "pending");
  });
  const text = base32Encode(shown);
  shown.fill(0);
  const otpauth = otpauthUrl(user.email || user.id, text);
  return { ok: true, secret: text, otpauth, modules: qrModules(otpauth) };
}

export async function confirmEnroll(
  db: Db,
  user: SessionRef,
  code: string,
  now: Date,
  ip: string,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; failure: MfaFailure }> {
  const pending = await liveFactor(db, user.id, "pending");
  if (!pending) {
    return { ok: false, failure: fail(400, "mfa_invalid", "Start enrollment before entering a code.") };
  }
  const limited = await rateLimited(db, user.id, ip, now);
  if (limited) return { ok: false, failure: limited };
  const locked = await lockState(db, user.id, now);
  if (locked.lockedUntil) {
    const retryAfter = Math.max(1, Math.ceil((locked.lockedUntil.getTime() - now.getTime()) / 1000));
    return {
      ok: false,
      failure: fail(429, "mfa_locked", "Too many attempts. Wait and try again.", { retryAfter }),
    };
  }
  const secret = plainSecret(pending);
  if (!secret) {
    return {
      ok: false,
      failure: fail(503, "mfa_unconfigured", "Authenticator enrollment is not available on this server yet."),
    };
  }
  const totp = verifyTotp(secret, code, now.getTime(), lastStep(pending));
  if (!totp.ok) {
    const lock = await recordFailure(db, user.id, now);
    return {
      ok: false,
      failure:
        lock ??
        fail(
          401,
          totp.reason === "replay" ? "mfa_replay" : "mfa_invalid",
          totp.reason === "replay" ? "That code was already used." : "That code is not valid.",
        ),
    };
  }
  const codes = Array.from({ length: RECOVERY_COUNT }, () => generateRecoveryCode());
  const hashes: string[] = [];
  for (const recovery of codes) hashes.push(await hashRecoveryCode(recovery));
  const activated = await db.transaction(async (tx) => {
    const updated = await tx.query<{ id: string }>(
      `update mfa_factor
         set status = 'active',
             confirmed_at = $3,
             last_accepted_step = $2
       where id = $1 and status = 'pending'
       returning id`,
      [pending.id, totp.step.toString(), now],
    );
    if (!updated[0]) return false;
    for (let index = 0; index < codes.length; index += 1) {
      await tx.query(
        `insert into mfa_recovery_code (id, user_id, factor_id, code_hash) values ($1, $2, $3, $4)`,
        [randomUUID(), user.id, pending.id, hashes[index]],
      );
    }
    if (user.sessionId) {
      await tx.query(
        `insert into mfa_assurance (session_id, user_id, verified_at)
         values ($1, $2, $3)
         on conflict (session_id) do update set verified_at = excluded.verified_at, user_id = excluded.user_id`,
        [user.sessionId, user.id, now],
      );
    }
    await audit(tx, user.id, user.id, "enroll", "active");
    return true;
  });
  if (!activated) {
    return { ok: false, failure: fail(409, "mfa_active", "Authenticator is already on.") };
  }
  await clearLock(db, user.id);
  return { ok: true, recoveryCodes: codes };
}

export async function submitChallenge(
  db: Db,
  user: SessionRef,
  code: string,
  now: Date,
  ip: string,
): Promise<{ ok: true } | { ok: false; failure: MfaFailure }> {
  if (!user.sessionId) return { ok: false, failure: fail(401, "mfa_session", "Sign in first.") };
  const checked = await checkCode(db, user.id, code, now, ip);
  if (!checked.ok) return checked;
  await db.query(
    `insert into mfa_assurance (session_id, user_id, verified_at)
     values ($1, $2, $3)
     on conflict (session_id) do update set verified_at = excluded.verified_at, user_id = excluded.user_id`,
    [user.sessionId, user.id, now],
  );
  return { ok: true };
}

export async function submitStepUp(
  db: Db,
  user: SessionRef,
  action: StepUpAction,
  code: string,
  now: Date,
  ip: string,
): Promise<{ ok: true } | { ok: false; failure: MfaFailure }> {
  if (!user.sessionId) return { ok: false, failure: fail(401, "mfa_session", "Sign in first.") };
  const view = await mfaView(db, user);
  if (view.mfa === "challenge") {
    return {
      ok: false,
      failure: fail(403, "mfa_required", "Enter the authenticator code to finish signing in.", {
        step: "challenge",
      }),
    };
  }
  if (!view.enrolled) {
    return {
      ok: false,
      failure: fail(403, "mfa_required", "Turn on an authenticator before using this.", { step: "enroll" }),
    };
  }
  const checked = await checkCode(db, user.id, code, now, ip);
  if (!checked.ok) return checked;
  const expires = new Date(now.getTime() + STEP_UP_MS);
  await db.query(
    `insert into mfa_step_up (id, session_id, user_id, action, expires_at) values ($1, $2, $3, $4, $5)`,
    [randomUUID(), user.sessionId, user.id, action, expires],
  );
  return { ok: true };
}

export async function disableMfa(
  db: Db,
  user: SessionRef,
  code: string,
  now: Date,
  ip: string,
): Promise<{ ok: true } | { ok: false; failure: MfaFailure }> {
  if (await actorRequiresMfa(db, user.id)) {
    return {
      ok: false,
      failure: fail(403, "mfa_required", "An admin reset is how this comes off."),
    };
  }
  const checked = await checkCode(db, user.id, code, now, ip);
  if (!checked.ok) return checked;
  await db.transaction(async (tx) => {
    await tx.query(`delete from mfa_recovery_code where user_id = $1`, [user.id]);
    await tx.query(
      `update mfa_factor
         set status = 'disabled',
             disabled_at = $2,
             secret_ciphertext = '',
             secret_iv = '',
             key_id = '',
             last_accepted_step = null
       where user_id = $1 and status = 'active'`,
      [user.id, now],
    );
    await audit(tx, user.id, user.id, "disable", "totp");
  });
  return { ok: true };
}

async function hasStepUp(
  db: Db,
  user: SessionRef,
  action: StepUpAction,
  now: Date,
): Promise<boolean> {
  if (!user.sessionId) return false;
  const rows = await db.query<{ id: string }>(
    `select id from mfa_step_up
     where session_id = $1 and user_id = $2 and action = $3 and expires_at > $4
     limit 1`,
    [user.sessionId, user.id, action, now],
  );
  return Boolean(rows[0]);
}

export async function guardRequest(
  db: Db,
  user: SessionRef,
  input: { stepUp?: StepUpAction | null; privileged?: boolean },
  now: Date,
): Promise<MfaFailure | null> {
  const view = await mfaView(db, user);
  if (view.mfa === "challenge") {
    return fail(403, "mfa_required", "Enter the authenticator code to finish signing in.", {
      step: "challenge",
    });
  }
  const needsEnroll = Boolean(input.stepUp) || Boolean(input.privileged);
  if (needsEnroll && view.required && !view.enrolled) {
    return fail(403, "mfa_required", "Turn on an authenticator before using this.", { step: "enroll" });
  }
  if (input.stepUp && view.enrolled && !(await hasStepUp(db, user, input.stepUp, now))) {
    return fail(403, "mfa_step_up", "Enter a fresh authenticator code for this.", {
      action: input.stepUp,
    });
  }
  return null;
}

export async function requestReset(
  db: Db,
  actor: SessionRef,
  subjectUserId: string,
): Promise<{ ok: true; id: string } | { ok: false; failure: MfaFailure }> {
  if (!subjectUserId) return { ok: false, failure: fail(400, "mfa_subject", "Name the account.") };
  const actorRoleRow = await actorRole(db, actor.id);
  if (subjectUserId !== actor.id && !actorRoleRow.admin) {
    return { ok: false, failure: fail(403, "mfa_reset", "An admin asks for that reset.") };
  }
  const existing = await db.query<{ id: string }>(
    `select id from mfa_reset where user_id = $1 and status = 'pending' limit 1`,
    [subjectUserId],
  );
  if (existing[0]) return { ok: true, id: existing[0].id };
  const id = randomUUID();
  await db.query(
    `insert into mfa_reset (id, user_id, requested_by, status) values ($1, $2, $3, 'pending')`,
    [id, subjectUserId, actor.id],
  );
  await audit(db, actor.id, subjectUserId, "reset-request", "pending");
  return { ok: true, id };
}

export async function approveReset(
  db: Db,
  actor: SessionRef,
  resetId: string,
  now: Date,
): Promise<{ ok: true; completed: boolean } | { ok: false; failure: MfaFailure }> {
  const actorRoleRow = await actorRole(db, actor.id);
  if (!actorRoleRow.admin) {
    return { ok: false, failure: fail(403, "mfa_reset", "An admin approves a reset.") };
  }
  const stepped = await guardRequest(db, actor, { stepUp: "mfa-reset" }, now);
  if (stepped) return { ok: false, failure: stepped };
  return db.transaction(async (tx) => {
    const rows = await tx.query<{
      id: string;
      user_id: string;
      requested_by: string;
      status: string;
    }>(`select id, user_id, requested_by, status from mfa_reset where id = $1 for update`, [resetId]);
    const reset = rows[0];
    if (!reset || reset.status !== "pending") {
      return { ok: false, failure: fail(404, "mfa_reset", "That reset is not waiting.") };
    }
    if (actor.id === reset.user_id) {
      return {
        ok: false,
        failure: fail(403, "mfa_reset_self", "You cannot approve a reset of your own account."),
      };
    }
    if (actor.id === reset.requested_by) {
      return {
        ok: false,
        failure: fail(403, "mfa_reset_requester", "The person who asked for the reset cannot approve it."),
      };
    }
    const prior = await tx.query<{ approver_id: string }>(
      `select approver_id from mfa_reset_approval where reset_id = $1`,
      [resetId],
    );
    if (prior.some((row) => row.approver_id === actor.id)) {
      return {
        ok: false,
        failure: fail(403, "mfa_reset_repeat", "A different admin has to approve this."),
      };
    }
    await tx.query(
      `insert into mfa_reset_approval (id, reset_id, approver_id) values ($1, $2, $3)`,
      [randomUUID(), resetId, actor.id],
    );
    await audit(tx, actor.id, reset.user_id, "reset-approve", resetId);
    const approvals = prior.length + 1;
    if (approvals < 2) return { ok: true, completed: false };
    await tx.query(`delete from mfa_recovery_code where user_id = $1`, [reset.user_id]);
    await tx.query(
      `update mfa_factor
         set status = 'disabled',
             disabled_at = $2,
             secret_ciphertext = '',
             secret_iv = '',
             key_id = '',
             last_accepted_step = null
       where user_id = $1 and status in ('pending', 'active')`,
      [reset.user_id, now],
    );
    await tx.query(`delete from mfa_assurance where user_id = $1`, [reset.user_id]);
    await tx.query(
      `update mfa_reset set status = 'completed', completed_at = $2 where id = $1`,
      [resetId, now],
    );
    await audit(tx, actor.id, reset.user_id, "reset-complete", resetId);
    return { ok: true, completed: true };
  });
}

export type ResetQueueItem = {
  id: string;
  userId: string;
  name: string;
  email: string;
  requestedBy: string;
  requesterName: string;
  status: string;
  approvals: { approverId: string; at: string }[];
  createdAt: string;
};

export async function listResets(db: Db, actor: SessionRef): Promise<
  { ok: true; resets: ResetQueueItem[] } | { ok: false; failure: MfaFailure }
> {
  const actorRoleRow = await actorRole(db, actor.id);
  if (!actorRoleRow.admin) {
    return { ok: false, failure: fail(403, "mfa_reset", "An admin reads the reset queue.") };
  }
  const view = await mfaView(db, actor);
  if (view.mfa === "challenge") {
    return {
      ok: false,
      failure: fail(403, "mfa_required", "Enter the authenticator code to finish signing in.", {
        step: "challenge",
      }),
    };
  }
  if (view.required && !view.enrolled) {
    return {
      ok: false,
      failure: fail(403, "mfa_required", "Turn on an authenticator before using this.", { step: "enroll" }),
    };
  }
  const rows = await db.query<{
    id: string;
    user_id: string;
    name: string;
    email: string;
    requested_by: string;
    requester_name: string;
    status: string;
    created_at: Date | string;
  }>(
    `select r.id, r.user_id, u.name, u.email, r.requested_by, a.name as requester_name,
            r.status, r.created_at
     from mfa_reset r
     join "user" u on u.id = r.user_id
     join "user" a on a.id = r.requested_by
     where r.status = 'pending'
     order by r.created_at asc`,
  );
  const approvals =
    rows.length === 0
      ? []
      : await db.query<{ reset_id: string; approver_id: string; at: Date | string }>(
          `select reset_id, approver_id, at from mfa_reset_approval
           where reset_id = any($1::text[])
           order by at asc`,
          [rows.map((row) => row.id)],
        );
  return {
    ok: true,
    resets: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      email: row.email,
      requestedBy: row.requested_by,
      requesterName: row.requester_name,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      approvals: approvals
        .filter((item) => item.reset_id === row.id)
        .map((item) => ({ approverId: item.approver_id, at: new Date(item.at).toISOString() })),
    })),
  };
}

export async function accountExport(
  db: Db,
  user: SessionRef,
  now: Date,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; failure: MfaFailure }> {
  const gate = await guardRequest(db, user, { stepUp: "data-export" }, now);
  if (gate) return { ok: false, failure: gate };
  const people = await db.query<{ id: string; name: string; email: string }>(
    `select id, name, email from "user" where id = $1`,
    [user.id],
  );
  const person = people[0];
  if (!person) return { ok: false, failure: fail(404, "mfa_export", "That account is not here.") };
  const view = await mfaView(db, user);
  return {
    ok: true,
    body: {
      exportedAt: now.toISOString(),
      user: { id: person.id, name: person.name, email: person.email },
      mfa: { enrolled: view.enrolled, required: view.required },
    },
  };
}
