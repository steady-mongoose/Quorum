import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import { actorRole, type BoardActor } from "./access.ts";

/** The owner plus at most this many named admins can reach a CSAM hold. */
export const MAX_CUSTODIANS = 3;

export type CustodyAction =
  | "list"
  | "file_report"
  | "legal_hold_on"
  | "legal_hold_off"
  | "purge"
  | "grant_custodian"
  | "revoke_custodian"
  | "denied";

type Fail = { ok: false; status: number; error: string };

/** The owner always. Otherwise an admin the owner has named. Members never. */
export async function isCustodian(db: Db, userId: string, actor?: BoardActor): Promise<boolean> {
  const role = actor ?? (await actorRole(db, userId));
  if (role.owner) return true;
  if (!role.admin) return false;
  const rows = await db.query<{ user_id: string }>(
    `select user_id from csam_custodian where user_id = $1`,
    [userId],
  );
  return rows.length > 0;
}

/** Every touch of a hold, including refusals and the automatic purge, is written here. */
export async function logHoldAccess(
  db: Db,
  entry: { holdId?: string; actorUserId?: string; action: CustodyAction; detail?: string; now: Date },
): Promise<void> {
  await db.query(
    `insert into csam_access_log (id, hold_id, actor_user_id, action, detail, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      randomUUID(),
      entry.holdId ?? "",
      entry.actorUserId || null,
      entry.action,
      (entry.detail ?? "").slice(0, 500),
      entry.now,
    ],
  );
}

/** Refuse and log. */
export async function denyHold(
  db: Db,
  userId: string,
  holdId: string,
  detail: string,
  now: Date,
): Promise<Fail> {
  await logHoldAccess(db, { holdId, actorUserId: userId, action: "denied", detail, now });
  return { ok: false, status: 403, error: "Only a named CSAM custodian can do that." };
}

/** The owner names or removes a custodian. The custodian must be an admin. */
export async function setCustodian(
  db: Db,
  input: { userId: string; targetUserId: string; grant: boolean; now: Date },
): Promise<{ ok: true; value: { custodians: string[] } } | Fail> {
  const actor = await actorRole(db, input.userId);
  if (!actor.owner) {
    await logHoldAccess(db, {
      actorUserId: input.userId,
      action: "denied",
      detail: "custodian change",
      now: input.now,
    });
    return { ok: false, status: 403, error: "Only the owner names CSAM custodians." };
  }
  if (input.grant) {
    const target = await actorRole(db, input.targetUserId);
    if (!target.admin) return { ok: false, status: 400, error: "A custodian must be an admin." };
    const count = await db.query<{ n: number }>(`select count(*)::int as n from csam_custodian`);
    const already = await db.query<{ user_id: string }>(
      `select user_id from csam_custodian where user_id = $1`,
      [input.targetUserId],
    );
    if (!already[0] && Number(count[0]?.n ?? 0) >= MAX_CUSTODIANS) {
      return {
        ok: false,
        status: 409,
        error: `There are already ${MAX_CUSTODIANS} custodians. Remove one first.`,
      };
    }
    await db.query(
      `insert into csam_custodian (user_id, granted_by_user_id, granted_at) values ($1, $2, $3)
       on conflict (user_id) do nothing`,
      [input.targetUserId, input.userId, input.now],
    );
  } else {
    await db.query(`delete from csam_custodian where user_id = $1`, [input.targetUserId]);
  }
  await logHoldAccess(db, {
    actorUserId: input.userId,
    action: input.grant ? "grant_custodian" : "revoke_custodian",
    detail: input.targetUserId,
    now: input.now,
  });
  const rows = await db.query<{ user_id: string }>(
    `select user_id from csam_custodian order by granted_at, user_id`,
  );
  return { ok: true, value: { custodians: rows.map((row) => row.user_id) } };
}

/** A custodian sets or clears a legal hold. While it is set, the one-year purge skips the hold. */
export async function setLegalHold(
  db: Db,
  input: { userId: string; holdId: string; on: boolean; note: string; now: Date },
): Promise<{ ok: true; value: { legalHold: boolean } } | Fail> {
  if (!(await isCustodian(db, input.userId))) {
    return denyHold(db, input.userId, input.holdId, "legal hold", input.now);
  }
  const note = input.note.trim();
  if (input.on && (note.length < 4 || note.length > 300)) {
    return { ok: false, status: 400, error: "Say who asked for the legal hold and why." };
  }
  const rows = await db.query<{ id: string }>(
    `update board_csam_hold
     set legal_hold = $2, legal_hold_note = $3, legal_hold_by_user_id = $4, legal_hold_at = $5
     where id = $1 and purged_at is null
     returning id`,
    [input.holdId, input.on, input.on ? note : "", input.userId, input.now],
  );
  if (!rows[0]) return { ok: false, status: 404, error: "That hold is not here." };
  await logHoldAccess(db, {
    holdId: input.holdId,
    actorUserId: input.userId,
    action: input.on ? "legal_hold_on" : "legal_hold_off",
    detail: note,
    now: input.now,
  });
  return { ok: true, value: { legalHold: input.on } };
}
