import { randomUUID } from "node:crypto";
import { isUniqueViolation, type Db } from "../db.ts";
import { queryBanTable } from "./ban-check.ts";
import { banOpen } from "./ban.ts";
import { ruleId, type RuleId } from "./rule.ts";
import { ROOM_ID } from "../../src/lib/media/limits.ts";
import {
  planAdminGrant,
  planMemberGrant,
  planRevoke,
  planStewardGrant,
  type AccessRole,
  type LogRow,
} from "../../src/lib/board/access-rules.ts";
import {
  planCouncilApproval,
  planCouncilRevoke,
  type PostSubject,
} from "../../src/lib/board/council.ts";
import {
  HOME_SECTION_LABEL,
  normalizeZip,
  orderCouncilPosts,
  orderHomeRooms,
  resolvedTownId,
  type HomeAccessRow,
  type HomePayload,
  type HomeRequest,
  type HomeSection,
  type ScopedRoom,
  type ZipCorrectionRow,
  type ZipSeed,
} from "../../src/lib/board/home.ts";
import {
  planRoomDecision,
  planRoomRequest,
  planZipCorrection,
} from "../../src/lib/board/room-requests.ts";
import { actorRole, councilFlags } from "./access.ts";
import { filterAudience, guardRoomAudience, includeInCatalog } from "./audience.ts";

type Err = { ok: false; status: number; error: string; code?: string; audience?: "men" | "women" };
type Ok<T> = { ok: true; value: T };
export type PlaceResult<T> = Ok<T> | Err;

function fail(status: number, error: string): Err {
  return { ok: false, status, error };
}

export type CouncilMark = {
  label: "Council-approved";
  reason: string;
  checklist: string[];
  approvalId: string;
};

type Person = { id: string; name: string };

function atMs(value: Date | string | number): number {
  if (typeof value === "number") return value;
  return new Date(value).getTime();
}

/**
 * Home, vouching, a ZIP correction, and a room request look at site-wide bars only.
 * A room bar does not block those. A theme group approved from a room inherits
 * that room's bar on the group itself.
 */
async function openBan(
  db: Db,
  userId: string,
  now: Date,
): Promise<{ until: number; strikes: number; reason: RuleId } | null> {
  const rows = await queryBanTable<{ strikes: number; until_at: Date | string; reason: string }>(
    db,
    `select strikes, until_at, reason from board_ban
     where user_id = $1 and room_id = ''
     order by created_at desc`,
    [userId],
  );
  for (const row of rows) {
    const strikes = Number(row.strikes);
    const until = atMs(row.until_at);
    const reason = ruleId(row.reason);
    if (!banOpen({ reason, strikes, until }, now.getTime())) continue;
    return { until, strikes, reason };
  }
  return null;
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || !value.startsWith("{")) return [];
  const inner = value.slice(1, -1);
  if (!inner) return [];
  return inner.split(",").map((item) => item.replace(/^"|"$/g, "").replace(/\\"/g, '"'));
}

async function personByEmail(db: Db, email: string): Promise<Person | null> {
  const address = email.trim().toLowerCase();
  if (!address) return null;
  const rows = await db.query<Person>(`select id, name from "user" where lower(email) = $1`, [
    address,
  ]);
  return rows[0] ?? null;
}

async function personById(db: Db, id: string): Promise<Person | null> {
  const rows = await db.query<Person>(`select id, name from "user" where id = $1`, [id]);
  return rows[0] ?? null;
}

async function readLog(db: Db): Promise<LogRow[]> {
  const rows = await db.query<{
    id: string;
    user_id: string | null;
    role: string;
    room_id: string;
    action: string;
    at: Date | string;
  }>(`select id, user_id, role, room_id, action, at from access_log`);
  const out: LogRow[] = [];
  for (const row of rows) {
    if (!row.user_id) continue;
    if (row.role !== "member" && row.role !== "steward" && row.role !== "admin") continue;
    if (row.action !== "grant" && row.action !== "revoke") continue;
    out.push({
      id: row.id,
      userId: row.user_id,
      role: row.role,
      roomId: row.room_id,
      action: row.action,
      at: atMs(row.at),
    });
  }
  return out;
}

async function roomExists(db: Db, id: string): Promise<boolean> {
  if (!ROOM_ID.test(id)) return false;
  const rows = await db.query<{ id: string }>(`select id from room where id = $1 and name <> ''`, [
    id,
  ]);
  return Boolean(rows[0]);
}

async function isFounder(db: Db, userId: string): Promise<boolean> {
  const rows = await db.query<{ user_id: string }>(
    `select user_id from bootstrap_seat where id = 'founding' and user_id = $1`,
    [userId],
  );
  return Boolean(rows[0]);
}

async function writeGrant(
  db: Db,
  input: {
    plan: {
      action: "grant" | "revoke";
      role: AccessRole;
      roomId: string;
      targetId: string;
      vouchedByUserId: string;
      approvedByUserId: string;
      note: string;
    };
    actorName: string;
    now: Date;
  },
): Promise<void> {
  const target = await personById(db, input.plan.targetId);
  if (!target) throw new Error("missing target");
  const vouched = input.plan.vouchedByUserId
    ? ((await personById(db, input.plan.vouchedByUserId))?.name ?? "")
    : "";
  let vouchedBy = vouched;
  if (input.plan.action === "revoke") {
    const prior = await db.query<{ vouched_by: string }>(
      `select vouched_by from access_log
       where user_id = $1 and role = $2 and room_id = $3
       order by at desc, id desc limit 1`,
      [input.plan.targetId, input.plan.role, input.plan.roomId],
    );
    vouchedBy = prior[0]?.vouched_by ?? "";
  }
  const approved = input.plan.approvedByUserId
    ? ((await personById(db, input.plan.approvedByUserId))?.name ?? "")
    : "";
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      randomUUID(),
      target.id,
      target.name,
      input.plan.role,
      input.plan.roomId,
      input.plan.action,
      vouchedBy,
      approved,
      input.actorName,
      input.plan.note,
      input.now,
    ],
  );
  console.log(
    JSON.stringify({
      event: "access-changed",
      role: input.plan.role,
      action: input.plan.action,
      userId: target.id,
      roomId: input.plan.roomId,
    }),
  );
}

export async function grantAccess(
  db: Db,
  input: {
    userId: string;
    action: string;
    email: string;
    roomId: string;
    inviterEmail: string;
    stewardEmail: string;
    role: string;
    now: Date;
  },
): Promise<PlaceResult<{ action: "grant" | "revoke"; role: AccessRole }>> {
  const actor = await actorRole(db, input.userId);
  if (await openBan(db, input.userId, input.now)) return fail(403, "banned");
  if (!actor.member) return fail(403, "Only a member can change access.");
  const actorPerson = await personById(db, input.userId);
  if (!actorPerson) return fail(403, "Only a member can change access.");
  const target = await personByEmail(db, input.email);
  if (!target) return fail(404, "No member has that email.");
  const flags = await councilFlags(db, input.userId);
  try {
    const saved = await db.transaction(async (tx) => {
      const log = await readLog(tx);
      const action = input.action.trim();
      if (action === "grant-member") {
        if (!(await roomExists(tx, input.roomId.trim())))
          return fail(400, "That room is not here.");
        const planned = planMemberGrant(log, {
          inviterId: input.userId,
          targetId: target.id,
          roomId: input.roomId,
        });
        if (!planned.ok) return fail(400, planned.error);
        await writeGrant(tx, { plan: planned.plan, actorName: actorPerson.name, now: input.now });
        return { ok: true as const, value: { action: "grant" as const, role: "member" as const } };
      }
      if (action === "grant-steward") {
        if (!(await roomExists(tx, input.roomId.trim())))
          return fail(400, "That room is not here.");
        const inviter = await personByEmail(tx, input.inviterEmail);
        if (!inviter) return fail(404, "No member has that inviter email.");
        const planned = planStewardGrant(log, {
          approverId: input.userId,
          approverIsAdmin: actor.admin,
          approverIsChair: flags.chair,
          inviterId: inviter.id,
          targetId: target.id,
          roomId: input.roomId,
        });
        if (!planned.ok) return fail(400, planned.error);
        await writeGrant(tx, { plan: planned.plan, actorName: actorPerson.name, now: input.now });
        return { ok: true as const, value: { action: "grant" as const, role: "steward" as const } };
      }
      if (action === "grant-admin") {
        const steward = await personByEmail(tx, input.stewardEmail);
        if (!steward) return fail(404, "No member has that steward email.");
        const planned = planAdminGrant(log, {
          ownerId: input.userId,
          ownerIsAdmin: actor.admin,
          stewardId: steward.id,
          targetId: target.id,
          targetIsAdmin: (await actorRole(tx, target.id)).admin,
        });
        if (!planned.ok) return fail(400, planned.error);
        await writeGrant(tx, { plan: planned.plan, actorName: actorPerson.name, now: input.now });
        return { ok: true as const, value: { action: "grant" as const, role: "admin" as const } };
      }
      if (action === "revoke") {
        const named = input.role.trim();
        const role: AccessRole | null =
          named === "member" || named === "steward" || named === "admin" ? named : null;
        if (!role) return fail(400, "Name the role to revoke.");
        const planned = planRevoke(log, {
          actorId: input.userId,
          actorIsAdmin: actor.admin,
          targetId: target.id,
          targetIsFounder: await isFounder(tx, target.id),
          role,
          roomId: input.roomId,
        });
        if (!planned.ok) return fail(400, planned.error);
        await writeGrant(tx, { plan: planned.plan, actorName: actorPerson.name, now: input.now });
        return { ok: true as const, value: { action: "revoke" as const, role } };
      }
      return fail(
        400,
        "A steward needs the inviter and a steward of that room. An admin needs a steward and the role owner.",
      );
    });
    return saved;
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "That access was already recorded.");
    throw error;
  }
}

type ScopeRow = {
  id: string;
  name: string;
  scope_kind: string;
  town_id: string;
  congregation_id: string;
  region_id: string;
  sort_order: number | string;
  audience?: string | null;
};

function toScoped(row: ScopeRow): ScopedRoom {
  const scopeKind =
    row.scope_kind === "town" || row.scope_kind === "congregation" || row.scope_kind === "region"
      ? row.scope_kind
      : "topic";
  return {
    id: row.id,
    name: row.name,
    scopeKind,
    townId: row.town_id,
    congregationId: row.congregation_id,
    regionId: row.region_id,
    sortOrder: Number(row.sort_order),
    audience: row.audience === "men" || row.audience === "women" ? row.audience : "all",
  };
}

async function loadRooms(db: Db): Promise<ScopedRoom[]> {
  const rows = await db.query<ScopeRow>(
    `select id, name, scope_kind, town_id, congregation_id, region_id, sort_order, audience
     from room where name <> '' order by sort_order asc, id asc`,
  );
  return rows.map(toScoped);
}

export async function councilMarks(db: Db, postIds: string[]): Promise<Map<string, CouncilMark>> {
  const map = new Map<string, CouncilMark>();
  if (postIds.length === 0) return map;
  const slots = postIds.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await db.query<{
    id: string;
    post_id: string;
    reason: string;
    checklist: unknown;
    action: string;
  }>(
    `select distinct on (post_id) id, post_id, reason, checklist, action
     from council_approval
     where post_id in (${slots})
     order by post_id, at desc, id desc`,
    postIds,
  );
  for (const row of rows) {
    const checklist = textList(row.checklist);
    if (row.action !== "approve" || !row.reason.trim() || checklist.length === 0) continue;
    map.set(row.post_id, {
      label: "Council-approved",
      reason: row.reason.trim(),
      checklist,
      approvalId: row.id,
    });
  }
  return map;
}

export async function listHome(
  db: Db,
  userId: string,
  now: Date,
): Promise<PlaceResult<HomePayload>> {
  const actor = await actorRole(db, userId);
  if (!actor.member) return fail(403, "Only a member can read Home.");
  const ban = await openBan(db, userId, now);
  if (ban) return { ok: false, status: 403, error: "banned" };
  const place = await db.query<{ zip: string; congregation_id: string }>(
    `select zip, congregation_id from member_place where user_id = $1`,
    [userId],
  );
  const zip = place[0]?.zip ?? "";
  const congregationId = place[0]?.congregation_id ?? "";
  const congregations = await db.query<{ id: string; name: string }>(
    `select id, name from congregation order by name asc, id asc`,
  );
  const seedRows = zip
    ? await db.query<{ zip: string; town_id: string }>(
        `select zip, town_id from zip_town where zip = $1`,
        [zip],
      )
    : [];
  const seed: ZipSeed[] = seedRows.map((row) => ({ zip: row.zip, townId: row.town_id }));
  const corrections = zip
    ? await db.query<{ id: string; zip: string; town_id: string; at: Date | string }>(
        `select id, zip, town_id, at from zip_correction where zip = $1`,
        [zip],
      )
    : [];
  const correctionRows: ZipCorrectionRow[] = corrections.map((row) => ({
    id: row.id,
    zip: row.zip,
    townId: row.town_id,
    at: atMs(row.at),
  }));
  const townId = resolvedTownId(zip, seed, correctionRows);
  const townRows = townId
    ? await db.query<{ name: string }>(`select name from town where id = $1`, [townId])
    : [];
  const townName = townRows[0]?.name ?? "";
  const rooms = await loadRooms(db);
  const audience = await filterAudience(db, {
    userId,
    actor,
    rows: rooms,
    now,
    path: "list",
    moderate: true,
  });
  const readable = new Set(audience.visible.map((room) => room.id));
  const visible = new Set(
    rooms.filter((room) => includeInCatalog(audience.denied.get(room.id))).map((room) => room.id),
  );
  const joins = await db.query<{ room_id: string }>(
    `select room_id from room_join where user_id = $1`,
    [userId],
  );
  const ordered = orderHomeRooms({
    rooms,
    joined: joins.map((row) => row.room_id),
    townId,
    congregationId,
  });
  const approvalRows = await db.query<{
    id: string;
    post_id: string;
    reason: string;
    checklist: unknown;
    action: string;
  }>(
    `select distinct on (post_id) id, post_id, reason, checklist, action
     from council_approval
     order by post_id, at desc, id desc`,
  );
  const live = new Map<string, { id: string; reason: string; checklist: string[] }>();
  for (const row of approvalRows) {
    const checklist = textList(row.checklist);
    if (row.action !== "approve" || !row.reason.trim() || checklist.length === 0) continue;
    live.set(row.post_id, { id: row.id, reason: row.reason.trim(), checklist });
  }
  const liveIds = [...live.keys()];
  const postRows =
    liveIds.length === 0
      ? []
      : await db.query<{
          id: string;
          room_id: string;
          room_name: string;
          claim: string;
          author_name: string;
          subject: string | null;
          removed: boolean;
          parent_id: string | null;
          created_at: Date | string;
        }>(
          `select p.id, p.room_id, r.name as room_name, p.claim, p.author_name, p.subject,
                  p.removed, p.parent_id, p.created_at
           from board_post p
           join room r on r.id = p.room_id
           where p.id in (${liveIds.map((_, index) => `$${index + 1}`).join(", ")})
             and p.author_deleted_at is null
             and not exists (
               select 1 from "user" u
               where u.id = p.author_user_id and u.deactivated_at is not null
             )`,
          liveIds,
        );
  const lifted = orderCouncilPosts(
    postRows.map((row) => ({
      id: row.id,
      room: row.room_id,
      roomName: row.room_name,
      claim: row.claim,
      author: row.author_name,
      at: atMs(row.created_at),
      subject: row.subject,
      removed: row.removed,
      parentId: row.parent_id,
    })),
    live,
  ).filter((post) => readable.has(post.room));
  const sections: HomeSection[] = [];
  if (lifted.length > 0) {
    sections.push({
      tier: "council",
      label: HOME_SECTION_LABEL.council,
      posts: lifted.map((post) => ({
        id: post.id,
        room: post.room,
        roomName: post.roomName,
        claim: post.claim,
        author: post.author,
        at: post.at,
        subject: post.subject === "business" ? "business" : "candidate",
        reason: post.reason,
        checklist: post.checklist,
        label: post.label,
      })),
    });
  }
  for (const tier of ["joined", "town", "congregation", "region"] as const) {
    const tierRooms = ordered
      .filter((row) => row.tier === tier && visible.has(row.room.id))
      .map((row) => ({
        id: row.room.id,
        name: row.room.name,
        ...(row.room.audience === "men" || row.room.audience === "women"
          ? { audience: row.room.audience }
          : {}),
      }));
    if (tierRooms.length === 0) continue;
    sections.push({ tier, label: HOME_SECTION_LABEL[tier], rooms: tierRooms });
  }
  const requestRows = await db.query<{
    id: string;
    kind: string;
    name: string;
    state: string;
    by_name: string;
    status: string;
    note: string;
    by_user_id: string | null;
  }>(
    actor.admin
      ? `select id, kind, name, state, by_name, status, note, by_user_id
         from room_request
         where status = 'open' or by_user_id = $1
         order by at desc, id desc
         limit 40`
      : `select id, kind, name, state, by_name, status, note, by_user_id
         from room_request where by_user_id = $1
         order by at desc, id desc
         limit 40`,
    [userId],
  );
  const requests: HomeRequest[] = [];
  for (const row of requestRows) {
    if (row.kind !== "town" && row.kind !== "congregation" && row.kind !== "region") continue;
    if (row.status !== "open" && row.status !== "approved" && row.status !== "refused") continue;
    requests.push({
      id: row.id,
      kind: row.kind,
      name: row.name,
      state: row.state,
      by: row.by_name,
      status: row.status,
      note: row.note,
    });
  }
  let accessLog: HomeAccessRow[] = [];
  if (actor.admin) {
    const logRows = await db.query<{
      id: string;
      name: string;
      role: string;
      room_id: string;
      action: string;
      vouched_by: string;
      approved_by: string;
      note: string;
      at: Date | string;
    }>(
      `select id, name, role, room_id, action, vouched_by, approved_by, note, at
       from access_log order by at desc, id desc limit 40`,
    );
    accessLog = logRows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      roomId: row.room_id,
      action: row.action,
      vouchedBy: row.vouched_by,
      approvedBy: row.approved_by,
      note: row.note,
      at: atMs(row.at),
    }));
  }
  return {
    ok: true,
    value: { zip, townId, townName, congregationId, congregations, sections, requests, accessLog },
  };
}

export async function savePlace(
  db: Db,
  input: { userId: string; zip: string; congregationId: string; now: Date },
): Promise<PlaceResult<{ zip: string; congregationId: string }>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can set a place.");
  if (await openBan(db, input.userId, input.now)) return fail(403, "banned");
  const raw = input.zip.trim();
  const zip = raw ? normalizeZip(raw) : "";
  if (raw && !zip) return fail(400, "Enter a five-digit ZIP.");
  const congregationId = input.congregationId.trim();
  if (congregationId) {
    const known = await db.query<{ id: string }>(`select id from congregation where id = $1`, [
      congregationId,
    ]);
    if (!known[0]) return fail(400, "That congregation is not listed.");
  }
  await db.query(
    `insert into member_place (user_id, zip, congregation_id) values ($1, $2, $3)
     on conflict (user_id) do update set zip = excluded.zip, congregation_id = excluded.congregation_id`,
    [input.userId, zip, congregationId],
  );
  return { ok: true, value: { zip, congregationId } };
}

export async function joinRoom(
  db: Db,
  input: { userId: string; roomId: string; now: Date; leave?: boolean },
): Promise<PlaceResult<{ roomId: string; joined: boolean }>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can join a room.");
  if (await openBan(db, input.userId, input.now)) return fail(403, "banned");
  if (!(await roomExists(db, input.roomId))) return fail(404, "That room is not here.");
  if (!input.leave) {
    const gate = await guardRoomAudience(db, {
      userId: input.userId,
      roomId: input.roomId,
      now: input.now,
      path: "join",
      actor,
    });
    if (!gate.ok) {
      return {
        ok: false,
        status: gate.status,
        error: gate.error,
        ...(gate.code ? { code: gate.code } : {}),
        ...(gate.audience ? { audience: gate.audience } : {}),
      };
    }
  }
  if (input.leave) {
    await db.query(`delete from room_join where user_id = $1 and room_id = $2`, [
      input.userId,
      input.roomId,
    ]);
    return { ok: true, value: { roomId: input.roomId, joined: false } };
  }
  await db.query(
    `insert into room_join (user_id, room_id, joined_at) values ($1, $2, $3)
     on conflict do nothing`,
    [input.userId, input.roomId, input.now],
  );
  return { ok: true, value: { roomId: input.roomId, joined: true } };
}

export async function requestRoom(
  db: Db,
  input: { userId: string; kind: string; name: string; state: string; now: Date },
): Promise<PlaceResult<{ id: string }>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "A member asks for a room.");
  if (await openBan(db, input.userId, input.now)) return fail(403, "banned");
  const who = await personById(db, input.userId);
  if (!who) return fail(403, "A member asks for a room.");
  const rooms = await loadRooms(db);
  const open = await db.query<{
    kind: string;
    town_id: string;
    congregation_id: string;
    region_id: string;
  }>(`select kind, town_id, congregation_id, region_id from room_request where status = 'open'`);
  const planned = planRoomRequest({
    kind: input.kind,
    name: input.name,
    state: input.state,
    takenRoomIds: rooms.map((room) => room.id),
    takenTownIds: rooms.flatMap((room) => (room.scopeKind === "town" ? [room.townId] : [])),
    takenCongregationIds: rooms.flatMap((room) =>
      room.scopeKind === "congregation" ? [room.congregationId] : [],
    ),
    takenRegionIds: rooms.flatMap((room) => (room.scopeKind === "region" ? [room.regionId] : [])),
    openTownIds: open.flatMap((row) => (row.kind === "town" ? [row.town_id] : [])),
    openCongregationIds: open.flatMap((row) =>
      row.kind === "congregation" ? [row.congregation_id] : [],
    ),
    openRegionIds: open.flatMap((row) => (row.kind === "region" ? [row.region_id] : [])),
  });
  if (!planned.ok) return fail(400, planned.error);
  const id = randomUUID();
  try {
    await db.query(
      `insert into room_request
       (id, kind, town_id, congregation_id, region_id, name, state, by_user_id, by_name, at, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open')`,
      [
        id,
        planned.draft.kind,
        planned.draft.townId,
        planned.draft.congregationId,
        planned.draft.regionId,
        planned.draft.name,
        planned.draft.state,
        who.id,
        who.name,
        input.now,
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "That place already has an open request.");
    throw error;
  }
  return { ok: true, value: { id } };
}

function roomShape(kind: "town" | "congregation" | "region", name: string, state: string) {
  if (kind === "congregation") {
    return {
      what: `Service times, the meal after, and families who need meals this week at ${name}.`,
      takes: ["hosted"],
      cardKinds: ["meeting", "need"],
      cardNoun: "Service",
      parish: true,
    };
  }
  if (kind === "region") {
    return {
      what: `${name}. Hearings, bills, and candidate events, labeled as such.`,
      takes: ["did", "asked", "hosted"],
      cardKinds: ["meeting", "candidate"],
      cardNoun: "Meeting",
      parish: false,
    };
  }
  return {
    what: `Meetings and local notices for ${name}, ${state}.`,
    takes: ["did", "asked", "hosted"],
    cardKinds: ["meeting"],
    cardNoun: "Meeting",
    parish: false,
  };
}

export async function decideRoom(
  db: Db,
  input: { userId: string; requestId: string; decision: string; note: string; now: Date },
): Promise<PlaceResult<{ status: "approved" | "refused"; roomId: string | null }>> {
  const actor = await actorRole(db, input.userId);
  if (await openBan(db, input.userId, input.now)) return fail(403, "banned");
  const who = await personById(db, input.userId);
  if (!who) return fail(403, "An admin decides a room request.");
  const rows = await db.query<{
    id: string;
    kind: string;
    town_id: string;
    congregation_id: string;
    region_id: string;
    name: string;
    state: string;
    by_user_id: string | null;
    status: string;
  }>(
    `select id, kind, town_id, congregation_id, region_id, name, state, by_user_id, status
     from room_request where id = $1`,
    [input.requestId],
  );
  const request = rows[0];
  if (!request) return fail(404, "That request is not here.");
  const planned = planRoomDecision({
    admin: actor.admin,
    actorId: input.userId,
    requesterId: request.by_user_id ?? "",
    open: request.status === "open",
    decision: input.decision,
    note: input.note,
  });
  if (!planned.ok)
    return fail(planned.error === "An admin decides a room request." ? 403 : 400, planned.error);
  if (planned.decision === "refused") {
    const updated = await db.query<{ id: string }>(
      `update room_request
       set status = 'refused', decided_by_user_id = $2, decided_by_name = $3, decided_at = $4, note = $5
       where id = $1 and status = 'open'
       returning id`,
      [request.id, who.id, who.name, input.now, planned.note],
    );
    if (!updated[0]) return fail(409, "That request is not open.");
    return { ok: true, value: { status: "refused", roomId: null } };
  }
  const kind = request.kind === "congregation" || request.kind === "region" ? request.kind : "town";
  const slug =
    kind === "town"
      ? request.town_id
      : kind === "congregation"
        ? request.congregation_id
        : request.region_id;
  const roomId = `${kind === "town" ? "town" : kind === "congregation" ? "cong" : "region"}-${slug}`;
  if (!ROOM_ID.test(roomId)) return fail(400, "Use a shorter name.");
  const shape = roomShape(kind, request.name, request.state);
  const order = await db.query<{ next: number }>(
    `select coalesce(max(sort_order), 0) + 1 as next from room`,
  );
  try {
    await db.transaction(async (tx) => {
      if (kind === "town") {
        await tx.query(
          `insert into town (id, name, state) values ($1, $2, $3) on conflict (id) do nothing`,
          [request.town_id, request.name, request.state],
        );
      }
      if (kind === "congregation") {
        await tx.query(
          `insert into congregation (id, name) values ($1, $2) on conflict (id) do nothing`,
          [request.congregation_id, request.name],
        );
      }
      await tx.query(
        `insert into room (
           id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish,
           sort_order, created_by, created_at, scope_kind, town_id, congregation_id, region_id
         ) values (
           $1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10, $11, $12, $13, $14, $15
         )`,
        [
          roomId,
          kind === "town" ? `${request.name} town room` : request.name,
          shape.what,
          shape.takes,
          ["noted"],
          shape.cardKinds,
          shape.cardNoun,
          shape.parish,
          Number(order[0]?.next ?? 100),
          who.id,
          input.now,
          kind,
          kind === "town" ? request.town_id : "",
          kind === "congregation" ? request.congregation_id : "",
          kind === "region" ? request.region_id : "",
        ],
      );
      const updated = await tx.query<{ id: string }>(
        `update room_request
         set status = 'approved', decided_by_user_id = $2, decided_by_name = $3, decided_at = $4,
             note = $5, room_id = $6
         where id = $1 and status = 'open'
         returning id`,
        [request.id, who.id, who.name, input.now, planned.note, roomId],
      );
      if (!updated[0]) throw new Error("request-closed");
    });
  } catch (error) {
    if (error instanceof Error && error.message === "request-closed") {
      return fail(409, "That request is not open.");
    }
    if (isUniqueViolation(error)) return fail(409, "That place already has a room.");
    throw error;
  }
  return { ok: true, value: { status: "approved", roomId } };
}

export async function correctZip(
  db: Db,
  input: { userId: string; zip: string; name: string; state: string; clear: boolean; now: Date },
): Promise<PlaceResult<{ zip: string; townId: string }>> {
  const actor = await actorRole(db, input.userId);
  if (await openBan(db, input.userId, input.now)) return fail(403, "banned");
  const who = await personById(db, input.userId);
  const planned = planZipCorrection({
    admin: actor.admin,
    zip: input.zip,
    name: input.name,
    state: input.state,
    clear: input.clear,
  });
  if (!planned.ok)
    return fail(planned.error === "Only an admin can correct a ZIP." ? 403 : 400, planned.error);
  if (!who) return fail(403, "Only an admin can correct a ZIP.");
  if (planned.townId) {
    await db.query(
      `insert into town (id, name, state) values ($1, $2, $3) on conflict (id) do nothing`,
      [planned.townId, planned.name, planned.state],
    );
  }
  await db.query(
    `insert into zip_correction (id, zip, town_id, name, state, by_user_id, by_name, at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      planned.zip,
      planned.townId,
      planned.name,
      planned.state,
      who.id,
      who.name,
      input.now,
    ],
  );
  return { ok: true, value: { zip: planned.zip, townId: planned.townId } };
}

type ApprovalPost = {
  id: string;
  subject: string | null;
  removed: boolean;
  parent_id: string | null;
  author_user_id: string | null;
};

async function approvalTarget(db: Db, postId: string): Promise<ApprovalPost | null> {
  const rows = await db.query<ApprovalPost>(
    `select id, subject, removed, parent_id, author_user_id from board_post where id = $1`,
    [postId],
  );
  return rows[0] ?? null;
}

export async function setCouncil(
  db: Db,
  input: {
    userId: string;
    postId: string;
    action: string;
    reason: string;
    checklist: string[];
    now: Date;
  },
): Promise<PlaceResult<CouncilMark | { revoked: true }>> {
  const actor = await actorRole(db, input.userId);
  if (await openBan(db, input.userId, input.now)) return fail(403, "banned");
  const who = await personById(db, input.userId);
  if (!who) return fail(403, "Sign in first.");
  const flags = await councilFlags(db, input.userId);
  const post = await approvalTarget(db, input.postId);
  if (!post) return fail(404, "That post is not on the board.");
  const marks = await councilMarks(db, [post.id]);
  const live = marks.get(post.id);
  if (input.action === "revoke") {
    const planned = planCouncilRevoke({ admin: actor.admin, live: Boolean(live) });
    if (!planned.ok)
      return fail(planned.error.startsWith("Only an admin") ? 403 : 400, planned.error);
    if (!live) return fail(400, "There is no live approval to revoke.");
    await db.query(
      `insert into council_approval
       (id, post_id, reason, checklist, by_user_id, by_name, action, at)
       values ($1, $2, $3, $4, $5, $6, 'revoke', $7)`,
      [randomUUID(), post.id, live.reason, live.checklist, who.id, who.name, input.now],
    );
    console.log(JSON.stringify({ event: "council-revoked", postId: post.id }));
    return { ok: true, value: { revoked: true } };
  }
  if (input.action !== "approve") return fail(400, "Approve the post or revoke the approval.");
  const subject: PostSubject | null =
    post.subject === "candidate" || post.subject === "business" ? post.subject : null;
  const planned = planCouncilApproval({
    council: flags.council,
    subject,
    removed: post.removed,
    reply: Boolean(post.parent_id),
    live: Boolean(live),
    reason: input.reason,
    checklist: input.checklist,
  });
  if (!planned.ok) {
    return fail(planned.error.startsWith("Only a council") ? 403 : 400, planned.error);
  }
  const id = randomUUID();
  await db.query(
    `insert into council_approval
     (id, post_id, reason, checklist, by_user_id, by_name, action, at)
     values ($1, $2, $3, $4, $5, $6, 'approve', $7)`,
    [id, post.id, planned.reason, planned.checklist, who.id, who.name, input.now],
  );
  console.log(JSON.stringify({ event: "council-approved", postId: post.id, approvalId: id }));
  return {
    ok: true,
    value: {
      label: "Council-approved",
      reason: planned.reason,
      checklist: planned.checklist,
      approvalId: id,
    },
  };
}
