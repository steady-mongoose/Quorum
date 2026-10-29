import type { Db } from "../db.ts";
import {
  DEFAULT_MESSAGE_FROM,
  parseMessageFrom,
  type MessageFrom,
} from "../../src/lib/e2ee/message-setting.ts";

/** The member's own choice. A member with no members row has the default. */
export async function readMessageFrom(db: Db, userId: string): Promise<MessageFrom> {
  try {
    const rows = await db.query<{ message_from: string }>(
      `select message_from from members where user_id = $1`,
      [userId],
    );
    return parseMessageFrom(rows[0]?.message_from) ?? DEFAULT_MESSAGE_FROM;
  } catch (error) {
    // Before migration 0046 is applied the column is missing: everyone has the default.
    if (error && typeof error === "object" && "code" in error && error.code === "42703")
      return DEFAULT_MESSAGE_FROM;
    throw error;
  }
}

export async function saveMessageFrom(
  db: Db,
  userId: string,
  value: unknown,
): Promise<{ ok: true; value: MessageFrom } | { ok: false; status: number; error: string }> {
  const choice = parseMessageFrom(value);
  if (!choice) return { ok: false, status: 400, error: "Choose who can message you." };
  const saved = await db.query<{ message_from: string }>(
    `insert into members (user_id, display_name, message_from)
     select id, left(coalesce(nullif(trim(name), ''), 'Member'), 80), $2
     from "user" where id = $1
     on conflict (user_id) do update set message_from = excluded.message_from
     returning message_from`,
    [userId, choice],
  );
  if (!saved[0]) return { ok: false, status: 404, error: "That member was not found." };
  return { ok: true, value: choice };
}

/**
 * True when the recipient's setting turns the sender away. "rooms" keeps the
 * existing rules. "conversations" lets in only someone who already has a
 * conversation with the recipient. "none" turns everyone away.
 */
export async function settingRefuses(
  db: Db,
  recipientId: string,
  senderId: string,
): Promise<boolean> {
  const choice = await readMessageFrom(db, recipientId);
  if (choice === "rooms") return false;
  if (choice === "none") return true;
  const [low, high] = recipientId < senderId ? [recipientId, senderId] : [senderId, recipientId];
  const rows = await db.query<{ id: string }>(
    `select id from dm_thread where user_a = $1 and user_b = $2 limit 1`,
    [low, high],
  );
  return !rows[0];
}
