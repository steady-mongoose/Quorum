import type { Db } from "../db.ts";
import {
  DEFAULT_MESSAGE_FROM,
  parseMessageFrom,
  type MessageFrom,
} from "../../src/lib/e2ee/message-setting.ts";

/** Before migration 0046 is applied, its columns are missing (Postgres 42703). */
export function missingColumn(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "42703");
}

/** Shown when the setting can't be saved yet because migration 0046 isn't applied. */
export const SETTING_NOT_READY = "Can't save this setting yet. Try again later.";

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
    if (missingColumn(error)) return DEFAULT_MESSAGE_FROM;
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
  let saved: { message_from: string }[];
  try {
    saved = await db.query<{ message_from: string }>(
      `insert into members (user_id, display_name, message_from)
       select id, left(coalesce(nullif(trim(name), ''), 'Member'), 80), $2
       from "user" where id = $1
       on conflict (user_id) do update set message_from = excluded.message_from
       returning message_from`,
      [userId, choice],
    );
  } catch (error) {
    if (missingColumn(error)) return { ok: false, status: 503, error: SETTING_NOT_READY };
    throw error;
  }
  if (!saved[0]) return { ok: false, status: 404, error: "That member was not found." };
  return { ok: true, value: choice };
}

/**
 * Both members' Messages settings, read in one query that always runs the same
 * way, so a refusal costs the same work whatever its reason.
 * refused: the recipient's setting turns the sender away. "rooms" keeps the
 * existing rules, "conversations" lets in only someone the recipient has
 * written to (the recipient has sent at least one message in their
 * conversation, kept as the lasting user_a/b_wrote_at marker because messages
 * expire; a sender who wrote first and never got a reply is turned away), and
 * "none" turns everyone away.
 * senderOff: the sender chose "No one", which closes their own writing too.
 */
export async function messageSettings(
  db: Db,
  senderId: string,
  recipientId: string,
): Promise<{ refused: boolean; senderOff: boolean }> {
  const [low, high] = recipientId < senderId ? [recipientId, senderId] : [senderId, recipientId];
  let row: { recipient: string | null; sender: string | null; talking: boolean } | undefined;
  try {
    const rows = await db.query<{
      recipient: string | null;
      sender: string | null;
      talking: boolean;
    }>(
      `select
         (select message_from from members where user_id = $1) as recipient,
         (select message_from from members where user_id = $2) as sender,
         exists (
           select 1 from dm_thread t
           where t.user_a = $3 and t.user_b = $4
             and (case when $1::text = $3::text then t.user_a_wrote_at
                       else t.user_b_wrote_at end) is not null
         ) as talking`,
      [recipientId, senderId, low, high],
    );
    row = rows[0];
  } catch (error) {
    // Before migration 0046 is applied the columns are missing: everyone has the default.
    if (missingColumn(error)) return { refused: false, senderOff: false };
    throw error;
  }
  const recipient = parseMessageFrom(row?.recipient) ?? DEFAULT_MESSAGE_FROM;
  const sender = parseMessageFrom(row?.sender) ?? DEFAULT_MESSAGE_FROM;
  const refused = recipient === "none" || (recipient === "conversations" && !row?.talking);
  return { refused, senderOff: sender === "none" };
}

/**
 * Remember, for good, that this member has written in this conversation. The
 * first send sets it; it is never cleared, so it outlasts message expiry.
 */
export async function markWrote(
  db: Pick<Db, "query">,
  threadId: string,
  userId: string,
  now: Date,
): Promise<void> {
  await db.query(
    `update dm_thread
        set user_a_wrote_at = case when user_a = $2 then coalesce(user_a_wrote_at, $3) else user_a_wrote_at end,
            user_b_wrote_at = case when user_b = $2 then coalesce(user_b_wrote_at, $3) else user_b_wrote_at end
      where id = $1`,
    [threadId, userId, now],
  );
}
