import type { Db } from "../db.ts";
import { actorRole } from "../board/access.ts";
import { concealedListing, readRoomListing } from "../board/room-visibility.ts";
import { guardRoomAudience } from "../board/audience.ts";
import { openBanOrNone, type OpenBan } from "../board/store.ts";
import { ROOM_ID } from "../../src/lib/media/limits.ts";

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
    // A revoked member grant (site-wide or for this room) refuses the call on
    // every path: posted, invite, saved or steward. Someone who only posted and
    // never had a grant has no access_log row and is not refused here.
    const actor = await actorRole(db, userId);
    if (!actor.member) {
      const revoked = await db.query<{ action: string }>(
        `select action from access_log
         where user_id = $1 and role = 'member' and (room_id = '' or room_id = $2)
         order by at desc limit 1`,
        [userId, roomId],
      );
      if (revoked[0]?.action === "revoke") return { kind: "outsider" };
    }
    if (!rows.some((row) => row.via === "stood")) {
      // A saved room or a steward grant only counts for a live member.
      if (!actor.member) return { kind: "outsider" };
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
