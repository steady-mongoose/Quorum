import type { Db } from "../db.ts";
import { actorRole } from "../board/access.ts";
import { concealedListing, readRoomListing } from "../board/room-visibility.ts";
import { openBanOrNone, type OpenBan } from "../board/store.ts";
import { ROOM_ID } from "../../src/lib/media/limits.ts";

export type MemberCheck =
  | { kind: "member" }
  | { kind: "outsider" }
  | { kind: "bad-room" }
  | { kind: "unavailable" }
  | { kind: "banned"; ban: OpenBan };

/**
 * Read-only. Membership is the row an invite or a post already wrote.
 * An open ban refuses the call even when that row is still there.
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
    const rows = await db.query<{ user_id: string }>(
      `select user_id from room_member where room_id = $1 and user_id = $2`,
      [roomId, userId],
    );
    return rows[0] ? { kind: "member" } : { kind: "outsider" };
  } catch {
    return { kind: "unavailable" };
  }
}
