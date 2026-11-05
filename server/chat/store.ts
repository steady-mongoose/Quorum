import { randomUUID } from "node:crypto";
import { autoCloseReports } from "../board/report-close.ts";
import { isEnglish, isHardRule } from "../../src/lib/board/text.ts";
import { ROOM_ID } from "../../src/lib/media/limits.ts";
import {
  actorRole,
  actorRoles,
  moderationStop,
  stewardsRoom,
  type BoardActor,
} from "../board/access.ts";
import { canReadRoom, listingColumnsReady, readRoomListing } from "../board/room-visibility.ts";
import { guardRoomAudience } from "../board/audience.ts";
import { groupsApprovedFrom } from "../board/group-rooms.ts";
import { openBan, writeBan, type BanEntry, type RemovalEntry } from "../board/store.ts";
import { banOpen } from "../board/ban.ts";
import { queryBanTable } from "../board/ban-check.ts";
import { GENDER_POLICY, audienceDecision, parseAudience, parseGender } from "../gender-policy.ts";
import { evictCallMember } from "../calls/evict.ts";
import { ROOM_OPTION_OFF, roomHas } from "../board/room-options.ts";
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
 * This does not write room_member. A join (room_join) or a room_member row lets
 * the member in; neither row, or an open ban, refuses.
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
  const listed = await readRoomListing(db, roomId);
  if (!listed || !listed.name || !canReadRoom(listed.status, actor)) {
    return fail(400, "That room is not here.");
  }
  const ban = await openBan(db, userId, now, roomId);
  if (ban) return { ok: false, status: 403, error: "banned", ban };
  // Joining (room_join) lets a member in, as does having stood in the room (room_member).
  const members = await db.query<{ user_id: string }>(
    `select user_id from room_member where room_id = $1 and user_id = $2
     union all
     select user_id from room_join where room_id = $1 and user_id = $2
     limit 1`,
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

/** Key for one person in one room in the map roomStandings returns. */
export function standingKey(userId: string, roomId: string): string {
  return `${userId}\u0000${roomId}`;
}

/**
 * requireRoomMember(db, user, room, now).ok for every pair of these people and
 * rooms, in a constant number of queries, for lists. A pair is in `standing`
 * exactly when requireRoomMember would let that person in with no moderate
 * pass. `actors` holds actorRole for each person.
 */
export async function roomStandings(
  db: Db,
  userIds: string[],
  roomIds: string[],
  now: Date,
): Promise<{ standing: Set<string>; actors: Map<string, BoardActor> }> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const rooms = [...new Set(roomIds)].filter((roomId) => ROOM_ID.test(roomId));
  const actors = await actorRoles(db, ids);
  const standing = new Set<string>();
  const members = ids.filter((id) => actors.get(id)?.member);
  if (members.length === 0 || rooms.length === 0) return { standing, actors };

  const ready = await listingColumnsReady(db);
  const listings = await db.query<{ id: string; name: string; status?: string }>(
    ready
      ? `select id, name, status from room where id = any ($1::text[])`
      : `select id, name from room where id = any ($1::text[])`,
    [rooms],
  );
  const listed = new Map(
    listings.map((row) => [row.id, { name: row.name, status: row.status ?? "active" }]),
  );
  const audiences = await db.query<{ id: string; audience: string }>(
    `select id, audience from room where name <> '' and id = any ($1::text[])`,
    [rooms],
  );
  const audienceOf = new Map(
    audiences.map((row) => [row.id, parseAudience(row.audience) ?? "all"]),
  );

  const bans = await queryBanTable<{
    user_id: string;
    room_id: string;
    strikes: number;
    until_at: Date | string;
    reason: string;
  }>(
    db,
    `select user_id, room_id, strikes, until_at, reason from board_ban
     where user_id = any ($1::text[]) and (room_id = '' or room_id = any ($2::text[]))`,
    [members, rooms],
  );
  const barred = new Set<string>();
  for (const row of bans) {
    const open = banOpen(
      { reason: row.reason, strikes: Number(row.strikes), until: atMs(row.until_at) },
      now.getTime(),
    );
    if (open) barred.add(standingKey(row.user_id, row.room_id));
  }

  const rows = await db.query<{ user_id: string; room_id: string }>(
    `select user_id, room_id from room_member
     where user_id = any ($1::text[]) and room_id = any ($2::text[])
     union
     select user_id, room_id from room_join
     where user_id = any ($1::text[]) and room_id = any ($2::text[])`,
    [members, rooms],
  );
  const inRoom = new Set(rows.map((row) => standingKey(row.user_id, row.room_id)));

  const restricted = rooms.some((roomId) => (audienceOf.get(roomId) ?? "all") !== "all");
  const genders = new Map<string, { stated: ReturnType<typeof parseGender>; confirmed: boolean }>();
  if (restricted) {
    const stated = await db.query<{
      user_id: string;
      gender: string | null;
      gender_confirmed_at: Date | string | null;
    }>(
      `select user_id, gender, gender_confirmed_at from members where user_id = any ($1::text[])`,
      [members],
    );
    for (const row of stated) {
      if (genders.has(row.user_id)) continue;
      genders.set(row.user_id, {
        stated: parseGender(row.gender),
        confirmed: Boolean(row.gender_confirmed_at),
      });
    }
  }

  for (const userId of members) {
    const actor = actors.get(userId);
    if (!actor) continue;
    for (const roomId of rooms) {
      const room = listed.get(roomId);
      if (!room || !room.name || !canReadRoom(room.status, actor)) continue;
      if (barred.has(standingKey(userId, "")) || barred.has(standingKey(userId, roomId))) continue;
      if (!inRoom.has(standingKey(userId, roomId))) continue;
      const audience = audienceOf.get(roomId);
      if (audience && audience !== "all") {
        const gender = genders.get(userId) ?? { stated: null, confirmed: false };
        const decision = audienceDecision(
          { audience, stated: gender.stated, confirmed: gender.confirmed, canModerate: false },
          GENDER_POLICY,
        );
        if (!decision.allow) continue;
      }
      standing.add(standingKey(userId, roomId));
    }
  }
  return { standing, actors };
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
  if (!(await roomHas(db, input.roomId, "chat"))) return fail(404, ROOM_OPTION_OFF.chat);
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
  if (!(await roomHas(db, input.roomId, "chat"))) return fail(404, ROOM_OPTION_OFF.chat);
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
    await autoCloseReports(tx, {
      subjectKind: "chat",
      subjectIds: [message.id],
      actorUserId: input.userId,
      now: input.now,
    });
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
    const ban = await writeBan(tx, {
      userId: message.author_user_id,
      name: message.author_name,
      reason,
      byUserId: input.userId,
      byName: by,
      removalId: null,
      removalAlreadyCounted: true,
      now: input.now,
      roomId: gate.value.admin || reason === "csam" ? "" : input.roomId,
    });
    return { ban, siteWide: ban.siteWide };
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
