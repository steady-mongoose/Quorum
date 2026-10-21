import type { Db } from "../db.ts";
import { isAdmin } from "../closed-test/store.ts";
import { isLiveGrant, type AccessRow } from "../closed-test/rules.ts";

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

export type BoardActor = {
  member: boolean;
  steward: boolean;
  admin: boolean;
  /** The founding seat. Admins cannot bar or remove this member. */
  owner: boolean;
};

async function isOwner(db: Db, userId: string): Promise<boolean> {
  const rows = await db.query<{ user_id: string }>(
    `select user_id from bootstrap_seat where id = 'founding' and user_id = $1`,
    [userId],
  );
  return Boolean(rows[0]);
}

/**
 * A live member grant, or the founding admin, can read and post.
 * A live steward grant, or an admin, can mark, remove, and ban.
 * Only an admin can add a room or grant and revoke the steward role.
 * The owner outranks an admin. An admin outranks a steward.
 */
export async function actorRole(db: Db, userId: string): Promise<BoardActor> {
  const owner = await isOwner(db, userId);
  const admin = owner || (await isAdmin(db, userId));
  const member = admin || (await liveRole(db, userId, "member"));
  const steward = admin || (await liveRole(db, userId, "steward"));
  return { member, steward, admin, owner };
}

/**
 * Who may bar a member or remove that member's post.
 * A steward cannot act on the owner, an admin, or another steward.
 * An admin cannot act on the owner. An admin can act on another admin.
 */
export function moderationStop(actor: BoardActor, target: BoardActor): string | null {
  if (target.owner) return "The owner cannot be barred.";
  if (target.admin) {
    if (actor.owner || actor.admin) return null;
    return "A steward cannot bar an admin.";
  }
  if (target.steward) {
    if (actor.admin) return null;
    return "A steward cannot bar another steward.";
  }
  return null;
}
