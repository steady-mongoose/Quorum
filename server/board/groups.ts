// Theme groups beside the town rooms. A member asks from a room they have
// joined. A steward of that room approves, and the requester becomes an
// admin. Each group can have more than one admin. Admins mark and remove
// only that group's posts, under the same rules as the board. A steward of
// that group, or a steward of the room it was approved from, hears appeals.
// A group approved from a room inherits that room's bar: a member barred
// there cannot read or post in the group. Room chat and room calls use
// only that room's own bar. A group cannot take a room's id, including one
// named in the code list when that row is missing. A seed group
// has no approving room. A steward grant with no room does not count.
// Posts are newest first.
// English only. No counts.

import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import { isUniqueViolation } from "../db.ts";
import { CODE_ROOM_IDS } from "../../src/lib/board/model.ts";
import { OBJECT_ID, ROOM_ID } from "../../src/lib/media/limits.ts";
import { isEnglish, looksLikePorn, looksLikeThreat } from "../../src/lib/board/text.ts";
import { actorRole, moderationStop, stewardsRoom, type BoardActor } from "./access.ts";
import { sentenceOrStop } from "./check.ts";
import { approvedRoomIds } from "./group-rooms.ts";
import { banOpen } from "./ban.ts";
import { queryBanTable } from "./ban-check.ts";
import { filterAudience, guardGroupAudience, guardRoomAudience } from "./audience.ts";
import { parseAudience } from "../gender-policy.ts";
import { openBan, type OpenBan, type Result } from "./store.ts";
import type { RuleId } from "./rule.ts";

const PAGE_DEFAULT = 40;
const PAGE_MAX = 100;
const HARD = new Set(["threat", "porn", "csam", "doxxing", "blasphemy"]);

export type ThemeGroup = {
  id: string;
  name: string;
  about: string;
  joined: boolean;
  admin: boolean;
  audience?: "men" | "women";
};

export type GroupPost = {
  id: string;
  groupId: string;
  author: string;
  body: string;
  on: string;
  at: number;
  mark: "sloppy" | "unsupported" | null;
};

export type GroupMark = {
  id: string;
  postId: string;
  author: string;
  by: string;
  mark: "sloppy" | "unsupported" | null;
  reason: string;
  at: number;
};

export type GroupRemoval = {
  id: string;
  postId: string;
  author: string;
  reason: "threat" | "porn" | "csam" | "doxxing" | "blasphemy";
  at: number;
};

export type GroupRequest = {
  id: string;
  groupId: string;
  name: string;
  about: string;
  by: string;
  roomId: string;
  status: "open" | "approved" | "refused";
  note: string;
  at: number;
};

export type GroupAppeal = {
  id: string;
  postId: string;
  groupId: string;
  by: string;
  text: string;
  status: "open" | "upheld" | "lifted";
  decidedBy: string;
  at: number;
  decidedAt: number | null;
};

export type GroupLogRow = {
  id: string;
  action: string;
  actor: string;
  detail: string;
  at: number;
  postId?: string;
};

type LogAction =
  | "request"
  | "approve"
  | "refuse"
  | "join"
  | "leave"
  | "grant-admin"
  | "revoke-admin"
  | "grant-steward"
  | "revoke-steward"
  | "post"
  | "mark"
  | "clear"
  | "remove"
  | "appeal"
  | "uphold"
  | "lift";

type Err = {
  ok: false;
  status: number;
  error: string;
  ban?: { until: number; strikes: number; reason: RuleId };
  code?: string;
};

type Gate = { ok: true; actor: BoardActor } | Err;

function fail(
  status: number,
  error: string,
  ban?: { until: number; strikes: number; reason: RuleId },
): Err {
  return ban ? { ok: false, status, error, ban } : { ok: false, status, error };
}

class Stop extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function atMs(value: Date | string | number): number {
  if (typeof value === "number") return value;
  return new Date(value).getTime();
}

function flag(value: unknown): boolean {
  return value === true || value === "t" || value === 1;
}

function markOf(value: string | null): GroupPost["mark"] {
  return value === "sloppy" || value === "unsupported" ? value : null;
}

function hardReason(value: string): GroupRemoval["reason"] {
  if (
    value === "porn" ||
    value === "csam" ||
    value === "doxxing" ||
    value === "blasphemy" ||
    value === "threat"
  ) {
    return value;
  }
  return "threat";
}

function groupIdFor(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}

function englishText(
  value: string,
  max: number,
  empty: string,
  long: string,
): { ok: true; text: string } | { ok: false; error: string } {
  const text = value.trim();
  if (!text) return { ok: false, error: empty };
  if (text.length > max) return { ok: false, error: long };
  if (!isEnglish(text)) return { ok: false, error: "Write it in English." };
  return { ok: true, text };
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
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

async function gate(db: Db, userId: string, now: Date): Promise<Gate> {
  const actor = await actorRole(db, userId);
  if (!actor.member) return fail(403, "Only a member can do that.");
  // Site-wide only. A room bar is checked against the group that room approved.
  const ban = await openBan(db, userId, now);
  if (ban) return fail(403, "banned", ban);
  return { ok: true, actor };
}

/**
 * An open bar on a room that approved this group.
 * A seed group has no approving room, so a room bar does not reach it.
 * A site-wide bar matches too, because that bar applies in every room.
 */
export async function banFromSourceRooms(
  db: Db,
  userId: string,
  groupId: string,
  now: Date,
): Promise<OpenBan | null> {
  let rooms: string[] = [];
  try {
    rooms = await approvedRoomIds(db, groupId);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "42P01") return null;
    throw error;
  }
  for (const roomId of rooms) {
    try {
      const ban = await openBan(db, userId, now, roomId);
      if (ban) return ban;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "42P01") return null;
      throw error;
    }
  }
  return null;
}

async function gateGroup(db: Db, userId: string, groupId: string, now: Date): Promise<Gate> {
  const gated = await gate(db, userId, now);
  if (!gated.ok) return gated;
  const ban = await banFromSourceRooms(db, userId, groupId, now);
  if (ban) return fail(403, "banned", ban);
  return gated;
}

async function isGroupAdmin(db: Db, groupId: string, userId: string): Promise<boolean> {
  const rows = await db.query<{ user_id: string }>(
    `select user_id from theme_group_admin where group_id = $1 and user_id = $2`,
    [groupId, userId],
  );
  return Boolean(rows[0]);
}

async function isJoined(db: Db, groupId: string, userId: string): Promise<boolean> {
  const rows = await db.query<{ user_id: string }>(
    `select user_id from theme_group_member where group_id = $1 and user_id = $2`,
    [groupId, userId],
  );
  return Boolean(rows[0]);
}

async function roomIdTaken(db: Db, id: string): Promise<boolean> {
  if (CODE_ROOM_IDS.has(id)) return true;
  const rows = await db.query<{ id: string }>(`select id from room where id = $1`, [id]);
  return Boolean(rows[0]);
}

async function groupExists(db: Db, groupId: string): Promise<boolean> {
  if (!ROOM_ID.test(groupId)) return false;
  const rows = await db.query<{ id: string }>(`select id from theme_group where id = $1`, [
    groupId,
  ]);
  return Boolean(rows[0]);
}

async function isGroupSteward(db: Db, groupId: string, userId: string): Promise<boolean> {
  const rows = await db.query<{ user_id: string }>(
    `select user_id from theme_group_steward where group_id = $1 and user_id = $2`,
    [groupId, userId],
  );
  return Boolean(rows[0]);
}

/**
 * A steward row on this group, or a steward grant for a room this group was
 * approved from. An admin covers every group. A grant with no room does not.
 */
async function stewardOfGroup(
  db: Db,
  actor: BoardActor,
  userId: string,
  groupId: string,
): Promise<boolean> {
  if (actor.admin) return true;
  if (await isGroupSteward(db, groupId, userId)) return true;
  const rooms = await approvedRoomIds(db, groupId);
  return rooms.some((roomId) => stewardsRoom(actor, roomId));
}

/** Group admin, group steward, or steward of a room this group was approved from. */
async function moderatesGroup(
  db: Db,
  actor: BoardActor,
  userId: string,
  groupId: string,
): Promise<boolean> {
  if (await isGroupAdmin(db, groupId, userId)) return true;
  return stewardOfGroup(db, actor, userId, groupId);
}

async function stewardedGroupIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.query<{ group_id: string }>(
    `select group_id from theme_group_steward where user_id = $1`,
    [userId],
  );
  return rows.map((row) => row.group_id);
}

function inClause(params: unknown[], ids: string[]): string {
  const marks = ids.map((id) => {
    params.push(id);
    return `$${params.length}`;
  });
  return marks.join(", ");
}

async function writeLog(
  tx: Db,
  input: {
    groupId: string;
    actorUserId: string;
    actorName: string;
    action: LogAction;
    postId?: string | null;
    targetUserId?: string | null;
    detail?: string;
    now: Date;
  },
): Promise<void> {
  await tx.query(
    `insert into theme_group_log
     (id, group_id, actor_user_id, actor_name, action, post_id, target_user_id, detail, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      randomUUID(),
      input.groupId,
      input.actorUserId,
      input.actorName,
      input.action,
      input.postId ?? null,
      input.targetUserId ?? null,
      (input.detail ?? "").slice(0, 600),
      input.now,
    ],
  );
}

type PostRow = {
  id: string;
  group_id: string;
  author_user_id: string | null;
  author_name: string;
  body: string;
  on_date: string;
  mark: string | null;
  removed: boolean;
  removed_for: string | null;
  created_at: Date | string;
};

function toPost(row: PostRow): GroupPost {
  return {
    id: row.id,
    groupId: row.group_id,
    author: row.author_name,
    body: row.body,
    on: row.on_date,
    at: atMs(row.created_at),
    mark: markOf(row.mark),
  };
}

export async function listGroups(
  db: Db,
  userId: string,
  now: Date,
): Promise<Result<{ groups: ThemeGroup[] }>> {
  const gated = await gate(db, userId, now);
  if (!gated.ok) return gated;
  const rows = await queryBanTable<{
    id: string;
    name: string;
    about: string;
    audience: string;
    source_room_id: string;
    joined: unknown;
    admin: unknown;
    ban_reason: string | null;
    ban_strikes: number | string | null;
    ban_until: Date | string | null;
  }>(
    db,
    `select g.id, g.name, g.about, g.audience, g.source_room_id,
            exists(select 1 from theme_group_member m where m.group_id = g.id and m.user_id = $1) as joined,
            exists(select 1 from theme_group_admin a where a.group_id = g.id and a.user_id = $1) as admin,
            b.reason as ban_reason, b.strikes as ban_strikes, b.until_at as ban_until
     from theme_group g
     left join theme_group_request r
       on r.group_id = g.id and r.status = 'approved' and r.room_id <> ''
     left join board_ban b on b.user_id = $1 and b.room_id = r.room_id
     order by g.name asc, g.id asc`,
    [userId],
  );
  const at = now.getTime();
  const hidden = new Set<string>();
  const groups: Array<{
    id: string;
    name: string;
    about: string;
    joined: boolean;
    admin: boolean;
    audience: string;
    sourceRoomId: string;
  }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      groups.push({
        id: row.id,
        name: row.name,
        about: row.about,
        joined: flag(row.joined),
        admin: flag(row.admin),
        audience: row.audience,
        sourceRoomId: row.source_room_id,
      });
    }
    if (row.ban_reason == null || row.ban_strikes == null || row.ban_until == null) continue;
    if (
      banOpen(
        { reason: row.ban_reason, strikes: Number(row.ban_strikes), until: atMs(row.ban_until) },
        at,
      )
    ) {
      hidden.add(row.id);
    }
  }
  const open = groups.filter((group) => !hidden.has(group.id));
  const split = await filterAudience(db, {
    userId,
    actor: gated.actor,
    rows: open,
    now,
    path: "group",
    moderate: true,
    roomIdOf: (group) => group.sourceRoomId,
    detailOf: (group) => group.id,
  });
  return {
    ok: true,
    value: {
      groups: split.visible.map((group) => ({
        id: group.id,
        name: group.name,
        about: group.about,
        joined: group.joined,
        admin: group.admin,
        ...(group.audience === "men" || group.audience === "women" ? { audience: group.audience } : {}),
      })),
    },
  };
}

export async function listGroup(
  db: Db,
  userId: string,
  groupId: string,
  now: Date,
  query: { cursor?: string; limit?: number } = {},
): Promise<
  Result<{
    group: ThemeGroup & { admins: string[] };
    posts: GroupPost[];
    marks: GroupMark[];
    removals: GroupRemoval[];
    next: string | null;
  }>
> {
  const gated = await gateGroup(db, userId, groupId, now);
  if (!gated.ok) return gated;
  const audienceGate = await guardGroupAudience(db, {
    userId,
    groupId,
    now,
    moderate: true,
    detail: "read",
    actor: gated.actor,
  });
  if (!audienceGate.ok) {
    return { ok: false, status: audienceGate.status, error: audienceGate.error, code: audienceGate.code };
  }
  if (!(await groupExists(db, groupId))) return fail(404, "That group is not here.");
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) return fail(400, "That page is not valid.");
  const limit = Math.min(
    PAGE_MAX,
    Math.max(1, Math.floor(query.limit ?? PAGE_DEFAULT) || PAGE_DEFAULT),
  );
  const rows = await db.query<PostRow>(
    `select id, group_id, author_user_id, author_name, body, on_date, mark, removed, removed_for, created_at
     from theme_group_post
     where group_id = $1
       and removed = false
       and (
         $2::timestamptz is null
         or created_at < $2::timestamptz
         or (created_at = $2::timestamptz and id < $3)
       )
     order by created_at desc, id desc
     limit $4`,
    [groupId, cursor?.at ?? null, cursor?.id ?? "", limit + 1],
  );
  const extra = rows.length > limit;
  const kept = extra ? rows.slice(0, limit) : rows;
  const last = kept[kept.length - 1];
  const posts = kept.map(toPost);
  const postIds = kept.map((row) => row.id);
  const markRows =
    postIds.length === 0
      ? []
      : await db.query<{
          id: string;
          post_id: string;
          author_name: string;
          by_name: string;
          mark: string | null;
          reason: string;
          created_at: Date | string;
        }>(
          `select id, post_id, author_name, by_name, mark, reason, created_at
           from theme_group_mark
           where post_id in (${postIds.map((_, index) => `$${index + 1}`).join(", ")})
           order by created_at desc, id desc`,
          postIds,
        );
  const admin = await isGroupAdmin(db, groupId, userId);
  const seesRemovals = admin || (await stewardOfGroup(db, gated.actor, userId, groupId));
  const removalRows = await db.query<{
    id: string;
    post_id: string;
    author_user_id: string | null;
    author_name: string;
    reason: string;
    created_at: Date | string;
  }>(
    `select id, post_id, author_user_id, author_name, reason, created_at
     from theme_group_removal
     where group_id = $1
     order by created_at desc, id desc
     limit 100`,
    [groupId],
  );
  const visibleRemovals = seesRemovals
    ? removalRows
    : removalRows.filter((row) => row.author_user_id === userId);
  const header = await db.query<{ id: string; name: string; about: string; audience: string }>(
    `select id, name, about, audience from theme_group where id = $1`,
    [groupId],
  );
  const group = header[0];
  if (!group) return fail(404, "That group is not here.");
  const adminRows = await db.query<{ name: string }>(
    `select u.name
     from theme_group_admin a
     join "user" u on u.id = a.user_id
     where a.group_id = $1
     order by u.name asc, a.user_id asc`,
    [groupId],
  );
  return {
    ok: true,
    value: {
      group: {
        id: group.id,
        name: group.name,
        about: group.about,
        joined: await isJoined(db, groupId, userId),
        admin,
        admins: adminRows.map((row) => row.name),
        ...(group.audience === "men" || group.audience === "women" ? { audience: group.audience } : {}),
      },
      posts,
      marks: markRows.map((row) => ({
        id: row.id,
        postId: row.post_id,
        author: row.author_name,
        by: row.by_name,
        mark: markOf(row.mark),
        reason: row.reason,
        at: atMs(row.created_at),
      })),
      removals: visibleRemovals.map((row) => ({
        id: row.id,
        postId: row.post_id,
        author: row.author_name,
        reason: hardReason(row.reason),
        at: atMs(row.created_at),
      })),
      next: extra && last ? encodeCursor(last.created_at, last.id) : null,
    },
  };
}

export async function joinGroup(
  db: Db,
  input: { userId: string; name: string; groupId: string; now: Date },
): Promise<Result<{ joined: true }>> {
  const gated = await gateGroup(db, input.userId, input.groupId, input.now);
  if (!gated.ok) return gated;
  const audienceGate = await guardGroupAudience(db, {
    userId: input.userId,
    groupId: input.groupId,
    now: input.now,
    detail: "join",
    actor: gated.actor,
  });
  if (!audienceGate.ok) {
    return { ok: false, status: audienceGate.status, error: audienceGate.error, code: audienceGate.code };
  }
  if (!(await groupExists(db, input.groupId))) return fail(404, "That group is not here.");
  const who = input.name.trim() || "Member";
  if (await isJoined(db, input.groupId, input.userId)) return { ok: true, value: { joined: true } };
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into theme_group_member (group_id, user_id, joined_at) values ($1, $2, $3)`,
      [input.groupId, input.userId, input.now],
    );
    await writeLog(tx, {
      groupId: input.groupId,
      actorUserId: input.userId,
      actorName: who,
      action: "join",
      now: input.now,
    });
  });
  return { ok: true, value: { joined: true } };
}

export async function leaveGroup(
  db: Db,
  input: { userId: string; name: string; groupId: string; now: Date },
): Promise<Result<{ joined: false }>> {
  const gated = await gate(db, input.userId, input.now);
  if (!gated.ok) return gated;
  if (!(await groupExists(db, input.groupId))) return fail(404, "That group is not here.");
  if (!(await isJoined(db, input.groupId, input.userId)))
    return fail(400, "You are not in that group.");
  const who = input.name.trim() || "Member";
  await db.transaction(async (tx) => {
    await tx.query(`delete from theme_group_member where group_id = $1 and user_id = $2`, [
      input.groupId,
      input.userId,
    ]);
    await writeLog(tx, {
      groupId: input.groupId,
      actorUserId: input.userId,
      actorName: who,
      action: "leave",
      now: input.now,
    });
  });
  return { ok: true, value: { joined: false } };
}

export async function createGroupPost(
  db: Db,
  input: {
    userId: string;
    name: string;
    groupId: string;
    body: string;
    on: string;
    now: Date;
    id?: string;
  },
): Promise<Result<GroupPost>> {
  const gated = await gateGroup(db, input.userId, input.groupId, input.now);
  if (!gated.ok) return gated;
  const audienceGate = await guardGroupAudience(db, {
    userId: input.userId,
    groupId: input.groupId,
    now: input.now,
    detail: "post",
    actor: gated.actor,
  });
  if (!audienceGate.ok) {
    return { ok: false, status: audienceGate.status, error: audienceGate.error, code: audienceGate.code };
  }
  if (!(await groupExists(db, input.groupId))) return fail(404, "That group is not here.");
  const admin = await isGroupAdmin(db, input.groupId, input.userId);
  const joined = await isJoined(db, input.groupId, input.userId);
  if (!admin && !joined) return fail(403, "Join the group before you post.");
  const body = englishText(input.body, 600, "Write the post.", "Keep it under 600 characters.");
  if (!body.ok) return fail(400, body.error);
  if (looksLikeThreat(body.text)) return fail(400, "That reads as a threat and will not post.");
  if (looksLikePorn(body.text)) return fail(400, "That will not post.");
  const on = input.on.trim();
  if (on && !isIsoDate(on)) return fail(400, "The date has to be a calendar day.");
  if (input.id && !OBJECT_ID.test(input.id)) return fail(400, "That post id is not valid.");
  const id = input.id || randomUUID();
  const who = input.name.trim() || "Member";
  try {
    const row = await db.transaction(async (tx) => {
      const inserted = await tx.query<PostRow>(
        `insert into theme_group_post
         (id, group_id, author_user_id, author_name, body, on_date, created_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id, group_id, author_user_id, author_name, body, on_date, mark, removed, removed_for, created_at`,
        [id, input.groupId, input.userId, who, body.text, on, input.now],
      );
      const saved = inserted[0];
      if (!saved) throw new Stop(500, "The post was not filed.");
      await writeLog(tx, {
        groupId: input.groupId,
        actorUserId: input.userId,
        actorName: who,
        action: "post",
        postId: saved.id,
        now: input.now,
      });
      return saved;
    });
    return { ok: true, value: toPost(row) };
  } catch (error) {
    if (error instanceof Stop) return fail(error.status, error.message);
    if (isUniqueViolation(error)) return fail(409, "That post was already filed.");
    throw error;
  }
}

export async function setGroupAdmin(
  db: Db,
  input: {
    userId: string;
    name: string;
    groupId: string;
    email: string;
    action: string;
    now: Date;
  },
): Promise<Result<{ action: "grant" | "revoke" }>> {
  const gated = await gateGroup(db, input.userId, input.groupId, input.now);
  if (!gated.ok) return gated;
  if (!(await groupExists(db, input.groupId))) return fail(404, "That group is not here.");
  if (input.action !== "grant" && input.action !== "revoke")
    return fail(400, "Grant or revoke the admin role.");
  const admin = await isGroupAdmin(db, input.groupId, input.userId);
  const steward = await stewardOfGroup(db, gated.actor, input.userId, input.groupId);
  if (input.action === "revoke") {
    if (!steward) return fail(403, "Only a steward can revoke a group admin.");
  } else if (!admin && !steward) {
    return fail(403, "Only a group admin or a steward can appoint an admin.");
  }
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
  if (input.action === "grant") {
    const barred =
      (await openBan(db, person.id, input.now)) ||
      (await banFromSourceRooms(db, person.id, input.groupId, input.now));
    if (barred) return fail(400, "That account is barred.");
    if (!(await isJoined(db, input.groupId, person.id)))
      return fail(400, "They have to join the group first.");
    if (await isGroupAdmin(db, input.groupId, person.id))
      return fail(409, "That person is already an admin of this group.");
  } else if (!(await isGroupAdmin(db, input.groupId, person.id))) {
    return fail(400, "That person is not an admin of this group.");
  }
  const who = input.name.trim() || "Member";
  await db.transaction(async (tx) => {
    if (input.action === "grant") {
      await tx.query(
        `insert into theme_group_admin
         (group_id, user_id, granted_by_user_id, granted_by_name, created_at)
         values ($1, $2, $3, $4, $5)`,
        [input.groupId, person.id, input.userId, who, input.now],
      );
    } else {
      await tx.query(`delete from theme_group_admin where group_id = $1 and user_id = $2`, [
        input.groupId,
        person.id,
      ]);
    }
    await writeLog(tx, {
      groupId: input.groupId,
      actorUserId: input.userId,
      actorName: who,
      action: input.action === "grant" ? "grant-admin" : "revoke-admin",
      targetUserId: person.id,
      detail: person.name,
      now: input.now,
    });
  });
  console.log(
    JSON.stringify({
      event: "group-admin-changed",
      groupId: input.groupId,
      action: input.action,
      userId: person.id,
    }),
  );
  return { ok: true, value: { action: input.action } };
}

export async function setGroupSteward(
  db: Db,
  input: {
    userId: string;
    name: string;
    groupId: string;
    email: string;
    action: string;
    now: Date;
  },
): Promise<Result<{ action: "grant" | "revoke" }>> {
  const gated = await gateGroup(db, input.userId, input.groupId, input.now);
  if (!gated.ok) return gated;
  if (!(await groupExists(db, input.groupId))) return fail(404, "That group is not here.");
  if (input.action !== "grant" && input.action !== "revoke")
    return fail(400, "Grant or revoke the steward role.");
  const admin = await isGroupAdmin(db, input.groupId, input.userId);
  if (!admin && !gated.actor.admin)
    return fail(403, "Only an admin of this group can appoint a steward.");
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
  if (input.action === "grant") {
    const barred =
      (await openBan(db, person.id, input.now)) ||
      (await banFromSourceRooms(db, person.id, input.groupId, input.now));
    if (barred) return fail(400, "That account is barred.");
    if (!(await isJoined(db, input.groupId, person.id)))
      return fail(400, "They have to join the group first.");
    if (await isGroupSteward(db, input.groupId, person.id))
      return fail(409, "That person is already a steward of this group.");
  } else if (!(await isGroupSteward(db, input.groupId, person.id))) {
    return fail(400, "That person is not a steward of this group.");
  }
  const who = input.name.trim() || "Admin";
  await db.transaction(async (tx) => {
    if (input.action === "grant") {
      await tx.query(
        `insert into theme_group_steward
         (group_id, user_id, granted_by_user_id, granted_by_name, created_at)
         values ($1, $2, $3, $4, $5)`,
        [input.groupId, person.id, input.userId, who, input.now],
      );
    } else {
      await tx.query(`delete from theme_group_steward where group_id = $1 and user_id = $2`, [
        input.groupId,
        person.id,
      ]);
    }
    await writeLog(tx, {
      groupId: input.groupId,
      actorUserId: input.userId,
      actorName: who,
      action: input.action === "grant" ? "grant-steward" : "revoke-steward",
      targetUserId: person.id,
      detail: person.name,
      now: input.now,
    });
  });
  console.log(
    JSON.stringify({
      event: "group-steward-changed",
      groupId: input.groupId,
      action: input.action,
      userId: person.id,
    }),
  );
  return { ok: true, value: { action: input.action } };
}

export async function requestGroup(
  db: Db,
  input: {
    userId: string;
    name: string;
    roomId: string;
    groupName: string;
    about: string;
    now: Date;
  },
): Promise<Result<GroupRequest>> {
  const gated = await gate(db, input.userId, input.now);
  if (!gated.ok) return gated;
  const titled = englishText(
    input.groupName,
    80,
    "Name the group.",
    "Keep the name under 80 characters.",
  );
  if (!titled.ok) return fail(400, titled.error);
  const blurb = englishText(
    input.about,
    600,
    "Say what the group is.",
    "Keep it under 600 characters.",
  );
  if (!blurb.ok) return fail(400, blurb.error);
  const roomId = input.roomId.trim();
  if (!ROOM_ID.test(roomId)) return fail(400, "Ask from a room you have joined.");
  const rooms = await db.query<{ id: string }>(`select id from room where id = $1 and name <> ''`, [
    roomId,
  ]);
  if (!rooms[0]) return fail(400, "Ask from a room you have joined.");
  const standing = await db.query<{ user_id: string }>(
    `select user_id from room_member where room_id = $1 and user_id = $2`,
    [roomId, input.userId],
  );
  if (!standing[0]) return fail(400, "Ask from a room you have joined.");
  const audienceGate = await guardRoomAudience(db, {
    userId: input.userId,
    roomId,
    now: input.now,
    path: "group",
    detail: "request",
    actor: gated.actor,
  });
  if (!audienceGate.ok) {
    return { ok: false, status: audienceGate.status, error: audienceGate.error, code: audienceGate.code };
  }
  const roomBan = await openBan(db, input.userId, input.now, roomId);
  if (roomBan) return fail(403, "banned", roomBan);
  const groupId = groupIdFor(titled.text);
  if (!groupId || !ROOM_ID.test(groupId)) return fail(400, "Name the group.");
  if (await roomIdTaken(db, groupId)) return fail(400, "That name is already a room.");
  if (await groupExists(db, groupId)) return fail(409, "That group is already here.");
  const open = await db.query<{ id: string }>(
    `select id from theme_group_request where group_id = $1 and status = 'open'`,
    [groupId],
  );
  if (open[0]) return fail(409, "That group already has an open request.");
  const who = input.name.trim() || "Member";
  const id = randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `insert into theme_group_request
         (id, group_id, name, about, by_user_id, by_name, room_id, status, open_key, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'open', $2, $8)`,
        [id, groupId, titled.text, blurb.text, input.userId, who, roomId, input.now],
      );
      await writeLog(tx, {
        groupId,
        actorUserId: input.userId,
        actorName: who,
        action: "request",
        detail: titled.text,
        now: input.now,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "That group already has an open request.");
    throw error;
  }
  return {
    ok: true,
    value: {
      id,
      groupId,
      name: titled.text,
      about: blurb.text,
      by: who,
      roomId,
      status: "open",
      note: "",
      at: input.now.getTime(),
    },
  };
}

export async function decideGroupRequest(
  db: Db,
  input: {
    userId: string;
    name: string;
    requestId: string;
    decision: string;
    note: string;
    now: Date;
  },
): Promise<Result<{ request: GroupRequest; groupId: string | null }>> {
  const gated = await gate(db, input.userId, input.now);
  if (!gated.ok) return gated;
  if (!OBJECT_ID.test(input.requestId)) return fail(404, "That request is not open.");
  if (input.decision !== "approved" && input.decision !== "refused")
    return fail(400, "Approve or refuse the request.");
  const sentence = sentenceOrStop(input.note);
  if (!sentence.ok) return fail(400, sentence.error);
  const rows = await db.query<{
    id: string;
    group_id: string;
    name: string;
    about: string;
    by_user_id: string | null;
    by_name: string;
    room_id: string;
    status: string;
  }>(
    `select id, group_id, name, about, by_user_id, by_name, room_id, status
     from theme_group_request where id = $1`,
    [input.requestId],
  );
  const request = rows[0];
  if (!request || request.status !== "open") return fail(404, "That request is not open.");
  if (!stewardsRoom(gated.actor, request.room_id))
    return fail(403, "A steward of that room decides a group.");
  const audienceGate = await guardRoomAudience(db, {
    userId: input.userId,
    roomId: request.room_id,
    now: input.now,
    path: "group",
    moderate: true,
    detail: "decide",
    actor: gated.actor,
  });
  if (!audienceGate.ok) {
    return { ok: false, status: audienceGate.status, error: audienceGate.error, code: audienceGate.code };
  }
  if (request.by_user_id === input.userId) return fail(403, "Someone else decides a group.");
  if (input.decision === "approved" && request.by_user_id) {
    const barred = await openBan(db, request.by_user_id, input.now, request.room_id);
    if (barred) return fail(400, "That account is barred.");
  }
  const who = input.name.trim() || "Steward";
  try {
    const created = await db.transaction(async (tx) => {
      if (input.decision === "approved") {
        if (await roomIdTaken(tx, request.group_id))
          throw new Stop(400, "That name is already a room.");
        if (await groupExists(tx, request.group_id))
          throw new Stop(409, "That group is already here.");
        const source = await tx.query<{ audience: string }>(
          `select audience from room where id = $1`,
          [request.room_id],
        );
        const audience = parseAudience(source[0]?.audience) ?? "all";
        await tx.query(
          `insert into theme_group (id, name, about, created_at, audience, source_room_id)
           values ($1, $2, $3, $4, $5, $6)`,
          [request.group_id, request.name, request.about, input.now, audience, request.room_id],
        );
        if (request.by_user_id) {
          await tx.query(
            `insert into theme_group_member (group_id, user_id, joined_at) values ($1, $2, $3)
             on conflict do nothing`,
            [request.group_id, request.by_user_id, input.now],
          );
          await tx.query(
            `insert into theme_group_admin
             (group_id, user_id, granted_by_user_id, granted_by_name, created_at)
             values ($1, $2, $3, $4, $5)`,
            [request.group_id, request.by_user_id, input.userId, who, input.now],
          );
        }
      }
      await tx.query(
        `update theme_group_request
         set status = $2, open_key = null, decided_by_user_id = $3, decided_by_name = $4,
             decided_at = $5, note = $6
         where id = $1 and status = 'open'`,
        [request.id, input.decision, input.userId, who, input.now, sentence.text],
      );
      await writeLog(tx, {
        groupId: request.group_id,
        actorUserId: input.userId,
        actorName: who,
        action: input.decision === "approved" ? "approve" : "refuse",
        targetUserId: request.by_user_id,
        detail: sentence.text,
        now: input.now,
      });
      return input.decision === "approved" ? request.group_id : null;
    });
    return {
      ok: true,
      value: {
        groupId: created,
        request: {
          id: request.id,
          groupId: request.group_id,
          name: request.name,
          about: request.about,
          by: request.by_name,
          roomId: request.room_id,
          status: input.decision,
          note: sentence.text,
          at: input.now.getTime(),
        },
      },
    };
  } catch (error) {
    if (error instanceof Stop) return fail(error.status, error.message);
    if (isUniqueViolation(error)) return fail(409, "That group is already here.");
    throw error;
  }
}

export async function listGroupRequests(
  db: Db,
  userId: string,
  now: Date,
): Promise<Result<{ requests: GroupRequest[] }>> {
  const gated = await gate(db, userId, now);
  if (!gated.ok) return gated;
  const params: unknown[] = [];
  let where = "";
  if (!gated.actor.admin) {
    params.push(userId);
    const clauses = [`by_user_id = $1`];
    const groupIds = await stewardedGroupIds(db, userId);
    if (groupIds.length > 0) clauses.push(`group_id in (${inClause(params, groupIds)})`);
    if (gated.actor.stewardRooms.length > 0) {
      clauses.push(`room_id in (${inClause(params, gated.actor.stewardRooms)})`);
    }
    where = `where ${clauses.join(" or ")}`;
  }
  const rows = await db.query<{
    id: string;
    group_id: string;
    name: string;
    about: string;
    by_name: string;
    room_id: string;
    status: "open" | "approved" | "refused";
    note: string;
    created_at: Date | string;
  }>(
    `select id, group_id, name, about, by_name, room_id, status, note, created_at
     from theme_group_request
     ${where}
     order by created_at desc, id desc
     limit 100`,
    params,
  );
  return {
    ok: true,
    value: {
      requests: rows.map((row) => ({
        id: row.id,
        groupId: row.group_id,
        name: row.name,
        about: row.about,
        by: row.by_name,
        roomId: row.room_id,
        status: row.status,
        note: row.note,
        at: atMs(row.created_at),
      })),
    },
  };
}

async function loadPost(db: Db, postId: string): Promise<PostRow | null> {
  if (!OBJECT_ID.test(postId)) return null;
  const rows = await db.query<PostRow>(
    `select id, group_id, author_user_id, author_name, body, on_date, mark, removed, removed_for, created_at
     from theme_group_post where id = $1`,
    [postId],
  );
  return rows[0] ?? null;
}

export async function markGroupPost(
  db: Db,
  input: { userId: string; name: string; postId: string; mark: unknown; reason: string; now: Date },
): Promise<Result<{ post: GroupPost; row: GroupMark }>> {
  const gated = await gate(db, input.userId, input.now);
  if (!gated.ok) return gated;
  const sentence = sentenceOrStop(input.reason);
  if (!sentence.ok) return fail(400, sentence.error);
  const mark = input.mark === null || input.mark === "" ? null : input.mark;
  if (mark !== null && mark !== "sloppy" && mark !== "unsupported")
    return fail(400, "A mark is sloppy or unsupported.");
  const post = await loadPost(db, input.postId);
  if (!post || post.removed) return fail(404, "That post is not here.");
  const barred = await banFromSourceRooms(db, input.userId, post.group_id, input.now);
  if (barred) return fail(403, "banned", barred);
  if (!(await moderatesGroup(db, gated.actor, input.userId, post.group_id)))
    return fail(403, "Only a group admin or a steward of that group can mark a post.");
  const audienceGate = await guardGroupAudience(db, {
    userId: input.userId,
    groupId: post.group_id,
    now: input.now,
    moderate: true,
    detail: "mark",
    actor: gated.actor,
  });
  if (!audienceGate.ok) {
    return { ok: false, status: audienceGate.status, error: audienceGate.error, code: audienceGate.code };
  }
  const id = randomUUID();
  const who = input.name.trim() || "Admin";
  let saved: PostRow;
  try {
    saved = await db.transaction(async (tx) => {
      const updated = await tx.query<PostRow>(
        `update theme_group_post set mark = $2
       where id = $1 and removed = false
       returning id, group_id, author_user_id, author_name, body, on_date, mark, removed, removed_for, created_at`,
        [post.id, mark],
      );
      const row = updated[0];
      if (!row) throw new Stop(404, "That post is not here.");
      await tx.query(
        `insert into theme_group_mark
       (id, post_id, group_id, author_user_id, author_name, by_user_id, by_name, mark, reason, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          post.id,
          post.group_id,
          post.author_user_id,
          post.author_name,
          input.userId,
          who,
          mark,
          sentence.text,
          input.now,
        ],
      );
      await writeLog(tx, {
        groupId: post.group_id,
        actorUserId: input.userId,
        actorName: who,
        action: mark ? "mark" : "clear",
        postId: post.id,
        detail: sentence.text,
        now: input.now,
      });
      return row;
    });
  } catch (error) {
    if (error instanceof Stop) return fail(error.status, error.message);
    throw error;
  }
  console.log(JSON.stringify({ event: "group-post-marked", postId: post.id, mark }));
  return {
    ok: true,
    value: {
      post: toPost(saved),
      row: {
        id,
        postId: post.id,
        author: post.author_name,
        by: who,
        mark,
        reason: sentence.text,
        at: input.now.getTime(),
      },
    },
  };
}

export async function removeGroupPost(
  db: Db,
  input: { userId: string; name: string; postId: string; reason: string; now: Date },
): Promise<Result<{ removal: GroupRemoval }>> {
  const gated = await gate(db, input.userId, input.now);
  if (!gated.ok) return gated;
  if (!HARD.has(input.reason))
    return fail(
      400,
      "Name the rule: threat, pornography, child sexual abuse material, doxxing, or mocking God or Christ.",
    );
  const reason = input.reason as GroupRemoval["reason"];
  const post = await loadPost(db, input.postId);
  if (!post || post.removed) return fail(404, "That post is not here.");
  const barred = await banFromSourceRooms(db, input.userId, post.group_id, input.now);
  if (barred) return fail(403, "banned", barred);
  if (!(await moderatesGroup(db, gated.actor, input.userId, post.group_id)))
    return fail(403, "Only a group admin or a steward of that group can remove a post.");
  const audienceGate = await guardGroupAudience(db, {
    userId: input.userId,
    groupId: post.group_id,
    now: input.now,
    moderate: true,
    detail: "remove",
    actor: gated.actor,
  });
  if (!audienceGate.ok) {
    return { ok: false, status: audienceGate.status, error: audienceGate.error, code: audienceGate.code };
  }
  if (post.author_user_id) {
    const target = await actorRole(db, post.author_user_id);
    const groupSteward = await isGroupSteward(db, post.group_id, post.author_user_id);
    const blocked = moderationStop(gated.actor, {
      ...target,
      steward: target.steward || groupSteward,
    });
    if (blocked) return fail(403, blocked);
  }
  const who = input.name.trim() || "Admin";
  const removalId = randomUUID();
  try {
    await db.transaction(async (tx) => {
      const updated = await tx.query<{ id: string }>(
        `update theme_group_post set removed = true, removed_for = $2
         where id = $1 and removed = false
         returning id`,
        [post.id, reason],
      );
      if (!updated[0]) throw new Stop(404, "That post is not here.");
      await tx.query(
        `insert into theme_group_removal
         (id, post_id, group_id, author_user_id, author_name, by_user_id, by_name, reason, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          removalId,
          post.id,
          post.group_id,
          post.author_user_id,
          post.author_name,
          input.userId,
          who,
          reason,
          input.now,
        ],
      );
      await writeLog(tx, {
        groupId: post.group_id,
        actorUserId: input.userId,
        actorName: who,
        action: "remove",
        postId: post.id,
        targetUserId: post.author_user_id,
        detail: reason,
        now: input.now,
      });
    });
  } catch (error) {
    if (error instanceof Stop) return fail(error.status, error.message);
    throw error;
  }
  console.log(JSON.stringify({ event: "group-post-removed", postId: post.id, reason }));
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
    },
  };
}

export async function appealGroupPost(
  db: Db,
  input: { userId: string; name: string; postId: string; text: string; now: Date },
): Promise<Result<GroupAppeal>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can do that.");
  const post = await loadPost(db, input.postId);
  if (!post) return fail(404, "That post is not here.");
  if (post.author_user_id !== input.userId) return fail(403, "Only the author can appeal.");
  if (!post.mark && !post.removed) return fail(400, "There is nothing to appeal.");
  const open = await db.query<{ id: string }>(
    `select id from theme_group_appeal where post_id = $1 and status = 'open'`,
    [post.id],
  );
  if (open[0]) return fail(409, "That appeal is already with the stewards.");
  const body = englishText(input.text, 600, "Write the appeal.", "Keep it under 600 characters.");
  if (!body.ok) return fail(400, body.error);
  if (body.text.length < 8) return fail(400, "Write the appeal.");
  const who = input.name.trim() || "Member";
  const id = randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `insert into theme_group_appeal
         (id, post_id, group_id, by_user_id, by_name, body, status, open_key, created_at)
         values ($1, $2, $3, $4, $5, $6, 'open', $2, $7)`,
        [id, post.id, post.group_id, input.userId, who, body.text, input.now],
      );
      await writeLog(tx, {
        groupId: post.group_id,
        actorUserId: input.userId,
        actorName: who,
        action: "appeal",
        postId: post.id,
        detail: body.text,
        now: input.now,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "That appeal is already with the stewards.");
    throw error;
  }
  return {
    ok: true,
    value: {
      id,
      postId: post.id,
      groupId: post.group_id,
      by: who,
      text: body.text,
      status: "open",
      decidedBy: "",
      at: input.now.getTime(),
      decidedAt: null,
    },
  };
}

export async function decideGroupAppeal(
  db: Db,
  input: { userId: string; name: string; appealId: string; decision: string; now: Date },
): Promise<Result<{ appeal: GroupAppeal; post: GroupPost & { removed: boolean } }>> {
  const gated = await gate(db, input.userId, input.now);
  if (!gated.ok) return gated;
  if (!OBJECT_ID.test(input.appealId)) return fail(404, "That appeal is not open.");
  if (input.decision !== "upheld" && input.decision !== "lifted")
    return fail(400, "Uphold or lift the appeal.");
  const rows = await db.query<{
    id: string;
    post_id: string;
    group_id: string;
    by_user_id: string | null;
    by_name: string;
    body: string;
    status: string;
    created_at: Date | string;
  }>(
    `select id, post_id, group_id, by_user_id, by_name, body, status, created_at
     from theme_group_appeal where id = $1`,
    [input.appealId],
  );
  const appeal = rows[0];
  if (!appeal || appeal.status !== "open") return fail(404, "That appeal is not open.");
  const barred = await banFromSourceRooms(db, input.userId, appeal.group_id, input.now);
  if (barred) return fail(403, "banned", barred);
  if (!(await stewardOfGroup(db, gated.actor, input.userId, appeal.group_id)))
    return fail(403, "Only a steward can decide an appeal.");
  if (appeal.by_user_id === input.userId)
    return fail(403, "A steward does not decide their own appeal.");
  const post = await loadPost(db, appeal.post_id);
  if (!post) return fail(404, "That appeal is not open.");
  const who = input.name.trim() || "Steward";
  const saved = await db.transaction(async (tx) => {
    if (input.decision === "lifted") {
      await tx.query(
        `update theme_group_post
         set mark = null, removed = false, removed_for = null
         where id = $1`,
        [post.id],
      );
    }
    await tx.query(
      `update theme_group_appeal
       set status = $2, open_key = null, decided_by_user_id = $3, decided_by_name = $4, decided_at = $5
       where id = $1 and status = 'open'`,
      [appeal.id, input.decision, input.userId, who, input.now],
    );
    await writeLog(tx, {
      groupId: appeal.group_id,
      actorUserId: input.userId,
      actorName: who,
      action: input.decision === "lifted" ? "lift" : "uphold",
      postId: post.id,
      targetUserId: appeal.by_user_id,
      now: input.now,
    });
    const updated = await tx.query<PostRow>(
      `select id, group_id, author_user_id, author_name, body, on_date, mark, removed, removed_for, created_at
       from theme_group_post where id = $1`,
      [post.id],
    );
    return updated[0];
  });
  if (!saved) return fail(404, "That appeal is not open.");
  console.log(
    JSON.stringify({
      event: "group-appeal-decided",
      appealId: appeal.id,
      decision: input.decision,
    }),
  );
  return {
    ok: true,
    value: {
      appeal: {
        id: appeal.id,
        postId: appeal.post_id,
        groupId: appeal.group_id,
        by: appeal.by_name,
        text: appeal.body,
        status: input.decision,
        decidedBy: who,
        at: atMs(appeal.created_at),
        decidedAt: input.now.getTime(),
      },
      post: { ...toPost(saved), removed: flag(saved.removed) },
    },
  };
}

export async function listGroupAppeals(
  db: Db,
  userId: string,
  now: Date,
): Promise<Result<{ appeals: GroupAppeal[] }>> {
  const actor = await actorRole(db, userId);
  if (!actor.member) return fail(403, "Only a member can do that.");
  const ban = await openBan(db, userId, now);
  const params: unknown[] = [];
  let where = "";
  if (ban || !actor.admin) {
    params.push(userId);
    const clauses = [`by_user_id = $1`];
    if (!ban) {
      const groupIds = new Set(await stewardedGroupIds(db, userId));
      if (actor.stewardRooms.length > 0) {
        const roomParams: unknown[] = [];
        const linked = await db.query<{ group_id: string }>(
          `select distinct group_id from theme_group_request
           where status = 'approved' and room_id in (${inClause(roomParams, actor.stewardRooms)})`,
          roomParams,
        );
        for (const row of linked) groupIds.add(row.group_id);
      }
      if (groupIds.size > 0) clauses.push(`group_id in (${inClause(params, [...groupIds])})`);
    }
    where = `where ${clauses.join(" or ")}`;
  }
  const rows = await db.query<{
    id: string;
    post_id: string;
    group_id: string;
    by_name: string;
    body: string;
    status: "open" | "upheld" | "lifted";
    decided_by_name: string;
    created_at: Date | string;
    decided_at: Date | string | null;
  }>(
    `select id, post_id, group_id, by_name, body, status, decided_by_name, created_at, decided_at
     from theme_group_appeal
     ${where}
     order by created_at desc, id desc
     limit 200`,
    params,
  );
  return {
    ok: true,
    value: {
      appeals: rows.map((row) => ({
        id: row.id,
        postId: row.post_id,
        groupId: row.group_id,
        by: row.by_name,
        text: row.body,
        status: row.status,
        decidedBy: row.decided_by_name,
        at: atMs(row.created_at),
        decidedAt: row.decided_at ? atMs(row.decided_at) : null,
      })),
    },
  };
}

export async function listGroupLog(
  db: Db,
  userId: string,
  groupId: string,
  now: Date,
): Promise<Result<{ entries: GroupLogRow[] }>> {
  const gated = await gateGroup(db, userId, groupId, now);
  if (!gated.ok) return gated;
  if (!(await groupExists(db, groupId))) return fail(404, "That group is not here.");
  const admin = await isGroupAdmin(db, groupId, userId);
  if (!admin && !(await stewardOfGroup(db, gated.actor, userId, groupId)))
    return fail(403, "Only a group admin or a steward can read that log.");
  const rows = await db.query<{
    id: string;
    action: string;
    actor_name: string;
    detail: string;
    post_id: string | null;
    created_at: Date | string;
  }>(
    `select id, action, actor_name, detail, post_id, created_at
     from theme_group_log
     where group_id = $1
     order by created_at desc, id desc
     limit 200`,
    [groupId],
  );
  return {
    ok: true,
    value: {
      entries: rows.map((row) => ({
        id: row.id,
        action: row.action,
        actor: row.actor_name,
        detail: row.detail,
        at: atMs(row.created_at),
        ...(row.post_id ? { postId: row.post_id } : {}),
      })),
    },
  };
}
