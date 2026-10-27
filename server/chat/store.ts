import { randomUUID } from "node:crypto";
import { isEnglish, isHardRule, permanentOnFirst } from "../../src/lib/board/text.ts";
import { ROOM_ID } from "../../src/lib/media/limits.ts";
import { actorRole, moderationStop, stewardsRoom, type BoardActor } from "../board/access.ts";
import { guardRoomAudience } from "../board/audience.ts";
import { groupsApprovedFrom } from "../board/group-rooms.ts";
import { openBan, writeBan, type BanEntry, type RemovalEntry } from "../board/store.ts";
import { evictCallMember } from "../calls/evict.ts";
import type { Db } from "../db.ts";
import { CHAT_UNAVAILABLE, roomChatReady } from "./ready.ts";

const PAGE = 50;
const HIDDEN_CAP = 500;
const BODY_MAX = 2000;

export type ChatMessage = {
  id: string;
  author: string;
  text: string;
  at: number;
  seq: number;
};

export type ChatPage = {
  messages: ChatMessage[];
  hidden: string[];
  older: number | null;
};

type Ok<T> = { ok: true; value: T };
type Err = {
  ok: false;
  status: number;
  error: string;
  ban?: { until: number; strikes: number; reason: BanEntry["reason"] };
  code?: string;
};
export type ChatResult<T> = Ok<T> | Err;

function fail(status: number, error: string): Err {
  return { ok: false, status, error };
}

function atMs(value: Date | string | number): number {
  if (typeof value === "number") return value;
  return new Date(value).getTime();
}

function seqOf(value: unknown): number {
  const seq = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(seq) || seq < 1) return 0;
  return seq;
}

/**
 * Session membership, checked on every read and every send.
 * This does not write room_member. A missing row, or an open ban, refuses.
 */
export async function requireRoomMember(
  db: Db,
  userId: string,
  roomId: string,
  now: Date,
  access: { moderate?: boolean; record?: boolean; detail?: string } = {},
): Promise<ChatResult<BoardActor>> {
  if (!ROOM_ID.test(roomId)) return fail(400, "That room is not here.");
  const actor = await actorRole(db, userId);
  if (!actor.member) return fail(403, "Only a member can read this room.");
  const ban = await openBan(db, userId, now, roomId);
  if (ban) return { ok: false, status: 403, error: "banned", ban };
  const rooms = await db.query<{ id: string }>(`select id from room where id = $1 and name <> ''`, [
    roomId,
  ]);
  if (!rooms[0]) return fail(404, "That room is not here.");
  const members = await db.query<{ user_id: string }>(
    `select user_id from room_member where room_id = $1 and user_id = $2`,
    [roomId, userId],
  );
  if (!members[0]) return fail(403, "You are not in this room.");
  const gate = await guardRoomAudience(db, {
    userId,
    roomId,
    now,
    path: "chat",
    moderate: access.moderate === true,
    record: access.record === true,
    detail: access.detail ?? "",
    actor,
  });
  if (!gate.ok) {
    return {
      ok: false,
      status: gate.status,
      error: gate.error,
      ...(gate.code ? { code: gate.code } : {}),
    };
  }
  return { ok: true, value: actor };
}

type MessageRow = {
  id: string;
  author_name: string;
  body: string;
  seq: unknown;
  created_at: Date | string;
};

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    author: row.author_name,
    text: row.body,
    at: atMs(row.created_at),
    seq: seqOf(row.seq),
  };
}

function orderMessages(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => a.at - b.at || a.seq - b.seq || (a.id < b.id ? -1 : 1));
}

export function chatText(value: string): { ok: true; text: string } | { ok: false; error: string } {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return { ok: false, error: "Write a message." };
  if (text.length > BODY_MAX)
    return { ok: false, error: "Keep the message under 2,000 characters." };
  if (!isEnglish(text) || !/\p{Script=Latin}/u.test(text)) {
    return { ok: false, error: "Write the message in English." };
  }
  return { ok: true, text };
}

async function chatAvailable(db: Db): Promise<Err | null> {
  if (await roomChatReady(db)) return null;
  return fail(503, CHAT_UNAVAILABLE);
}

export async function listChat(
  db: Db,
  input: {
    userId: string;
    roomId: string;
    now: Date;
    after?: number | null;
    before?: number | null;
  },
): Promise<ChatResult<ChatPage>> {
  const unavailable = await chatAvailable(db);
  if (unavailable) return unavailable;
  const gate = await requireRoomMember(db, input.userId, input.roomId, input.now, {
    moderate: true,
    detail: "list",
  });
  if (!gate.ok) return gate;
  const after = input.after ?? null;
  const before = input.before ?? null;
  if (after != null && before != null)
    return fail(400, "Ask for newer lines or older lines, not both.");
  if (after != null && (!Number.isSafeInteger(after) || after < 0))
    return fail(400, "That page is not valid.");
  if (before != null && (!Number.isSafeInteger(before) || before < 1))
    return fail(400, "That page is not valid.");

  const rows =
    after != null
      ? await db.query<MessageRow>(
          `select id, author_name, body, seq, created_at
           from room_chat_message
           where room_id = $1 and removed = false and seq > $2
           order by created_at asc, seq asc
           limit $3`,
          [input.roomId, after, PAGE],
        )
      : await db.query<MessageRow>(
          `select id, author_name, body, seq, created_at from (
             select id, author_name, body, seq, created_at
             from room_chat_message
             where room_id = $1 and removed = false
               and ($2::bigint is null or seq < $2::bigint)
             order by seq desc
             limit $3
           ) page
           order by created_at asc, seq asc`,
          [input.roomId, before, PAGE],
        );
  const messages = orderMessages(rows.map(toMessage));
  const hiddenRows = await db.query<{ id: string }>(
    `select id from room_chat_message
     where room_id = $1 and removed = true
     order by seq desc
     limit $2`,
    [input.roomId, HIDDEN_CAP],
  );
  let older: number | null = null;
  const first = messages[0];
  if (after == null && first) {
    const more = await db.query<{ seq: unknown }>(
      `select seq from room_chat_message
       where room_id = $1 and removed = false and seq < $2
       limit 1`,
      [input.roomId, first.seq],
    );
    older = more[0] ? first.seq : null;
  }
  return {
    ok: true,
    value: {
      messages,
      hidden: hiddenRows.map((row) => row.id),
      older,
    },
  };
}

export async function sendChat(
  db: Db,
  input: { userId: string; name: string; roomId: string; text: string; now: Date },
): Promise<ChatResult<ChatMessage>> {
  const unavailable = await chatAvailable(db);
  if (unavailable) return unavailable;
  const gate = await requireRoomMember(db, input.userId, input.roomId, input.now, {
    detail: "send",
  });
  if (!gate.ok) return gate;
  const body = chatText(input.text);
  if (!body.ok) return fail(400, body.error);
  const author = input.name.trim().slice(0, 80) || "Member";
  const id = randomUUID();
  const row = await db.transaction(async (tx) => {
    await tx.query(`select pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [input.roomId]);
    const saved = await tx.query<MessageRow>(
      `insert into room_chat_message (id, room_id, author_user_id, author_name, body, created_at)
       values (
         $2, $1, $3, $4, $5,
         greatest(
           $6::timestamptz,
           coalesce((select max(created_at) from room_chat_message where room_id = $1), $6::timestamptz)
         )
       )
       returning id, author_name, body, seq, created_at`,
      [input.roomId, id, input.userId, author, body.text, input.now],
    );
    return saved[0];
  });
  if (!row) return fail(500, "That message was not saved.");
  return { ok: true, value: toMessage(row) };
}

export async function removeChatMessage(
  db: Db,
  input: {
    userId: string;
    name: string;
    roomId: string;
    messageId: string;
    reason: string;
    now: Date;
  },
): Promise<ChatResult<{ removal: RemovalEntry; ban: BanEntry | null }>> {
  const unavailable = await chatAvailable(db);
  if (unavailable) return unavailable;
  const gate = await requireRoomMember(db, input.userId, input.roomId, input.now, {
    moderate: true,
    record: true,
    detail: "remove",
  });
  if (!gate.ok) return gate;
  if (!stewardsRoom(gate.value, input.roomId)) {
    return fail(
      403,
      gate.value.stewardRooms.length > 0
        ? "A steward can remove a message only in a room they steward."
        : "Only a steward can remove a message.",
    );
  }
  if (!isHardRule(input.reason)) {
    return fail(
      400,
      "Name the rule: threat, pornography, child sexual abuse material, doxxing, or mocking God or Christ.",
    );
  }
  const reason = input.reason;
  const existing = await db.query<{
    id: string;
    author_user_id: string | null;
    author_name: string;
    removed: boolean;
  }>(
    `select id, author_user_id, author_name, removed
     from room_chat_message where id = $1 and room_id = $2`,
    [input.messageId, input.roomId],
  );
  const message = existing[0];
  if (!message || message.removed) return fail(404, "That message is not here.");
  if (message.author_user_id) {
    const target = await actorRole(db, message.author_user_id);
    const blocked = moderationStop(gate.value, target);
    if (blocked) return fail(403, blocked);
  }
  const by = input.name.trim().slice(0, 80) || "Steward";
  const removalId = randomUUID();
  const saved = await db.transaction(async (tx) => {
    const updated = await tx.query<{ id: string }>(
      `update room_chat_message set removed = true, removed_at = $2
       where id = $1 and removed = false
       returning id`,
      [message.id, input.now],
    );
    if (!updated[0]) return null;
    await tx.query(
      `insert into room_chat_removal
       (id, message_id, room_id, author_user_id, author_name, by_user_id, by_name, reason, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        removalId,
        message.id,
        input.roomId,
        message.author_user_id,
        message.author_name,
        input.userId,
        by,
        reason,
        input.now,
      ],
    );
    if (!message.author_user_id) return { ban: null, siteWide: false };
    const siteWide = gate.value.admin || permanentOnFirst(reason);
    const ban = await writeBan(tx, {
      userId: message.author_user_id,
      name: message.author_name,
      reason,
      byUserId: input.userId,
      byName: by,
      removalId: null,
      removalAlreadyCounted: true,
      now: input.now,
      roomId: siteWide ? "" : input.roomId,
    });
    return { ban, siteWide };
  });
  if (!saved) return fail(404, "That message is not here.");
  if (message.author_user_id) {
    if (saved.siteWide) evictCallMember(message.author_user_id);
    else
      evictCallMember(message.author_user_id, [
        input.roomId,
        ...(await groupsApprovedFrom(db, input.roomId)),
      ]);
  }
  console.log(JSON.stringify({ event: "chat-removed", messageId: message.id, reason }));
  return {
    ok: true,
    value: {
      removal: {
        id: removalId,
        postId: message.id,
        author: message.author_name,
        reason,
        at: input.now.getTime(),
        roomChat: true,
      },
      ban: saved.ban,
    },
  };
}
