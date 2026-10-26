import type { Db } from "../db.ts";

/** Shown when this code is deployed before migration 0013 is applied. */
export const CHAT_UNAVAILABLE = "Room chat is not available yet.";

/**
 * True only when both chat tables exist. A missing table must not break
 * the board: callers skip the chat query, and the chat routes answer 503.
 */
export async function roomChatReady(db: Db): Promise<boolean> {
  const rows = await db.query<{ messages: unknown; removals: unknown }>(
    `select to_regclass('public.room_chat_message') as messages,
            to_regclass('public.room_chat_removal') as removals`,
  );
  const row = rows[0];
  return (
    row?.messages != null && row.messages !== "" && row.removals != null && row.removals !== ""
  );
}
