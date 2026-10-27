import type { Db } from "../db.ts";
import { openBanOrNone } from "../board/store.ts";
import { sharesMeeting } from "../dm/store.ts";
import type { MemberCheck } from "./membership.ts";

export type DmCallCheck = MemberCheck;

const THREAD_ID = /^[0-9a-f-]{36}$/;

/**
 * Read-only. A DM call is allowed only inside an existing thread, between
 * its two people, while they still share a verified meeting (the same rule
 * that lets them message) and neither has an open ban. No table is written.
 */
export async function dmCallMember(
  db: Db,
  userId: string,
  threadId: string,
  now: Date,
): Promise<DmCallCheck> {
  if (!userId || !THREAD_ID.test(threadId)) return { kind: "bad-room" };
  let other = "";
  try {
    const rows = await db.query<{ user_a: string; user_b: string }>(
      `select user_a, user_b from dm_thread where id = $1`,
      [threadId],
    );
    const row = rows[0];
    // A thread you are not in looks the same as no thread.
    if (!row || (row.user_a !== userId && row.user_b !== userId)) return { kind: "bad-room" };
    other = row.user_a === userId ? row.user_b : row.user_a;
  } catch {
    return { kind: "unavailable" };
  }
  try {
    const ban = await openBanOrNone(db, userId, now);
    if (ban) return { kind: "banned", ban };
    const theirs = await openBanOrNone(db, other, now);
    if (theirs) return { kind: "outsider" };
    if (!(await sharesMeeting(db, userId, other))) return { kind: "outsider" };
    return { kind: "member" };
  } catch {
    return { kind: "unavailable" };
  }
}
