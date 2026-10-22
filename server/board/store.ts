import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers";
import type { Db } from "../db.ts";
import { isUniqueViolation } from "../db.ts";
import { OBJECT_ID, ROOM_ID } from "../../src/lib/media/limits.ts";
import { isEnglish, isHardRule, isMarkValue, type MarkValue } from "../../src/lib/board/text.ts";
import { evictCallMember } from "../calls/evict.ts";
import { roomChatReady } from "../chat/ready.ts";
import { actorRole, councilFlags, moderationStop, stewardsRoom } from "./access.ts";
import { councilMarks, type CouncilMark } from "./places-store.ts";
import { contentStops, replyStops, sentenceOrStop, type RoomRules } from "./check.ts";
import { sendHoldAlert } from "./alert-mail.ts";
import {
  CSAM_QUEUE_SQL,
  dropObjectKeys,
  reportFromRow,
  sealCsamHold,
  type AdminAlert,
  type CsamReport,
  type HoldAlert,
} from "./csam.ts";
import type { ObjectStore } from "../media/s3.ts";
import { orderPosts } from "./order.ts";
import { queryBanTable } from "./ban-check.ts";
import { ruleId, type RuleId } from "./rule.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const BAN_MS = 30 * DAY_MS;
const CLOSED_MS = 100 * 365 * DAY_MS;

const RULE_ERROR =
  "Name the rule: threat, pornography, child sexual abuse material, doxxing, or mocking God or Christ.";
const MARK_ERROR = "A mark is sloppy, No legs, or out of scope.";

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
  mark: MarkValue | null;
  removed: boolean;
  cardId?: string;
  tradeId?: string;
  campaignId?: string;
  subject?: "candidate" | "business";
  council?: CouncilMark;
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
  scopeKind: "topic" | "town" | "congregation" | "region";
  townId: string;
  congregationId: string;
  regionId: string;
};

export type MarkEntry = {
  id: string;
  room: string;
  postId: string;
  author: string;
  by: string;
  mark: MarkValue | null;
  reason: string;
  at: number;
};

export type RemovalEntry = {
  id: string;
  postId: string;
  author: string;
  reason: RuleId;
  at: number;
  /** Set when the row is a room chat line. A post leaves this off. */
  roomChat?: boolean;
};

export type BanEntry = {
  id: string;
  author: string;
  reason: RuleId;
  until: number;
  strikes: number;
  at: number;
};

export type AppealEntry = {
  id: string;
  room: string;
  postId: string;
  author: string;
  kind: "mark" | "removal";
  reason: string;
  decision: "uphold" | "lift" | null;
  decisionNote: string;
  decidedBy: string;
  at: number;
  decidedAt: number | null;
  rule: RuleId | null;
};

export type RoomPage = { room: string; next: string | null };

export type BoardPayload = {
  me: {
    member: boolean;
    steward: boolean;
    admin: boolean;
    council: boolean;
    councilChair: boolean;
    /** Rooms with a live steward grant. An admin is not listed here. */
    stewardRooms: string[];
    ban: { until: number; strikes: number; reason: RuleId } | null;
  };
  rooms: BoardRoom[];
  posts: BoardPost[];
  marks: MarkEntry[];
  removals: RemovalEntry[];
  bans: BanEntry[];
  appeals: AppealEntry[];
  csamReports: CsamReport[];
  adminAlerts: AdminAlert[];
  /** One cursor per room. Null means that room has no older page. */
  pages: RoomPage[];
};

export type BoardPageQuery = { room?: string; cursor?: string; limit?: number };

const PAGE_DEFAULT = 40;
const PAGE_MAX = 100;

type Ok<T> = { ok: true; value: T };
type Err = {
  ok: false;
  status: number;
  error: string;
  stops?: string[];
  ban?: { until: number; strikes: number; reason: RuleId };
};
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
  scope_kind?: string;
  town_id?: string;
  congregation_id?: string;
  region_id?: string;
};

function scopeKind(value: string | undefined): BoardRoom["scopeKind"] {
  if (value === "town" || value === "congregation" || value === "region") return value;
  return "topic";
}

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
    scopeKind: scopeKind(row.scope_kind),
    townId: row.town_id ?? "",
    congregationId: row.congregation_id ?? "",
    regionId: row.region_id ?? "",
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
  subject?: string | null;
  created_at: Date | string;
};

function toPost(row: PostRow, media: BoardPost["media"] = []): BoardPost {
  const mark = isMarkValue(row.mark) ? row.mark : null;
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
    ...(row.subject === "candidate" || row.subject === "business" ? { subject: row.subject } : {}),
    media,
  };
}

async function withCouncil(db: Db, post: BoardPost): Promise<BoardPost> {
  const marks = await councilMarks(db, [post.id]);
  const council = marks.get(post.id);
  return council ? { ...post, council } : post;
}

async function roomById(db: Db, id: string): Promise<BoardRoom | null> {
  if (!ROOM_ID.test(id)) return null;
  const rows = await db.query<RoomRow>(
    `select id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish,
            scope_kind, town_id, congregation_id, region_id
     from room where id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row || !row.name) return null;
  return toRoom(row);
}

export type OpenBan = { until: number; strikes: number; reason: BanEntry["reason"] };

/**
 * An open bar that applies here.
 * An empty room id checks site-wide bars only. A room id also checks that room.
 * A newer expired bar does not hide an older one that is still in force.
 */
export async function openBan(
  db: Db,
  userId: string,
  now: Date,
  roomId = "",
): Promise<OpenBan | null> {
  const rows = await queryBanTable<{ strikes: number; until_at: Date | string; reason: string }>(
    db,
    `select strikes, until_at, reason
     from board_ban
     where user_id = $1 and (room_id = '' or room_id = $2)
     order by created_at desc`,
    [userId, roomId],
  );
  for (const row of rows) {
    const strikes = Number(row.strikes);
    const until = atMs(row.until_at);
    const reason = ruleId(row.reason);
    if (reason !== "csam" && strikes < 2 && until <= now.getTime()) continue;
    return { until, strikes, reason };
  }
  return null;
}

/**
 * The open ban, or none when this person has no bar in force.
 * A missing `board_ban` (migration 0008 not applied) is not "nobody is banned".
 * That check fails closed: it logs the missing table and throws
 * `BanCheckUnavailable` (HTTP 503).
 */
export async function openBanOrNone(
  db: Db,
  userId: string,
  now: Date,
  roomId = "",
): Promise<OpenBan | null> {
  return openBan(db, userId, now, roomId);
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

function encodeCursor(at: Date | string, id: string): string {
  return `${new Date(at).getTime()}~${id}`;
}

function decodeCursor(value: string): { at: Date; id: string } | null {
  const match = /^(\d{1,16})~([A-Za-z0-9_-]{1,80})$/.exec(value);
  if (!match?.[1] || !match[2]) return null;
  const at = Number(match[1]);
  if (!Number.isFinite(at)) return null;
  return { at: new Date(at), id: match[2] };
}

async function pagePosts(
  db: Db,
  roomId: string,
  cursor: { at: Date; id: string } | null,
  limit: number,
): Promise<{ rows: PostRow[]; next: string | null }> {
  const rows = await db.query<PostRow>(
    `select id, room_id, author_name, type, claim, reason, on_date, next_date, came, named,
            parent_id, closed, mark, removed, card_id, trade_id, campaign_id, subject, created_at
     from board_post
     where removed = false
       and room_id = $1
       and (
         $2::timestamptz is null
         or created_at < $2::timestamptz
         or (created_at = $2::timestamptz and id < $3)
       )
     order by created_at desc, id desc
     limit $4`,
    [roomId, cursor?.at ?? null, cursor?.id ?? "", limit + 1],
  );
  const extra = rows.length > limit;
  const kept = extra ? rows.slice(0, limit) : rows;
  const last = kept[kept.length - 1];
  return {
    rows: kept,
    next: extra && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

/** A post or a reply records that this member stood in that one room. A read does not. */
async function standInRoom(db: Db, userId: string, roomId: string): Promise<void> {
  await db.query(
    `insert into room_member (room_id, user_id) values ($1, $2) on conflict do nothing`,
    [roomId, userId],
  );
}

export async function listBoard(
  db: Db,
  userId: string,
  now: Date,
  query: BoardPageQuery = {},
): Promise<Result<BoardPayload>> {
  const actor = await actorRole(db, userId);
  if (!actor.member) return fail(403, "Only a member can read the board.");
  const ban = await openBan(db, userId, now);
  if (ban) return { ok: false, status: 403, error: "banned", ban };
  if (query.cursor && !query.room) return fail(400, "Name the room for that page.");
  if (query.room && !ROOM_ID.test(query.room)) return fail(400, "That room is not here.");
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) return fail(400, "That page is not valid.");
  const limit = Math.min(
    PAGE_MAX,
    Math.max(1, Math.floor(query.limit ?? PAGE_DEFAULT) || PAGE_DEFAULT),
  );
  const flags = await councilFlags(db, userId);
  const roomRows = await db.query<RoomRow>(
    `select id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish,
            scope_kind, town_id, congregation_id, region_id
     from room where name <> '' order by sort_order asc, name asc`,
  );
  const openRooms: BoardRoom[] = [];
  for (const room of roomRows.map(toRoom)) {
    const roomBan = await openBan(db, userId, now, room.id);
    if (!roomBan) {
      openRooms.push(room);
      continue;
    }
    if (query.room === room.id) return { ok: false, status: 403, error: "banned", ban: roomBan };
  }
  const rooms = openRooms;
  const targets = query.room ? rooms.filter((room) => room.id === query.room) : rooms;
  const postRows: PostRow[] = [];
  const pages: RoomPage[] = [];
  for (const room of targets) {
    const page = await pagePosts(db, room.id, query.room ? cursor : null, limit);
    postRows.push(...page.rows);
    pages.push({ room: room.id, next: page.next });
  }
  if (query.room && targets.length === 0) pages.push({ room: query.room, next: null });
  const pictures = await mediaFor(
    db,
    postRows.map((row) => row.id),
  );
  const ordered = orderPosts(postRows.map((row) => toPost(row, pictures.get(row.id) ?? [])));
  const councils = await councilMarks(
    db,
    ordered.map((post) => post.id),
  );
  const posts = ordered.map((post) => {
    const council = councils.get(post.id);
    return council ? { ...post, council } : post;
  });
  const postIds = postRows.map((row) => row.id);
  const markRows =
    postIds.length === 0
      ? []
      : await db.query<{
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
           from board_mark where post_id in (${postIds.map((_, index) => `$${index + 1}`).join(", ")})
           order by created_at desc`,
          postIds,
        );
  const removalRows = await db.query<{
    id: string;
    post_id: string;
    author_name: string;
    reason: string;
    created_at: Date | string;
    room_id: string;
    room_chat: boolean;
  }>(
    (await roomChatReady(db))
      ? `select id, post_id, author_name, reason, created_at, room_id, room_chat from (
           select r.id, r.post_id, r.author_name, r.reason, r.created_at, p.room_id, false as room_chat
           from board_removal r
           join board_post p on p.id = r.post_id
           union all
           select id, message_id, author_name, reason, created_at, room_id, true as room_chat
           from room_chat_removal
         ) logged
         order by created_at desc
         limit 500`
      : `select r.id, r.post_id, r.author_name, r.reason, r.created_at, p.room_id, false as room_chat
         from board_removal r
         join board_post p on p.id = r.post_id
         order by r.created_at desc
         limit 500`,
  );
  const banRows = await db.query<{
    id: string;
    name: string;
    reason: string;
    strikes: number;
    until_at: Date | string;
    created_at: Date | string;
    room_id: string;
  }>(
    `select id, name, reason, strikes, until_at, created_at, room_id
     from board_ban
     order by created_at desc
     limit 500`,
  );
  const appealRows = await db.query<{
    id: string;
    room_id: string;
    post_id: string;
    author_user_id: string | null;
    author_name: string;
    kind: string;
    reason: string;
    decision: string | null;
    decision_note: string;
    decided_by_name: string;
    created_at: Date | string;
    decided_at: Date | string | null;
    rule: string | null;
  }>(
    `select a.id, a.room_id, a.post_id, a.author_user_id, a.author_name, a.kind, a.reason, a.decision,
            a.decision_note, a.decided_by_name, a.created_at, a.decided_at, r.reason as rule
     from board_appeal a
     left join board_removal r on a.kind = 'removal' and r.id = a.target_id
     order by a.created_at desc
     limit 200`,
  );
  let csamReports: CsamReport[] = [];
  let adminAlerts: AdminAlert[] = [];
  if (actor.admin) {
    const reportRows = await db.query<{
      id: string;
      post_id: string;
      room_id: string;
      author_user_id: string | null;
      author_name: string;
      media_count: number;
      byte_size: number;
      media_types: unknown;
      created_at: Date | string;
      retain_until: Date | string;
      seal_status: string;
      filed_at: Date | string | null;
      report_id: string;
      filed_by_name: string;
    }>(CSAM_QUEUE_SQL);
    csamReports = reportRows.map(reportFromRow);
    const alertRows = await db.query<{
      id: string;
      kind: string;
      hold_id: string;
      created_at: Date | string;
    }>(
      `select id, kind, hold_id, created_at from board_admin_alert order by created_at desc limit 50`,
    );
    adminAlerts = alertRows.flatMap((row) => {
      if (row.kind !== "csam_hold" && row.kind !== "csam_pending_seal") return [];
      return [
        {
          id: row.id,
          kind: row.kind,
          holdId: row.hold_id,
          at: atMs(row.created_at),
        },
      ];
    });
  }
  const seesRoom = (roomId: string | null) =>
    actor.admin || (roomId !== null && roomId !== "" && actor.stewardRooms.includes(roomId));
  const visibleAppeals = appealRows.filter(
    (row) =>
      actor.admin || row.author_user_id === userId || actor.stewardRooms.includes(row.room_id),
  );
  return {
    ok: true,
    value: {
      me: {
        member: true,
        steward: actor.steward,
        admin: actor.admin,
        council: flags.council,
        councilChair: flags.chair,
        stewardRooms: actor.stewardRooms,
        ban: null,
      },
      rooms,
      posts,
      marks: markRows.map((row) => ({
        id: row.id,
        room: row.room_id,
        postId: row.post_id,
        author: row.author_name,
        by: row.by_name,
        mark: isMarkValue(row.mark) ? row.mark : null,
        reason: row.reason,
        at: atMs(row.created_at),
      })),
      removals: removalRows
        .filter((row) => seesRoom(row.room_id))
        .map((row) => ({
          id: row.id,
          postId: row.post_id,
          author: row.author_name,
          reason: ruleId(row.reason),
          at: atMs(row.created_at),
          ...(row.room_chat ? { roomChat: true } : {}),
        })),
      bans: banRows
        .filter((row) => seesRoom(row.room_id))
        .map((row) => ({
          id: row.id,
          author: row.name,
          reason: ruleId(row.reason),
          until: atMs(row.until_at),
          strikes: Number(row.strikes),
          at: atMs(row.created_at),
        })),
      appeals: visibleAppeals.map((row) => ({
        id: row.id,
        room: row.room_id,
        postId: row.post_id,
        author: row.author_name,
        kind: row.kind === "removal" ? "removal" : "mark",
        reason: row.reason,
        decision: row.decision === "uphold" || row.decision === "lift" ? row.decision : null,
        decisionNote: row.decision_note,
        decidedBy: row.decided_by_name,
        at: atMs(row.created_at),
        decidedAt: row.decided_at ? atMs(row.decided_at) : null,
        rule:
          row.rule &&
          isHardRule(row.rule) &&
          (row.rule !== "csam" || actor.admin || row.author_user_id === userId)
            ? row.rule
            : null,
      })),
      csamReports,
      adminAlerts,
      pages,
    },
  };
}

export async function writeBan(
  tx: Db,
  input: {
    userId: string;
    name: string;
    reason: BanEntry["reason"];
    byUserId: string;
    byName: string;
    removalId: string | null;
    now: Date;
    /** Empty is site-wide. A room id bars that room only. Strikes stay in that scope. */
    roomId: string;
    /**
     * The new hard removal is already stored. A room chat line sets this
     * because its row lives in room_chat_removal, not board_removal.
     */
    removalAlreadyCounted?: boolean;
  },
): Promise<BanEntry> {
  const prior = await tx.query<{ strikes: number }>(
    `select strikes from board_ban
     where user_id = $1 and room_id = $2
     order by created_at desc limit 1`,
    [input.userId, input.roomId],
  );
  const removals = input.roomId
    ? await tx.query<{ id: string }>(
        `select r.id from board_removal r
         join board_post p on p.id = r.post_id
         where r.author_user_id = $1 and p.room_id = $2`,
        [input.userId, input.roomId],
      )
    : await tx.query<{ id: string }>(`select id from board_removal where author_user_id = $1`, [
        input.userId,
      ]);
  const chatRemovals = (await roomChatReady(tx))
    ? await tx.query<{ id: string }>(
        input.roomId
          ? `select id from room_chat_removal where author_user_id = $1 and room_id = $2`
          : `select id from room_chat_removal where author_user_id = $1`,
        input.roomId ? [input.userId, input.roomId] : [input.userId],
      )
    : [];
  const counted = Math.max(Number(prior[0]?.strikes ?? 0), removals.length + chatRemovals.length);
  const fromRemoval = input.removalId != null || input.removalAlreadyCounted === true;
  const strikes = fromRemoval ? Math.max(counted, 1) : counted + 1;
  const until = new Date(
    input.now.getTime() + (input.reason === "csam" || strikes >= 2 ? CLOSED_MS : BAN_MS),
  );
  const id = randomUUID();
  await tx.query(
    `insert into board_ban
     (id, user_id, name, reason, by_user_id, by_name, strikes, until_at, removal_id, room_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
      input.roomId,
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
  const room = await roomById(db, input.roomId);
  if (!room) return fail(400, "Choose a room.");
  const ban = await openBan(db, input.userId, input.now, room.id);
  if (ban) return fail(403, "This account cannot post right now.");
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
    steward: stewardsRoom(actor, room.id),
    room: rulesOf(room),
  });
  if (stops.length > 0) return fail(400, stops[0] ?? "That post was not filed.", stops);
  const subjectRaw = field(input.body, "subject").trim();
  let subject: "candidate" | "business" | null = null;
  if (subjectRaw) {
    if (subjectRaw !== "candidate" && subjectRaw !== "business") {
      return fail(400, "A post is a candidate, a business, or neither.");
    }
    if (subjectRaw === "candidate" && !room.cardKinds.includes("candidate")) {
      return fail(400, "This room does not take a candidate post.");
    }
    if (subjectRaw === "business" && !room.cardKinds.includes("trade")) {
      return fail(400, "This room does not take a business post.");
    }
    subject = subjectRaw;
  }
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
          card_id, trade_id, campaign_id, subject, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         returning id, room_id, author_name, type, claim, reason, on_date, next_date, came, named,
                   parent_id, closed, mark, removed, card_id, trade_id, campaign_id, subject, created_at`,
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
          subject,
          input.now,
        ],
      );
      const saved = inserted[0];
      if (!saved) throw new Stop(500, "The post was not filed.");
      return saved;
    });
    return { ok: true, value: await withCouncil(db, toPost(row)) };
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
  const room = await roomById(db, parent.room_id);
  if (!room) return fail(404, "That post is not here.");
  if (await openBan(db, input.userId, input.now, room.id))
    return fail(403, "This account cannot post right now.");
  const allowed = stewardsRoom(actor, room.id) ? [...room.takes, ...room.stewardTakes] : room.takes;
  if (!allowed.includes(parent.type)) {
    return fail(
      403,
      room.stewardTakes.includes(parent.type) || room.takes.length === 0
        ? "Only a steward can post that."
        : `${room.name} does not take that kind of post.`,
    );
  }
  const id = randomUUID();
  const author = input.name.trim() || "Member";
  const inserted = await db.query<PostRow>(
    `insert into board_post
     (id, room_id, author_user_id, author_name, type, claim, parent_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, room_id, author_name, type, claim, reason, on_date, next_date, came, named,
               parent_id, closed, mark, removed, card_id, trade_id, campaign_id, subject, created_at`,
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
  return { ok: true, value: await withCouncil(db, toPost(row)) };
}

export async function revisePost(
  db: Db,
  input: { userId: string; name: string; postId: string; claim: string; reason: string; now: Date },
): Promise<Result<{ post: BoardPost; mark: MarkEntry | null }>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can post.");
  const existing = await db.query<PostRow & { author_user_id: string }>(
    `select id, room_id, author_user_id, author_name, type, claim, reason, on_date, next_date, came, named,
            parent_id, closed, mark, removed, card_id, trade_id, campaign_id, subject, created_at
     from board_post where id = $1`,
    [input.postId],
  );
  const post = existing[0];
  if (!post || post.removed) return fail(404, "That post is not here.");
  if (await openBan(db, input.userId, input.now, post.room_id))
    return fail(403, "This account cannot post right now.");
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
    steward: stewardsRoom(actor, room.id),
    room: rulesOf(room),
  });
  if (stops.length > 0) return fail(400, stops[0] ?? "That revision was not saved.", stops);
  const updated = await db.query<PostRow>(
    `update board_post set claim = $2, reason = $3 where id = $1
     returning id, room_id, author_name, type, claim, reason, on_date, next_date, came, named,
               parent_id, closed, mark, removed, card_id, trade_id, campaign_id, subject, created_at`,
    [post.id, input.claim.trim(), input.reason.trim()],
  );
  const saved = updated[0];
  if (!saved) return fail(404, "That post is not here.");
  return { ok: true, value: { post: await withCouncil(db, toPost(saved)), mark: null } };
}

export async function closeAsked(
  db: Db,
  input: { userId: string; postId: string; now: Date },
): Promise<Result<BoardPost>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can post.");
  const found = await db.query<{ room_id: string }>(
    `select room_id from board_post where id = $1`,
    [input.postId],
  );
  if (await openBan(db, input.userId, input.now, found[0]?.room_id ?? ""))
    return fail(403, "This account cannot post right now.");
  const updated = await db.query<PostRow>(
    `update board_post set closed = true
     where id = $1 and author_user_id = $2 and type = 'asked' and parent_id is null and removed = false
     returning id, room_id, author_name, type, claim, reason, on_date, next_date, came, named,
               parent_id, closed, mark, removed, card_id, trade_id, campaign_id, subject, created_at`,
    [input.postId, input.userId],
  );
  const row = updated[0];
  if (!row) return fail(404, "That question is not here.");
  return { ok: true, value: await withCouncil(db, toPost(row)) };
}

export async function markPost(
  db: Db,
  input: { userId: string; name: string; postId: string; mark: unknown; reason: string; now: Date },
): Promise<Result<{ post: BoardPost; row: MarkEntry }>> {
  const actor = await actorRole(db, input.userId);
  const sentence = sentenceOrStop(input.reason);
  if (!sentence.ok) return fail(400, sentence.error);
  const mark = input.mark === null || input.mark === "" ? null : input.mark;
  if (mark !== null && !isMarkValue(mark)) {
    return fail(400, MARK_ERROR);
  }
  const existing = await db.query<PostRow & { author_user_id: string }>(
    `select id, room_id, author_user_id, author_name, type, claim, reason, on_date, next_date, came, named,
            parent_id, closed, mark, removed, card_id, trade_id, campaign_id, subject, created_at
     from board_post where id = $1 and removed = false`,
    [input.postId],
  );
  const post = existing[0];
  if (!post) return fail(404, "That post is not here.");
  if (!stewardsRoom(actor, post.room_id)) {
    return fail(
      403,
      actor.stewardRooms.length > 0
        ? "A steward can mark a post only in a room they steward."
        : "Only a steward can mark a post.",
    );
  }
  const id = randomUUID();
  const by = input.name.trim() || "Steward";
  const saved = await db.transaction(async (tx) => {
    const updated = await tx.query<PostRow>(
      `update board_post set mark = $2 where id = $1 and removed = false
       returning id, room_id, author_name, type, claim, reason, on_date, next_date, came, named,
                 parent_id, closed, mark, removed, card_id, trade_id, campaign_id, subject, created_at`,
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
      post: await withCouncil(db, toPost(saved)),
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
  input: {
    userId: string;
    name: string;
    postId: string;
    reason: string;
    now: Date;
    store?: ObjectStore | null;
  },
): Promise<Result<{ removal: RemovalEntry; ban: BanEntry }>> {
  const actor = await actorRole(db, input.userId);
  if (!isHardRule(input.reason)) return fail(400, RULE_ERROR);
  const reason = input.reason;
  const existing = await db.query<{
    id: string;
    room_id: string;
    author_user_id: string;
    author_name: string;
    removed: boolean;
  }>(`select id, room_id, author_user_id, author_name, removed from board_post where id = $1`, [
    input.postId,
  ]);
  const post = existing[0];
  if (!post || post.removed) return fail(404, "That post is not here.");
  if (!stewardsRoom(actor, post.room_id)) {
    return fail(
      403,
      actor.stewardRooms.length > 0
        ? "A steward can remove a post only in a room they steward."
        : "Only a steward can remove a post.",
    );
  }
  const target = await actorRole(db, post.author_user_id);
  const blocked = moderationStop(actor, target);
  if (blocked) return fail(403, blocked);
  const by = input.name.trim() || "Steward";
  const removalId = randomUUID();
  let publicKeys: string[] = [];
  const heldKeys: string[] = [];
  let alert: HoldAlert | null = null;
  try {
    const ban = await db.transaction(async (tx) => {
      if (reason === "csam") {
        const relocated = await sealCsamHold(tx, input.store ?? null, post.id, input.now, heldKeys);
        publicKeys = relocated.files.map((item) => item.from);
        alert = relocated.alert;
      }
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
      const siteWide = actor.admin || reason === "csam";
      return writeBan(tx, {
        userId: post.author_user_id,
        name: post.author_name,
        reason,
        byUserId: input.userId,
        byName: by,
        removalId,
        now: input.now,
        roomId: siteWide ? "" : post.room_id,
      });
    });
    await dropObjectKeys(input.store ?? null, publicKeys);
    console.log(JSON.stringify({ event: "post-removed", postId: post.id, reason }));
    if (actor.admin || reason === "csam") evictCallMember(post.author_user_id);
    else evictCallMember(post.author_user_id, [post.room_id]);
    if (alert) scheduleHoldAlert(alert);
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
    await dropObjectKeys(input.store ?? null, heldKeys);
    if (error instanceof Stop) return fail(error.status, error.message);
    throw error;
  }
}

/** After the response is built and the call eviction has run. A hang does not stall either. */
function scheduleHoldAlert(alert: HoldAlert): void {
  setImmediate(() => {
    void sendHoldAlert(alert);
  });
}

async function offendedInRoom(db: Db, userId: string, roomId: string): Promise<boolean> {
  const posts = await db.query<{ id: string }>(
    `select id from board_post where author_user_id = $1 and room_id = $2 limit 1`,
    [userId, roomId],
  );
  if (posts[0]) return true;
  if (!(await roomChatReady(db))) return false;
  const lines = await db.query<{ id: string }>(
    `select id from room_chat_message where author_user_id = $1 and room_id = $2 limit 1`,
    [userId, roomId],
  );
  return Boolean(lines[0]);
}

export async function banMember(
  db: Db,
  input: {
    userId: string;
    name: string;
    email: string;
    reason: string;
    roomId?: string;
    now: Date;
  },
): Promise<Result<BanEntry>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.admin && actor.stewardRooms.length === 0) {
    return fail(403, "Only a steward can bar an account.");
  }
  if (!isHardRule(input.reason)) return fail(400, RULE_ERROR);
  const reason = input.reason;
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
  const blocked = moderationStop(actor, target);
  if (blocked) return fail(403, blocked);
  const byName = input.name.trim() || "Steward";
  if (actor.admin) {
    const ban = await writeBan(db, {
      userId: person.id,
      name: person.name,
      reason,
      byUserId: input.userId,
      byName,
      removalId: null,
      now: input.now,
      roomId: "",
    });
    evictCallMember(person.id);
    return { ok: true, value: ban };
  }
  const roomId = input.roomId?.trim() ?? "";
  if (!roomId) return fail(400, "Name the room this bar is for.");
  if (!actor.stewardRooms.includes(roomId)) {
    return fail(403, "A steward can bar a member only in a room they steward.");
  }
  if (!(await offendedInRoom(db, person.id, roomId))) {
    return fail(403, "A steward can bar a member only for a post in a room they steward.");
  }
  const siteWide = reason === "csam";
  const ban = await writeBan(db, {
    userId: person.id,
    name: person.name,
    reason,
    byUserId: input.userId,
    byName,
    removalId: null,
    now: input.now,
    roomId: siteWide ? "" : roomId,
  });
  if (siteWide) evictCallMember(person.id);
  else evictCallMember(person.id, [roomId]);
  return { ok: true, value: ban };
}

const POST_RETURNING = `id, room_id, author_name, type, claim, reason, on_date, next_date, came, named,
  parent_id, closed, mark, removed, card_id, trade_id, campaign_id, subject, created_at`;

function appealFrom(row: {
  id: string;
  room_id: string;
  post_id: string;
  author_name: string;
  kind: string;
  reason: string;
  decision: string | null;
  decision_note: string;
  decided_by_name: string;
  created_at: Date | string;
  decided_at: Date | string | null;
  rule: string | null;
}): AppealEntry {
  return {
    id: row.id,
    room: row.room_id,
    postId: row.post_id,
    author: row.author_name,
    kind: row.kind === "removal" ? "removal" : "mark",
    reason: row.reason,
    decision: row.decision === "uphold" || row.decision === "lift" ? row.decision : null,
    decisionNote: row.decision_note,
    decidedBy: row.decided_by_name,
    at: atMs(row.created_at),
    decidedAt: row.decided_at ? atMs(row.decided_at) : null,
    rule: row.rule && isHardRule(row.rule) ? row.rule : null,
  };
}

const APPEAL_SELECT = `select a.id, a.room_id, a.post_id, a.author_name, a.kind, a.reason, a.decision,
  a.decision_note, a.decided_by_name, a.created_at, a.decided_at, r.reason as rule
  from board_appeal a
  left join board_removal r on a.kind = 'removal' and r.id = a.target_id`;

/** The author's own appeals, including when a bar blocks the rest of the board. */
export async function listOwnAppeals(db: Db, userId: string): Promise<AppealEntry[]> {
  const actor = await actorRole(db, userId);
  if (!actor.member) return [];
  const rows = await db.query<Parameters<typeof appealFrom>[0]>(
    `${APPEAL_SELECT} where a.author_user_id = $1 order by a.created_at desc limit 50`,
    [userId],
  );
  return rows.map(appealFrom);
}

export async function fileAppeal(
  db: Db,
  input: { userId: string; name: string; postId: string; kind: string; reason: string; now: Date },
): Promise<Result<AppealEntry>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can appeal.");
  if (input.kind !== "mark" && input.kind !== "removal")
    return fail(400, "Appeal a mark or a removal.");
  const sentence = sentenceOrStop(input.reason);
  if (!sentence.ok) return fail(400, sentence.error);
  const posts = await db.query<{
    id: string;
    room_id: string;
    author_user_id: string;
    author_name: string;
    mark: string | null;
    removed: boolean;
  }>(
    `select id, room_id, author_user_id, author_name, mark, removed from board_post where id = $1`,
    [input.postId],
  );
  const post = posts[0];
  if (!post) return fail(404, "That post is not here.");
  if (post.author_user_id !== input.userId) return fail(403, "Only the author can appeal.");
  let targetId = "";
  if (input.kind === "mark") {
    if (post.removed || !isMarkValue(post.mark)) return fail(404, "That mark is not here.");
    const marks = await db.query<{ id: string }>(
      `select id from board_mark where post_id = $1 and mark is not null order by created_at desc limit 1`,
      [post.id],
    );
    targetId = marks[0]?.id ?? post.id;
  } else {
    const removals = await db.query<{ id: string }>(
      `select id from board_removal where post_id = $1 order by created_at desc limit 1`,
      [post.id],
    );
    const removal = removals[0];
    if (!removal) return fail(404, "That removal is not here.");
    targetId = removal.id;
  }
  const id = randomUUID();
  const author = input.name.trim() || post.author_name;
  try {
    await db.query(
      `insert into board_appeal
       (id, post_id, room_id, author_user_id, author_name, kind, target_id, reason, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        post.id,
        post.room_id,
        input.userId,
        author,
        input.kind,
        targetId,
        sentence.text,
        input.now,
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "That appeal is already filed.");
    throw error;
  }
  const saved = await db.query<Parameters<typeof appealFrom>[0]>(
    `${APPEAL_SELECT} where a.id = $1`,
    [id],
  );
  const row = saved[0];
  if (!row) return fail(500, "The appeal was not filed.");
  console.log(JSON.stringify({ event: "appeal-filed", postId: post.id, kind: input.kind }));
  return { ok: true, value: appealFrom(row) };
}

export async function decideAppeal(
  db: Db,
  input: {
    userId: string;
    name: string;
    appealId: string;
    decision: string;
    reason: string;
    now: Date;
  },
): Promise<Result<{ appeal: AppealEntry; posts: BoardPost[] }>> {
  const actor = await actorRole(db, input.userId);
  if (input.decision !== "uphold" && input.decision !== "lift")
    return fail(400, "Uphold or lift the appeal.");
  const sentence = sentenceOrStop(input.reason);
  if (!sentence.ok) return fail(400, sentence.error);
  const open = await db.query<{
    id: string;
    room_id: string;
    post_id: string;
    author_user_id: string;
    kind: string;
    target_id: string;
    decision: string | null;
  }>(
    `select id, room_id, post_id, author_user_id, kind, target_id, decision from board_appeal where id = $1`,
    [input.appealId],
  );
  const appeal = open[0];
  if (!appeal || appeal.decision) return fail(404, "That appeal is not open.");
  if (!stewardsRoom(actor, appeal.room_id)) {
    return fail(
      403,
      actor.stewardRooms.length > 0
        ? "A steward can decide an appeal only in a room they steward."
        : "Only a steward can decide an appeal.",
    );
  }
  if (appeal.author_user_id === input.userId)
    return fail(403, "A steward does not decide their own appeal.");
  const by = input.name.trim() || "Steward";
  try {
    const posts = await db.transaction(async (tx) => {
      if (input.decision === "lift" && appeal.kind === "removal") {
        const removals = await tx.query<{ reason: string }>(
          `select reason from board_removal where id = $1`,
          [appeal.target_id],
        );
        if (removals[0]?.reason === "csam") {
          throw new Stop(400, "That removal stays. Child sexual abuse material is not put back.");
        }
        await tx.query(`update board_post set removed = false where id = $1 or parent_id = $1`, [
          appeal.post_id,
        ]);
        await tx.query(
          `update board_ban set until_at = $2
           where removal_id = $1 and strikes < 2 and (room_id = '' or room_id = $3)`,
          [appeal.target_id, input.now, appeal.room_id],
        );
      }
      if (input.decision === "lift" && appeal.kind === "mark") {
        await tx.query(`update board_post set mark = null where id = $1 and removed = false`, [
          appeal.post_id,
        ]);
      }
      await tx.query(
        `update board_appeal
         set decision = $2, decision_note = $3, decided_by_user_id = $4, decided_by_name = $5, decided_at = $6
         where id = $1 and decision is null`,
        [appeal.id, input.decision, sentence.text, input.userId, by, input.now],
      );
      if (input.decision !== "lift") return [];
      return tx.query<PostRow>(
        `select ${POST_RETURNING} from board_post where id = $1 or parent_id = $1`,
        [appeal.post_id],
      );
    });
    const saved = await db.query<Parameters<typeof appealFrom>[0]>(
      `${APPEAL_SELECT} where a.id = $1`,
      [appeal.id],
    );
    const row = saved[0];
    if (!row) return fail(500, "The decision was not saved.");
    console.log(
      JSON.stringify({ event: "appeal-decided", appealId: appeal.id, decision: input.decision }),
    );
    const pictures = await mediaFor(
      db,
      posts.map((post) => post.id),
    );
    return {
      ok: true,
      value: {
        appeal: appealFrom(row),
        posts: posts.map((post) => toPost(post, pictures.get(post.id) ?? [])),
      },
    };
  } catch (error) {
    if (error instanceof Stop) return fail(error.status, error.message);
    throw error;
  }
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
  _db: Db,
  _input: { userId: string; name: string; email: string; action: string; note: string; now: Date },
): Promise<Result<{ action: "grant" | "revoke" }>> {
  return fail(
    400,
    "A steward needs the inviter and a steward of that room. An admin needs a steward and the role owner.",
  );
}
