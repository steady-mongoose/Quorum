import { randomUUID } from "node:crypto";
import { isUniqueViolation, type Db } from "../db.ts";
import { OBJECT_ID } from "../../src/lib/media/limits.ts";
import { HELD_POST_ERROR } from "../../src/lib/board/account-copy.ts";
import { actorRole } from "./access.ts";
import { openBan } from "./store.ts";

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; status: number; error: string };
export type AccountResult<T> = Ok<T> | Err;

function fail(status: number, error: string): Err {
  return { ok: false, status, error };
}

const NOTE_LIMIT = 500;

export const REPORTED_POST_ERROR = "This post has an open report and cannot be deleted until a steward looks at it.";
export const BANNED_DEACTIVATE_ERROR = "This account is barred and cannot be deactivated while the bar is in force.";

/** True when any bar on this account, site-wide or in a room, is in force. */
async function barredAnywhere(db: Db, userId: string, now: Date): Promise<boolean> {
  if (await openBan(db, userId, now)) return true;
  const rooms = await db.query<{ room_id: string }>(
    `select distinct room_id from board_ban where user_id = $1 and room_id <> ''`,
    [userId],
  );
  for (const row of rooms) {
    if (await openBan(db, userId, now, row.room_id)) return true;
  }
  return false;
}

/** The member report queue may not exist yet on this database. */
async function openReportOn(db: Db, postId: string): Promise<boolean> {
  const table = await db.query<{ name: string | null }>(
    `select to_regclass('public.member_report')::text as name`,
  );
  if (!table[0]?.name) return false;
  const rows = await db.query<{ id: string }>(
    `select id from member_report
     where status = 'open' and subject_kind = 'post'
       and (subject_id = $1 or subject_id in (select id from board_post where parent_id = $1))
     limit 1`,
    [postId],
  );
  return Boolean(rows[0]);
}

function memberName(name: string): string {
  const trimmed = name.trim();
  return (trimmed || "Member").slice(0, 80);
}

export async function deleteOwnPost(
  db: Db,
  input: { userId: string; postId: string; now: Date },
): Promise<AccountResult<{ id: string }>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can delete a post.");
  if (!OBJECT_ID.test(input.postId)) return fail(404, "That post is not here.");
  const outcome = await db.transaction(async (tx) => {
    const rows = await tx.query<{
      id: string;
      author_user_id: string | null;
      author_deleted_at: Date | string | null;
    }>(
      `select id, author_user_id, author_deleted_at from board_post where id = $1 for update`,
      [input.postId],
    );
    const post = rows[0];
    if (!post || post.author_user_id !== input.userId || post.author_deleted_at) return "missing" as const;
    const held = await tx.query<{ id: string }>(
      `select id from board_csam_hold
       where purged_at is null
         and (post_id = $1 or $1 = any(post_ids))
       limit 1`,
      [input.postId],
    );
    if (held[0]) return "held" as const;
    if (await openReportOn(tx, input.postId)) return "reported" as const;
    await tx.query(`update board_post set author_deleted_at = $2 where id = $1`, [
      input.postId,
      input.now,
    ]);
    return "deleted" as const;
  });
  if (outcome === "held") return fail(403, HELD_POST_ERROR);
  if (outcome === "reported") return fail(409, REPORTED_POST_ERROR);
  if (outcome === "missing") return fail(404, "That post is not here.");
  return { ok: true, value: { id: input.postId } };
}

export async function readAccount(
  db: Db,
  userId: string,
): Promise<AccountResult<{ deactivated: boolean; deletionRequested: boolean }>> {
  const actor = await actorRole(db, userId);
  if (!actor.member) return fail(403, "Only a member can read this account.");
  const users = await db.query<{ deactivated_at: Date | string | null }>(
    `select deactivated_at from "user" where id = $1`,
    [userId],
  );
  if (!users[0]) return fail(404, "That account is not here.");
  const open = await db.query<{ id: string }>(
    `select id from account_deletion_request where user_id = $1 and status = 'open' limit 1`,
    [userId],
  );
  return {
    ok: true,
    value: {
      deactivated: users[0].deactivated_at != null,
      deletionRequested: Boolean(open[0]),
    },
  };
}

async function writeAudit(
  db: Db,
  input: { userId: string; name: string; action: "deactivate" | "reactivate" | "deletion-requested" | "deletion-completed"; detail: string; now: Date },
): Promise<void> {
  await db.query(
    `insert into account_audit (id, user_id, name, action, detail, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), input.userId, input.name, input.action, input.detail, input.now],
  );
}

export async function deactivateAccount(
  db: Db,
  input: { userId: string; name: string; now: Date },
): Promise<AccountResult<{ deactivated: true }>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can change this account.");
  if (await barredAnywhere(db, input.userId, input.now)) return fail(403, BANNED_DEACTIVATE_ERROR);
  const name = memberName(input.name);
  await db.transaction(async (tx) => {
    const rows = await tx.query<{ id: string }>(
      `update "user" set deactivated_at = $2 where id = $1 and deactivated_at is null returning id`,
      [input.userId, input.now],
    );
    if (!rows[0]) return;
    await writeAudit(tx, { userId: input.userId, name, action: "deactivate", detail: "", now: input.now });
  });
  return { ok: true, value: { deactivated: true } };
}

export async function reactivateAccount(
  db: Db,
  input: { userId: string; name: string; now: Date },
): Promise<AccountResult<{ deactivated: false }>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can change this account.");
  const name = memberName(input.name);
  await db.transaction(async (tx) => {
    const rows = await tx.query<{ id: string }>(
      `update "user" set deactivated_at = null where id = $1 and deactivated_at is not null returning id`,
      [input.userId],
    );
    if (!rows[0]) return;
    await writeAudit(tx, { userId: input.userId, name, action: "reactivate", detail: "", now: input.now });
  });
  return { ok: true, value: { deactivated: false } };
}

export async function requestAccountDeletion(
  db: Db,
  input: { userId: string; name: string; note: string; now: Date },
): Promise<AccountResult<{ requested: true }>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can change this account.");
  const note = input.note.trim();
  if (note.length > NOTE_LIMIT) return fail(400, "Keep the note to 500 characters.");
  const name = memberName(input.name);
  try {
    await db.transaction(async (tx) => {
      const existing = await tx.query<{ id: string }>(
        `select id from account_deletion_request where user_id = $1 and status = 'open' limit 1`,
        [input.userId],
      );
      if (existing[0]) return;
      await tx.query(
        `insert into account_deletion_request (id, user_id, name, note, status, created_at)
         values ($1, $2, $3, $4, 'open', $5)`,
        [randomUUID(), input.userId, name, note, input.now],
      );
      await writeAudit(tx, {
        userId: input.userId,
        name,
        action: "deletion-requested",
        detail: note,
        now: input.now,
      });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  return { ok: true, value: { requested: true } };
}

export type DeletionRequestRow = {
  id: string;
  userId: string;
  name: string;
  note: string;
  at: number;
};

export async function listDeletionRequests(
  db: Db,
  userId: string,
): Promise<AccountResult<DeletionRequestRow[]>> {
  const actor = await actorRole(db, userId);
  if (!actor.admin) return fail(403, "Deletion requests are for admins.");
  const rows = await db.query<{
    id: string;
    user_id: string;
    name: string;
    note: string;
    created_at: Date | string;
  }>(
    `select id, user_id, name, note, created_at
     from account_deletion_request
     where status = 'open'
     order by created_at asc, id asc`,
  );
  return {
    ok: true,
    value: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      note: row.note,
      at: new Date(row.created_at).getTime(),
    })),
  };
}

/** Text left on an erased post. The column cannot be empty. */
export const ERASED_POST_TEXT = "Erased.";

async function postIsKept(db: Db, postId: string): Promise<boolean> {
  const held = await db.query<{ id: string }>(
    `select id from board_csam_hold
     where purged_at is null and (post_id = $1 or $1 = any(post_ids))
     limit 1`,
    [postId],
  );
  if (held[0]) return true;
  return openReportOn(db, postId);
}

/**
 * NEEDS JOSH'S SIGN-OFF. An admin completes a member's deletion request. Every
 * post the member wrote is erased, except a post under a CSAM or legal hold or
 * an open report. Those are kept untouched and counted in the audit row.
 */
export async function completeAccountDeletion(
  db: Db,
  input: { adminUserId: string; requestId: string; now: Date },
): Promise<AccountResult<{ erased: number; kept: number }>> {
  const actor = await actorRole(db, input.adminUserId);
  if (!actor.admin) return fail(403, "Deletion requests are for admins.");
  const done = await db.transaction(async (tx) => {
    const rows = await tx.query<{ user_id: string; name: string }>(
      `update account_deletion_request set status = 'done'
       where id = $1 and status = 'open' returning user_id, name`,
      [input.requestId],
    );
    const request = rows[0];
    if (!request) return null;
    if (request.user_id === input.adminUserId) throw new SelfCompletion();
    const posts = await tx.query<{ id: string }>(
      `select id from board_post where author_user_id = $1 and erased_at is null for update`,
      [request.user_id],
    );
    let erased = 0;
    let kept = 0;
    for (const post of posts) {
      if (await postIsKept(tx, post.id)) {
        kept += 1;
        continue;
      }
      await tx.query(
        `update board_post
         set claim = $2, reason = '', named = '', came = '{}',
             author_user_id = null, author_name = 'Former member',
             author_deleted_at = coalesce(author_deleted_at, $3), erased_at = $3
         where id = $1`,
        [post.id, ERASED_POST_TEXT, input.now],
      );
      erased += 1;
    }
    await writeAudit(tx, {
      userId: request.user_id,
      name: request.name,
      action: "deletion-completed",
      detail: `Posts erased: ${erased}. Kept for a hold or open report: ${kept}.`,
      now: input.now,
    });
    return { erased, kept };
  }).catch((error) => {
    if (error instanceof SelfCompletion) return "self" as const;
    throw error;
  });
  if (done === "self") return fail(403, "Another admin completes your own deletion request.");
  if (!done) return fail(404, "That request is not open.");
  return { ok: true, value: done };
}

class SelfCompletion extends Error {}
