import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import { isUniqueViolation } from "../db.ts";
import { OBJECT_ID, ROOM_ID } from "../../src/lib/media/limits.ts";
import { isEnglish } from "../../src/lib/board/text.ts";
import { actorRole } from "./access.ts";
import { contentStops, replyStops, sentenceOrStop, type RoomRules } from "./check.ts";
import { orderPosts } from "./order.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const BAN_MS = 30 * DAY_MS;
const CLOSED_MS = 100 * 365 * DAY_MS;
const HARD = new Set(["threat", "porn", "csam"]);

export type BoardPost = {
  id: string;
  room: string;
  type: string;
  claim: string;
  reason: string;
  on: string;
  next: string;
  came: string[];
  named: string;
  author: string;
  at: number;
  parentId: string | null;
  closed: boolean;
  mark: "sloppy" | "unsupported" | null;
  removed: boolean;
  cardId?: string;
  tradeId?: string;
  campaignId?: string;
  media: { id: string; kind: "image" | "video" }[];
};

export type BoardRoom = {
  id: string;
  name: string;
  what: string;
  takes: string[];
  stewardTakes: string[];
  cardKinds: string[];
  cardNoun: "Meeting" | "Service" | "Reading" | "Debate";
  requiresNextDate: boolean;
  parish: boolean;
};

export type MarkEntry = {
  id: string;
  room: string;
  postId: string;
  author: string;
  by: string;
  mark: "sloppy" | "unsupported" | null;
  reason: string;
  at: number;
};

export type RemovalEntry = {
  id: string;
  postId: string;
  author: string;
  reason: "threat" | "porn" | "csam";
  at: number;
};

export type BanEntry = {
  id: string;
  author: string;
  reason: "threat" | "porn" | "csam";
  until: number;
  strikes: number;
  at: number;
};

export type BoardPayload = {
  me: {
    member: boolean;
    steward: boolean;
    admin: boolean;
    ban: { until: number; strikes: number; reason: "threat" | "porn" | "csam" } | null;
  };
  rooms: BoardRoom[];
  posts: BoardPost[];
  marks: MarkEntry[];
  removals: RemovalEntry[];
  bans: BanEntry[];
};

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; status: number; error: string; stops?: string[] };
export type Result<T> = Ok<T> | Err;

function fail(status: number, error: string, stops?: string[]): Err {
  return stops ? { ok: false, status, error, stops } : { ok: false, status, error };
}

class Stop extends Error {
  status: number;
  stops?: string[];
  constructor(status: number, message: string, stops?: string[]) {
    super(message);
    this.status = status;
    this.stops = stops;
  }
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || !value.startsWith("{")) return [];
  const inner = value.slice(1, -1);
  if (!inner) return [];
  return inner.split(",").map((item) => item.replace(/^"|"$/g, "").replace(/\\"/g, '"'));
}

function atMs(value: Date | string | number): number {
  if (typeof value === "number") return value;
  return new Date(value).getTime();
}

function noun(value: string): BoardRoom["cardNoun"] {
  if (value === "Service" || value === "Reading" || value === "Debate" || value === "Meeting")
    return value;
  return "Meeting";
}

type RoomRow = {
  id: string;
  name: string;
  what: string;
  takes: unknown;
  steward_takes: unknown;
  card_kinds: unknown;
  card_noun: string;
  requires_next_date: boolean;
  parish: boolean;
};

function toRoom(row: RoomRow): BoardRoom {
  return {
    id: row.id,
    name: row.name,
    what: row.what,
    takes: textList(row.takes),
    stewardTakes: textList(row.steward_takes),
    cardKinds: textList(row.card_kinds),
    cardNoun: noun(row.card_noun),
    requiresNextDate: Boolean(row.requires_next_date),
    parish: Boolean(row.parish),
  };
}

function rulesOf(room: BoardRoom): RoomRules {
  return { name: room.name, takes: room.takes, stewardTakes: room.stewardTakes };
}

type PostRow = {
  id: string;
  room_id: string;
  author_name: string;
  type: string;
  claim: string;
  reason: string;
  on_date: string;
  next_date: string;
  came: unknown;
  named: string;
  parent_id: string | null;
  closed: boolean;
  mark: string | null;
  removed: boolean;
  card_id: string;
  trade_id: string;
  campaign_id: string;
  created_at: Date | string;
};

function toPost(row: PostRow, media: BoardPost["media"] = []): BoardPost {
  const mark = row.mark === "sloppy" || row.mark === "unsupported" ? row.mark : null;
  return {
    id: row.id,
    room: row.room_id,
    type: row.type,
    claim: row.claim,
    reason: row.reason,
    on: row.on_date,
    next: row.next_date,
    came: textList(row.came),
    named: row.named,
    author: row.author_name,
    at: atMs(row.created_at),
    parentId: row.parent_id,
    closed: Boolean(row.closed),
    mark,
    removed: Boolean(row.removed),
    ...(row.card_id ? { cardId: row.card_id } : {}),
    ...(row.trade_id ? { tradeId: row.trade_id } : {}),
    ...(row.campaign_id ? { campaignId: row.campaign_id } : {}),
    media,
  };
}

async function roomById(db: Db, id: string): Promise<BoardRoom | null> {
  if (!ROOM_ID.test(id)) return null;
  const rows = await db.query<RoomRow>(
    `select id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish
     from room where id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row || !row.name) return null;
  return toRoom(row);
}

async function openBan(
  db: Db,
  userId: string,
  now: Date,
): Promise<{ until: number; strikes: number; reason: BanEntry["reason"] } | null> {
  const rows = await db.query<{ strikes: number; until_at: Date | string; reason: string }>(
    `select strikes, until_at, reason from board_ban where user_id = $1 order by created_at desc limit 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  const strikes = Number(row.strikes);
  const until = atMs(row.until_at);
  const reason = row.reason === "porn" || row.reason === "csam" ? row.reason : "threat";
  if (strikes < 2 && until <= now.getTime()) return null;
  return { until, strikes, reason };
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!name || name.length > 80 || !isEnglish(name) || out.includes(name)) continue;
    out.push(name);
    if (out.length === 40) break;
  }
  return out;
}

function field(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

async function mediaFor(db: Db, postIds: string[]): Promise<Map<string, BoardPost["media"]>> {
  const map = new Map<string, BoardPost["media"]>();
  if (postIds.length === 0) return map;
  const slots = postIds.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await db.query<{ id: string; kind: string; post_id: string }>(
    `select id, kind, post_id from media_object
     where scope = 'room' and deleted_at is null and status = 'ready' and post_id in (${slots})`,
    postIds,
  );
  for (const row of rows) {
    if (row.kind !== "image" && row.kind !== "video") continue;
    const list = map.get(row.post_id) ?? [];
    list.push({ id: row.id, kind: row.kind });
    map.set(row.post_id, list);
  }
  return map;
}

async function standInRoom(db: Db, userId: string, roomId: string): Promise<void> {
  await db.query(
    `insert into room_member (room_id, user_id) values ($1, $2) on conflict do nothing`,
    [roomId, userId],
  );
}

export async function listBoard(db: Db, userId: string, now: Date): Promise<Result<BoardPayload>> {
  const actor = await actorRole(db, userId);
  if (!actor.member) return fail(403, "Only a member can read the board.");
  const roomRows = await db.query<RoomRow>(
    `select id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish
     from room where name <> '' order by sort_order asc, name asc`,
  );
  const rooms = roomRows.map(toRoom);
  for (const room of rooms) await standInRoom(db, userId, room.id);
  const postRows = await db.query<PostRow>(
    `select id, room_id, author_name, type, claim, reason, on_date, next_date, came, named,
            parent_id, closed, mark, removed, card_id, trade_id, campaign_id, created_at
     from board_post where removed = false order by created_at desc limit 2000`,
  );
  const pictures = await mediaFor(
    db,
    postRows.map((row) => row.id),
  );
  const posts = orderPosts(postRows.map((row) => toPost(row, pictures.get(row.id) ?? [])));
  const markRows = await db.query<{
    id: string;
    room_id: string;
    post_id: string;
    author_name: string;
    by_name: string;
    mark: string | null;
    reason: string;
    created_at: Date | string;
  }>(
    `select id, room_id, post_id, author_name, by_name, mark, reason, created_at
     from board_mark order by created_at desc limit 200`,
  );
  const removalRows = await db.query<{
    id: string;
    post_id: string;
    author_name: string;
    reason: string;
    created_at: Date | string;
  }>(
    `select id, post_id, author_name, reason, created_at from board_removal order by created_at desc limit 500`,
  );
  const banRows = await db.query<{
    id: string;
    name: string;
    reason: string;
    strikes: number;
    until_at: Date | string;
    created_at: Date | string;
  }>(
    `select id, name, reason, strikes, until_at, created_at from board_ban order by created_at desc limit 500`,
  );
  const ban = await openBan(db, userId, now);
  return {
    ok: true,
    value: {
      me: { member: true, steward: actor.steward, admin: actor.admin, ban },
      rooms,
      posts,
      marks: markRows.map((row) => ({
        id: row.id,
        room: row.room_id,
        postId: row.post_id,
        author: row.author_name,
        by: row.by_name,
        mark: row.mark === "sloppy" || row.mark === "unsupported" ? row.mark : null,
        reason: row.reason,
        at: atMs(row.created_at),
      })),
      removals: removalRows.map((row) => ({
        id: row.id,
        postId: row.post_id,
        author: row.author_name,
        reason: row.reason === "porn" || row.reason === "csam" ? row.reason : "threat",
        at: atMs(row.created_at),
      })),
      bans: banRows.map((row) => ({
        id: row.id,
        author: row.name,
        reason: row.reason === "porn" || row.reason === "csam" ? row.reason : "threat",
        until: atMs(row.until_at),
        strikes: Number(row.strikes),
        at: atMs(row.created_at),
      })),
    },
  };
}

async function writeBan(
  tx: Db,
  input: {
    userId: string;
    name: string;
    reason: BanEntry["reason"];
    byUserId: string;
    byName: string;
    removalId: string | null;
    now: Date;
  },
): Promise<BanEntry> {
  const prior = await tx.query<{ strikes: number }>(
    `select strikes from board_ban where user_id = $1 order by created_at desc limit 1`,
    [input.userId],
  );
  const removals = await tx.query<{ id: string }>(
    `select id from board_removal where author_user_id = $1`,
    [input.userId],
  );
  const counted = Math.max(Number(prior[0]?.strikes ?? 0), removals.length);
  const strikes = input.removalId ? Math.max(counted, 1) : counted + 1;
  const until = new Date(input.now.getTime() + (strikes >= 2 ? CLOSED_MS : BAN_MS));
  const id = randomUUID();
  await tx.query(
    `insert into board_ban
     (id, user_id, name, reason, by_user_id, by_name, strikes, until_at, removal_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      input.userId,
      input.name,
      input.reason,
      input.byUserId,
      input.byName,
      strikes,
      until,
      input.removalId,
      input.now,
    ],
  );
  console.log(
    JSON.stringify({ event: "member-banned", userId: input.userId, reason: input.reason, strikes }),
  );
  return {
    id,
    author: input.name,
    reason: input.reason,
    until: until.getTime(),
    strikes,
    at: input.now.getTime(),
  };
}

export async function createPost(
  db: Db,
  input: {
    userId: string;
    name: string;
    roomId: string;
    body: Record<string, unknown>;
    now: Date;
  },
): Promise<Result<BoardPost>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can post.");
  const ban = await openBan(db, input.userId, input.now);
  if (ban) return fail(403, "This account cannot post right now.");
  const room = await roomById(db, input.roomId);
  if (!room) return fail(400, "Choose a room.");
  const type = field(input.body, "type").trim();
  const claim = field(input.body, "claim");
  const reason = field(input.body, "reason");
  const on = field(input.body, "on").trim();
  const next = field(input.body, "next").trim();
  const came = names(input.body.came);
  const named = field(input.body, "named").trim();
  const requestedId = field(input.body, "id").trim();
  if (requestedId && !OBJECT_ID.test(requestedId)) return fail(400, "That post id is not valid.");
  const cardId = field(input.body, "cardId").trim();
  const tradeId = field(input.body, "tradeId").trim();
  const campaignId = field(input.body, "campaignId").trim().slice(0, 80);
  if (cardId && !OBJECT_ID.test(cardId)) return fail(400, "That card is not valid.");
  if (tradeId && !OBJECT_ID.test(tradeId)) return fail(400, "That card is not valid.");
  const mediaCount = typeof input.body.mediaCount === "number" ? input.body.mediaCount : 0;
  const stops = contentStops({
    type,
    claim,
    reason,
    on,
    next,
    came,
    named,
    author: input.name.trim() || "Member",
    attested: input.body.attested === true,
    mediaCount,
    steward: actor.steward,
    room: rulesOf(room),
  });
  if (stops.length > 0) return fail(400, stops[0] ?? "That post was not filed.", stops);
  const id = requestedId || randomUUID();
  const author = input.name.trim() || "Member";
  try {
    const row = await db.transaction(async (tx) => {
      await standInRoom(tx, input.userId, room.id);
      const reserved = await tx.query<{ room_id: string; author_user_id: string }>(
        `select room_id, author_user_id from room_post where id = $1`,
        [id],
      );
      const holder = reserved[0];
      if (holder && (holder.room_id !== room.id || holder.author_user_id !== input.userId)) {
        throw new Stop(404, "That post is not here.");
      }
      if (!holder) {
        await tx.query(`insert into room_post (id, room_id, author_user_id) values ($1, $2, $3)`, [
          id,
          room.id,
          input.userId,
        ]);
      }
      const inserted = await tx.query<PostRow>(
        `insert into board_post
         (id, room_id, author_user_id, author_name, type, claim, reason, on_date, next_date, came, named,
          card_id, trade_id, campaign_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         returning id, room_id, author_name, type, claim, reason, on_date, next_date, came, named,
                   parent_id, closed, mark, removed, card_id, trade_id, campaign_id, created_at`,
        [
          id,
          room.id,
          input.userId,
          author,
          type,
          claim.trim(),
          reason.trim(),
          on,
          next,
          came,
          named,
          cardId,
          tradeId,
          campaignId,
          input.now,
        ],
      );
      const saved = inserted[0];
      if (!saved) throw new Stop(500, "The post was not filed.");
      return saved;
    });
    return { ok: true, value: toPost(row) };
  } catch (error) {
    if (error instanceof Stop) return fail(error.status, error.message, error.stops);
    if (isUniqueViolation(error)) return fail(409, "That post was already filed.");
    throw error;
  }
}

export async function replyToPost(
  db: Db,
  input: { userId: string; name: string; postId: string; claim: string; now: Date },
): Promise<Result<BoardPost>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can post.");
  if (await openBan(db, input.userId, input.now))
    return fail(403, "This account cannot post right now.");
  const stops = replyStops(input.claim);
  if (stops.length > 0) return fail(400, stops[0] ?? "That reply was not filed.", stops);
  const parents = await db.query<{
    id: string;
    room_id: string;
    type: string;
    parent_id: string | null;
    removed: boolean;
  }>(`select id, room_id, type, parent_id, removed from board_post where id = $1`, [input.postId]);
  const parent = parents[0];
  if (!parent || parent.removed || parent.parent_id) return fail(404, "That post is not here.");
  const id = randomUUID();
  const author = input.name.trim() || "Member";
  const inserted = await db.query<PostRow>(
    `insert into board_post
     (id, room_id, author_user_id, author_name, type, claim, parent_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, room_id, author_name, type, claim, reason, on_date, next_date, came, named,
               parent_id, closed, mark, removed, card_id, trade_id, campaign_id, created_at`,
    [
      id,
      parent.room_id,
      input.userId,
      author,
      parent.type,
      input.claim.trim(),
      parent.id,
      input.now,
    ],
  );
  const row = inserted[0];
  if (!row) return fail(500, "The reply was not filed.");
  await standInRoom(db, input.userId, parent.room_id);
  return { ok: true, value: toPost(row) };
}

export async function revisePost(
  db: Db,
  input: { userId: string; name: string; postId: string; claim: string; reason: string; now: Date },
): Promise<Result<{ post: BoardPost; mark: MarkEntry | null }>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can post.");
  const existing = await db.query<PostRow & { author_user_id: string }>(
    `select id, room_id, author_user_id, author_name, type, claim, reason, on_date, next_date, came, named,
            parent_id, closed, mark, removed, card_id, trade_id, campaign_id, created_at
     from board_post where id = $1`,
    [input.postId],
  );
  const post = existing[0];
  if (!post || post.removed) return fail(404, "That post is not here.");
  if (post.author_user_id !== input.userId) return fail(403, "Only the author can revise a post.");
  const room = await roomById(db, post.room_id);
  if (!room) return fail(404, "That post is not here.");
  const stops = contentStops({
    type: post.type,
    claim: input.claim,
    reason: input.reason,
    on: post.on_date,
    next: post.next_date,
    came: textList(post.came),
    named: post.named,
    author: post.author_name,
    attested: true,
    mediaCount: 0,
    steward: actor.steward,
    room: rulesOf(room),
  });
  if (stops.length > 0) return fail(400, stops[0] ?? "That revision was not saved.", stops);
  const updated = await db.query<PostRow>(
    `update board_post set claim = $2, reason = $3, mark = null where id = $1
     returning id, room_id, author_name, type, claim, reason, on_date, next_date, came, named,
               parent_id, closed, mark, removed, card_id, trade_id, campaign_id, created_at`,
    [post.id, input.claim.trim(), input.reason.trim()],
  );
  const saved = updated[0];
  if (!saved) return fail(404, "That post is not here.");
  let mark: MarkEntry | null = null;
  if (post.mark) {
    const sentence = "The author revised the post.";
    const id = randomUUID();
    await db.query(
      `insert into board_mark
       (id, post_id, room_id, author_user_id, author_name, by_user_id, by_name, mark, reason, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, null, $8, $9)`,
      [
        id,
        post.id,
        post.room_id,
        input.userId,
        post.author_name,
        input.userId,
        input.name.trim() || post.author_name,
        sentence,
        input.now,
      ],
    );
    mark = {
      id,
      room: post.room_id,
      postId: post.id,
      author: post.author_name,
      by: input.name.trim() || post.author_name,
      mark: null,
      reason: sentence,
      at: input.now.getTime(),
    };
  }
  return { ok: true, value: { post: toPost(saved), mark } };
}

export async function closeAsked(
  db: Db,
  input: { userId: string; postId: string },
): Promise<Result<BoardPost>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can post.");
  const updated = await db.query<PostRow>(
    `update board_post set closed = true
     where id = $1 and author_user_id = $2 and type = 'asked' and parent_id is null and removed = false
     returning id, room_id, author_name, type, claim, reason, on_date, next_date, came, named,
               parent_id, closed, mark, removed, card_id, trade_id, campaign_id, created_at`,
    [input.postId, input.userId],
  );
  const row = updated[0];
  if (!row) return fail(404, "That question is not here.");
  return { ok: true, value: toPost(row) };
}

export async function markPost(
  db: Db,
  input: { userId: string; name: string; postId: string; mark: unknown; reason: string; now: Date },
): Promise<Result<{ post: BoardPost; row: MarkEntry }>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.steward) return fail(403, "Only a steward can mark a post.");
  const sentence = sentenceOrStop(input.reason);
  if (!sentence.ok) return fail(400, sentence.error);
  const mark = input.mark === null || input.mark === "" ? null : input.mark;
  if (mark !== null && mark !== "sloppy" && mark !== "unsupported") {
    return fail(400, "A mark is sloppy or unsupported.");
  }
  const existing = await db.query<PostRow & { author_user_id: string }>(
    `select id, room_id, author_user_id, author_name, type, claim, reason, on_date, next_date, came, named,
            parent_id, closed, mark, removed, card_id, trade_id, campaign_id, created_at
     from board_post where id = $1 and removed = false`,
    [input.postId],
  );
  const post = existing[0];
  if (!post) return fail(404, "That post is not here.");
  const id = randomUUID();
  const by = input.name.trim() || "Steward";
  const saved = await db.transaction(async (tx) => {
    const updated = await tx.query<PostRow>(
      `update board_post set mark = $2 where id = $1 and removed = false
       returning id, room_id, author_name, type, claim, reason, on_date, next_date, came, named,
                 parent_id, closed, mark, removed, card_id, trade_id, campaign_id, created_at`,
      [post.id, mark],
    );
    await tx.query(
      `insert into board_mark
       (id, post_id, room_id, author_user_id, author_name, by_user_id, by_name, mark, reason, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        post.id,
        post.room_id,
        post.author_user_id,
        post.author_name,
        input.userId,
        by,
        mark,
        sentence.text,
        input.now,
      ],
    );
    return updated[0];
  });
  if (!saved) return fail(404, "That post is not here.");
  console.log(JSON.stringify({ event: "post-marked", postId: post.id, mark }));
  return {
    ok: true,
    value: {
      post: toPost(saved),
      row: {
        id,
        room: post.room_id,
        postId: post.id,
        author: post.author_name,
        by,
        mark,
        reason: sentence.text,
        at: input.now.getTime(),
      },
    },
  };
}

export async function removePost(
  db: Db,
  input: { userId: string; name: string; postId: string; reason: string; now: Date },
): Promise<Result<{ removal: RemovalEntry; ban: BanEntry }>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.steward) return fail(403, "Only a steward can remove a post.");
  if (!HARD.has(input.reason))
    return fail(400, "Name the rule: threat, pornography, or child sexual abuse material.");
  const reason = input.reason as BanEntry["reason"];
  const existing = await db.query<{
    id: string;
    author_user_id: string;
    author_name: string;
    removed: boolean;
  }>(`select id, author_user_id, author_name, removed from board_post where id = $1`, [
    input.postId,
  ]);
  const post = existing[0];
  if (!post || post.removed) return fail(404, "That post is not here.");
  const by = input.name.trim() || "Steward";
  const removalId = randomUUID();
  try {
    const ban = await db.transaction(async (tx) => {
      await tx.query(`update board_post set removed = true where id = $1 or parent_id = $1`, [
        post.id,
      ]);
      await tx.query(
        `insert into board_removal (id, post_id, author_user_id, author_name, by_user_id, by_name, reason, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          removalId,
          post.id,
          post.author_user_id,
          post.author_name,
          input.userId,
          by,
          reason,
          input.now,
        ],
      );
      return writeBan(tx, {
        userId: post.author_user_id,
        name: post.author_name,
        reason,
        byUserId: input.userId,
        byName: by,
        removalId,
        now: input.now,
      });
    });
    console.log(JSON.stringify({ event: "post-removed", postId: post.id, reason }));
    return {
      ok: true,
      value: {
        removal: {
          id: removalId,
          postId: post.id,
          author: post.author_name,
          reason,
          at: input.now.getTime(),
        },
        ban,
      },
    };
  } catch (error) {
    if (error instanceof Stop) return fail(error.status, error.message);
    throw error;
  }
}

export async function banMember(
  db: Db,
  input: { userId: string; name: string; email: string; reason: string; now: Date },
): Promise<Result<BanEntry>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.steward) return fail(403, "Only a steward can bar an account.");
  if (!HARD.has(input.reason))
    return fail(400, "Name the rule: threat, pornography, or child sexual abuse material.");
  const reason = input.reason as BanEntry["reason"];
  const email = input.email.trim().toLowerCase();
  if (!email) return fail(400, "Name the member.");
  const people = await db.query<{ id: string; name: string }>(
    `select id, name from "user" where lower(email) = $1`,
    [email],
  );
  const person = people[0];
  if (!person) return fail(404, "No member has that email.");
  const target = await actorRole(db, person.id);
  if (!target.member) return fail(400, "That person is not a member.");
  const ban = await writeBan(db, {
    userId: person.id,
    name: person.name,
    reason,
    byUserId: input.userId,
    byName: input.name.trim() || "Steward",
    removalId: null,
    now: input.now,
  });
  return { ok: true, value: ban };
}

export async function createRoom(
  db: Db,
  input: { userId: string; id: string; name: string; what: string; now: Date },
): Promise<Result<BoardRoom>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.admin) return fail(403, "Only an admin can add a room.");
  const id = input.id.trim().toLowerCase();
  const name = input.name.trim();
  const what = input.what.trim();
  if (!ROOM_ID.test(id)) return fail(400, "Use a short name of letters, numbers, and hyphens.");
  if (!name || name.length > 80 || !isEnglish(name)) return fail(400, "Name the room in English.");
  if (!what || what.length > 600 || !isEnglish(what))
    return fail(400, "Say what the room is for, in English.");
  const order = await db.query<{ next: number }>(
    `select coalesce(max(sort_order), 0) + 1 as next from room`,
  );
  try {
    await db.query(
      `insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order, created_by, created_at)
       values ($1, $2, $3, $4, $5, $6, 'Meeting', false, false, $7, $8, $9)`,
      [
        id,
        name,
        what,
        ["did", "asked", "hosted"],
        ["noted"],
        ["meeting"],
        Number(order[0]?.next ?? 100),
        input.userId,
        input.now,
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "That room already exists.");
    throw error;
  }
  const room = await roomById(db, id);
  if (!room) return fail(500, "The room was not added.");
  return { ok: true, value: room };
}

export async function setSteward(
  db: Db,
  input: { userId: string; name: string; email: string; action: string; note: string; now: Date },
): Promise<Result<{ action: "grant" | "revoke" }>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.admin) return fail(403, "Only an admin can appoint a steward.");
  if (input.action !== "grant" && input.action !== "revoke")
    return fail(400, "Grant or revoke the role.");
  const sentence = sentenceOrStop(input.note);
  if (!sentence.ok) return fail(400, sentence.error);
  const email = input.email.trim().toLowerCase();
  const people = await db.query<{ id: string; name: string }>(
    `select id, name from "user" where lower(email) = $1`,
    [email],
  );
  const person = people[0];
  if (!person) return fail(404, "No member has that email.");
  const target = await actorRole(db, person.id);
  if (!target.member) return fail(400, "That person is not a member.");
  const by = input.name.trim() || "Admin";
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, 'steward', '', $4, $5, $5, $5, $6, $7)`,
    [randomUUID(), person.id, person.name, input.action, by, sentence.text, input.now],
  );
  console.log(
    JSON.stringify({
      event: "access-changed",
      role: "steward",
      action: input.action,
      userId: person.id,
    }),
  );
  return { ok: true, value: { action: input.action } };
}
