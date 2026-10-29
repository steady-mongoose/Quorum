import type { Db } from "../db.ts";
import { actorRole } from "../board/access.ts";
import { concealedListing, readRoomListing } from "../board/room-visibility.ts";
import { guardRoomAudience } from "../board/audience.ts";
import { openBanOrNone, type OpenBan } from "../board/store.ts";
import { ROOM_ID } from "../../src/lib/media/limits.ts";
import { roomHas } from "../board/room-options.ts";

export type MemberCheck =
  | { kind: "member" }
  | { kind: "outsider" }
  | { kind: "bad-room" }
  | { kind: "unavailable" }
  | { kind: "banned"; ban: OpenBan }
  | { kind: "audience"; error: string; code: string }
  | { kind: "hidden" };

/**
 * Read-only. Membership is the row an invite or a post already wrote,
 * a saved room (room_join), or a steward grant for this room. The UI
 * offers Join the call in a room the member can open, so the server has
 * to agree with it.
 * An open ban (site-wide or for this room, including a suspension) or a
 * revoked member grant refuses the call even when that row is still there.
 * This module does not write room or room_member. An admin who has not
 * stood in the room is not in the call.
 */
export async function roomCallMember(
  db: Db,
  userId: string,
  roomId: string,
  now: Date,
): Promise<MemberCheck> {
  if (!userId || !ROOM_ID.test(roomId)) return { kind: "bad-room" };
  try {
    if (!(await roomHas(db, roomId, "calls"))) return { kind: "hidden" };
  } catch {
    return { kind: "unavailable" };
  }
  try {
    const listed = await readRoomListing(db, roomId);
    if (concealedListing(listed, await actorRole(db, userId))) return { kind: "bad-room" };
  } catch {
    return { kind: "unavailable" };
  }
  try {
    const ban = await openBanOrNone(db, userId, now, roomId);
    if (ban) return { kind: "banned", ban };
  } catch {
    return { kind: "unavailable" };
  }
  try {
    const rows = await db.query<{ via: string }>(
      `select 'stood' as via from room_member where room_id = $1 and user_id = $2
       union all
       select 'saved' as via from room_join where room_id = $1 and user_id = $2`,
      [roomId, userId],
    );
    const actor = await actorRole(db, userId);
    const standing = roomMemberStanding(
      await db.query<AccessRowLite>(
        `select id, room_id, action, at from access_log
         where user_id = $1 and role = 'member' and (room_id = '' or room_id = $2)`,
        [userId, roomId],
      ),
    );
    // A revoke refuses the call on every path: posted, invite, saved or steward.
    if (standing === "revoked" && !actor.owner) return { kind: "outsider" };
    const live = actor.admin || standing === "granted";
    if (!rows.some((row) => row.via === "stood")) {
      // A saved room or a steward grant only counts for a live member of this room.
      if (!live) return { kind: "outsider" };
      const saved = rows.some((row) => row.via === "saved");
      if (!saved && !actor.stewardRooms.includes(roomId)) return { kind: "outsider" };
    }
    const gate = await guardRoomAudience(db, {
      userId,
      roomId,
      now,
      path: "calls",
    });
    if (!gate.ok) {
      if (!gate.code) return { kind: "hidden" };
      return { kind: "audience", error: gate.error, code: gate.code };
    }
    return { kind: "member" };
  } catch {
    return { kind: "unavailable" };
  }
}

type AccessRowLite = { id: string; room_id: string; action: string; at: Date | string };

function latest(rows: AccessRowLite[]): AccessRowLite | undefined {
  // Newest first; on a tied timestamp the revoke wins; then by id, so the result is deterministic.
  return [...rows].sort((x, y) => {
    const dt = new Date(y.at).getTime() - new Date(x.at).getTime();
    if (dt) return dt;
    const rv = Number(y.action === "revoke") - Number(x.action === "revoke");
    if (rv) return rv;
    return x.id < y.id ? 1 : x.id > y.id ? -1 : 0;
  })[0];
}

/**
 * Member standing for one room, from the site-wide ('') and this room's rows only.
 * A grant in another room never restores it. A site-wide revoke wins over any
 * room grant unless a later site-wide grant restores the member. A room revoke
 * stands until a later grant for this same room; a site-wide grant does not undo it.
 * "none" means no grant history at all (posted-only people).
 */
export function roomMemberStanding(rows: AccessRowLite[]): "granted" | "revoked" | "none" {
  const site = latest(rows.filter((row) => row.room_id === ""));
  const room = latest(rows.filter((row) => row.room_id !== ""));
  if (site?.action === "revoke") return "revoked";
  // A room revoke stands until a later grant for this same room.
  if (room) return room.action === "revoke" ? "revoked" : "granted";
  return site ? "granted" : "none";
}
