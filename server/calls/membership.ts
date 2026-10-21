import type { Db } from "../db.ts";
import { ROOM_ID } from "../../src/lib/media/limits.ts";

export type MemberCheck = "member" | "outsider" | "bad-room" | "unavailable";

/**
 * Read-only. Membership is the row an invite already wrote. This module does
 * not write room or room_member. An admin who has not stood in the room is
 * not in the call.
 */
export async function roomCallMember(db: Db, userId: string, roomId: string): Promise<MemberCheck> {
  if (!userId || !ROOM_ID.test(roomId)) return "bad-room";
  try {
    const rows = await db.query<{ user_id: string }>(
      `select user_id from room_member where room_id = $1 and user_id = $2`,
      [roomId, userId],
    );
    return rows[0] ? "member" : "outsider";
  } catch {
    return "unavailable";
  }
}
