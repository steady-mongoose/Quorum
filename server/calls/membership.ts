import type { Db } from "../db.ts";
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
    if (!rows[0]) return { kind: "outsider" };
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
