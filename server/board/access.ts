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
 * A blank room id is an old appointment and does not confer a room.
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
  return [...latest.entries()]
    .filter(([roomId, row]) => roomId.trim() !== "" && row.action === "grant")
    .map(([roomId]) => roomId);
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
  /** Rooms where this person has a live steward grant. Admins are not listed here. */
  stewardRooms: string[];
};

/** An admin may moderate every room. A steward may moderate only these rooms. */
export function stewardsRoom(actor: BoardActor, roomId: string): boolean {
  return actor.admin || actor.stewardRooms.includes(roomId);
}

async function isOwner(db: Db, userId: string): Promise<boolean> {
  const rows = await db.query<{ user_id: string }>(
    `select user_id from bootstrap_seat where id = 'founding' and user_id = $1`,
    [userId],
  );
  return Boolean(rows[0]);
}

/**
 * A live member grant, or the founding admin, can read and post.
 * A steward can mark, remove, and bar only in a room they steward.
 * An admin can mark, remove, and bar in every room.
 * Only an admin can add a room or grant and revoke the steward role.
 * The owner outranks an admin. An admin outranks a steward.
 */
export async function actorRole(db: Db, userId: string): Promise<BoardActor> {
  const owner = await isOwner(db, userId);
  const admin = owner || (await isAdmin(db, userId));
  const member = admin || (await liveRole(db, userId, "member"));
  const stewardRooms = await stewardRoomIds(db, userId);
  const steward = admin || stewardRooms.length > 0;
  return { member, steward, admin, owner, stewardRooms };
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

/**
 * actorRole for many people in three queries, for lists. Each entry matches
 * what actorRole returns for that person.
 */
export async function actorRoles(db: Db, userIds: string[]): Promise<Map<string, BoardActor>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const actors = new Map<string, BoardActor>();
  if (ids.length === 0) return actors;
  const seats = await db.query<{ user_id: string }>(
    `select user_id from bootstrap_seat where id = 'founding' and user_id = any ($1::text[])`,
    [ids],
  );
  const owners = new Set(seats.map((row) => row.user_id));
  const roles = await db.query<{ user_id: string; is_admin: boolean }>(
    `select user_id, is_admin from member_role where user_id = any ($1::text[])`,
    [ids],
  );
  const flagged = new Set(roles.filter((row) => row.is_admin).map((row) => row.user_id));
  const log = await db.query<{
    id: string;
    user_id: string;
    role: AccessRow["role"];
    room_id: string;
    action: "grant" | "revoke";
    at: Date | string;
  }>(
    `select id, user_id, role, room_id, action, at from access_log
     where user_id = any ($1::text[]) and role in ('member', 'admin', 'steward')`,
    [ids],
  );
  const byUser = new Map<string, typeof log>();
  for (const row of log) {
    const mine = byUser.get(row.user_id) ?? [];
    mine.push(row);
    byUser.set(row.user_id, mine);
  }
  for (const userId of ids) {
    const rows = byUser.get(userId) ?? [];
    const live = (role: AccessRow["role"]) =>
      isLiveGrant(
        rows
          .filter((row) => row.role === role)
          .map((row) => ({
            id: row.id,
            userId,
            role,
            action: row.action,
            at: new Date(row.at).getTime(),
          })),
        userId,
        role,
      );
    const latest = new Map<string, { id: string; action: "grant" | "revoke"; at: number }>();
    for (const row of rows) {
      if (row.role !== "steward") continue;
      const at = new Date(row.at).getTime();
      const prev = latest.get(row.room_id);
      if (!prev || at > prev.at || (at === prev.at && row.id > prev.id)) {
        latest.set(row.room_id, { id: row.id, action: row.action, at });
      }
    }
    const stewardRooms = [...latest.entries()]
      .filter(([roomId, row]) => roomId.trim() !== "" && row.action === "grant")
      .map(([roomId]) => roomId);
    const owner = owners.has(userId);
    const admin = owner || flagged.has(userId) || live("admin");
    const member = admin || live("member");
    actors.set(userId, {
      member,
      steward: admin || stewardRooms.length > 0,
      admin,
      owner,
      stewardRooms,
    });
  }
  return actors;
}
