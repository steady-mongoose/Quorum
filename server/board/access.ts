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

export type BoardActor = { member: boolean; steward: boolean; admin: boolean };

/**
 * A live member grant, or the founding admin, can read and post.
 * A live steward grant, or an admin, can mark, remove, and ban.
 * Only an admin can add a room or grant and revoke the steward role.
 */
export async function actorRole(db: Db, userId: string): Promise<BoardActor> {
  const admin = await isAdmin(db, userId);
  const member = admin || (await liveRole(db, userId, "member"));
  const steward = admin || (await liveRole(db, userId, "steward"));
  return { member, steward, admin };
}
