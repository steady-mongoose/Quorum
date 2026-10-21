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

/**
 * Steward grants are per room. The newest row for that room decides.
 * A live grant in any room, including a blank room from an older appointment,
 * makes the member a steward for marks and removals.
 */
export async function stewardRoomIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.query<{
    id: string;
    room_id: string;
    action: "grant" | "revoke";
    at: Date | string;
  }>(`select id, room_id, action, at from access_log where user_id = $1 and role = 'steward'`, [
    userId,
  ]);
  const latest = new Map<string, { id: string; action: "grant" | "revoke"; at: number }>();
  for (const row of rows) {
    const at = new Date(row.at).getTime();
    const prev = latest.get(row.room_id);
    if (!prev || at > prev.at || (at === prev.at && row.id > prev.id)) {
      latest.set(row.room_id, { id: row.id, action: row.action, at });
    }
  }
  return [...latest.entries()].filter(([, row]) => row.action === "grant").map(([roomId]) => roomId);
}

export async function councilFlags(
  db: Db,
  userId: string,
): Promise<{ council: boolean; chair: boolean }> {
  const rows = await db.query<{ is_council: boolean; is_council_chair: boolean }>(
    `select is_council, is_council_chair from member_role where user_id = $1`,
    [userId],
  );
  return {
    council: Boolean(rows[0]?.is_council),
    chair: Boolean(rows[0]?.is_council_chair),
  };
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
  const steward = admin || (await stewardRoomIds(db, userId)).length > 0;
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
