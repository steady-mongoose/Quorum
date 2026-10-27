import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import { actorRole, stewardsRoom, type BoardActor } from "./access.ts";
import { approvedRoomIds } from "./group-rooms.ts";
import {
  GENDER_POLICY,
  audienceDecision,
  genderWriteDecision,
  isRoomHost,
  parseAudience,
  parseGender,
  type Audience,
  type AudienceCode,
  type Gender,
  type GenderPolicy,
} from "../gender-policy.ts";

export type AudiencePath =
  "list" | "read" | "join" | "post" | "calls" | "chat" | "invite" | "group";

export type AudienceDenial = {
  ok: false;
  status: 403 | 404;
  error: string;
  /** Omitted when the member's gender does not match, so the response matches a missing room. */
  code?: AudienceCode;
  /** Present for a prompt the member can answer. Omitted on a mismatch. */
  audience?: "men" | "women";
};

export type GenderResult<T> =
  { ok: true; value: T } | { ok: false; status: number; error: string; code?: AudienceCode };

type AuditAction =
  | "set-gender"
  | "change-gender"
  | "confirm-gender"
  | "set-audience"
  | "audience-override"
  | "set-birthdate"
  | "change-birthdate"
  | "correction-request"
  | "correction-refuse";

function denial(
  path: AudiencePath,
  code: AudienceCode,
  error: string,
  audience: Audience,
): AudienceDenial {
  if (code === "audience") {
    return {
      ok: false,
      status: 404,
      error: path === "group" ? "That group is not here." : "That room is not here.",
    };
  }
  return {
    ok: false,
    status: 403,
    error,
    code,
    ...(audience === "men" || audience === "women" ? { audience } : {}),
  };
}

/** A room stays in the catalog when the member still has to state or confirm a gender. */
export function includeInCatalog(denial: AudienceDenial | undefined): boolean {
  if (!denial) return true;
  return denial.code === "gender-unstated" || denial.code === "gender-unconfirmed";
}

export async function statedGender(
  db: Db,
  userId: string,
): Promise<{ stated: Gender | null; confirmed: boolean }> {
  const rows = await db.query<{ gender: string | null; gender_confirmed_at: Date | string | null }>(
    `select gender, gender_confirmed_at from members where user_id = $1`,
    [userId],
  );
  const row = rows[0];
  const stated = parseGender(row?.gender);
  return { stated, confirmed: Boolean(row?.gender_confirmed_at) };
}

export async function writeGenderAudit(
  db: Db,
  input: {
    actorUserId: string;
    subjectUserId?: string | null;
    roomId?: string;
    action: AuditAction;
    path?: string;
    detail?: string;
    now: Date;
  },
): Promise<void> {
  await db.query(
    `insert into gender_audit
     (id, actor_user_id, subject_user_id, room_id, action, path, detail, at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      input.actorUserId,
      input.subjectUserId ?? null,
      input.roomId ?? "",
      input.action,
      input.path ?? "",
      input.detail ?? "",
      input.now,
    ],
  );
}

async function actorOrLoad(db: Db, userId: string, actor?: BoardActor): Promise<BoardActor> {
  if (actor) return actor;
  return actorRole(db, userId);
}

/**
 * Keep rows the member may see. A steward who does not match is kept only
 * when `moderate` is set. That pass is written to gender_audit only when
 * `record` is set, which is an action taken, not a list.
 * Rooms for everyone skip the member lookup.
 */
export async function filterAudience<T extends { id: string; audience?: string | null }>(
  db: Db,
  input: {
    userId: string;
    rows: T[];
    now: Date;
    path: AudiencePath;
    moderate: boolean;
    /** Write audience-override rows. List and read leave this unset. */
    record?: boolean;
    actor?: BoardActor;
    roomIdOf?: (row: T) => string;
    detailOf?: (row: T) => string;
    policy?: GenderPolicy;
  },
): Promise<{ visible: T[]; denied: Map<string, AudienceDenial> }> {
  const denied = new Map<string, AudienceDenial>();
  const roomIdOf = input.roomIdOf ?? ((row: T) => row.id);
  const detailOf = input.detailOf ?? (() => "");
  const policy = input.policy ?? GENDER_POLICY;
  const restricted = input.rows.some((row) => (parseAudience(row.audience) ?? "all") !== "all");
  if (!restricted) return { visible: input.rows, denied };

  const actor = await actorOrLoad(db, input.userId, input.actor);
  const gender = await statedGender(db, input.userId);
  const visible: T[] = [];
  const overrides: T[] = [];
  for (const row of input.rows) {
    const audience = parseAudience(row.audience) ?? "all";
    const roomId = roomIdOf(row);
    const decision = audienceDecision(
      {
        audience,
        stated: gender.stated,
        confirmed: gender.confirmed,
        canModerate: input.moderate && stewardsRoom(actor, roomId),
      },
      policy,
    );
    if (decision.allow) {
      visible.push(row);
      if (decision.override) overrides.push(row);
      continue;
    }
    denied.set(row.id, denial(input.path, decision.code, decision.error, audience));
  }
  if (input.record) {
    for (const row of overrides) {
      await writeGenderAudit(db, {
        actorUserId: input.userId,
        subjectUserId: input.userId,
        roomId: roomIdOf(row),
        action: "audience-override",
        path: input.path,
        detail: detailOf(row),
        now: input.now,
      });
    }
  }
  return { visible, denied };
}

/** One room. A missing room is allowed so the caller can answer 404. */
export async function guardRoomAudience(
  db: Db,
  input: {
    userId: string;
    roomId: string;
    now: Date;
    path: AudiencePath;
    moderate?: boolean;
    record?: boolean;
    detail?: string;
    actor?: BoardActor;
    policy?: GenderPolicy;
  },
): Promise<{ ok: true } | AudienceDenial> {
  const rows = await db.query<{ audience: string }>(
    `select audience from room where id = $1 and name <> ''`,
    [input.roomId],
  );
  const row = rows[0];
  if (!row) return { ok: true };
  const split = await filterAudience(db, {
    userId: input.userId,
    actor: input.actor,
    rows: [{ id: input.roomId, audience: row.audience }],
    now: input.now,
    path: input.path,
    moderate: input.moderate === true,
    record: input.record === true,
    detailOf: () => input.detail ?? "",
    policy: input.policy,
  });
  return split.denied.get(input.roomId) ?? { ok: true };
}

type GroupSource = { roomId: string; audience: Audience };

async function groupFacts(
  db: Db,
  groupIds: string[],
): Promise<Map<string, { column: Audience; sources: GroupSource[] }>> {
  const facts = new Map<string, { column: Audience; sources: GroupSource[] }>();
  if (groupIds.length === 0) return facts;
  const columns = await db.query<{ id: string; audience: string }>(
    `select id, audience from theme_group where id = any($1::text[])`,
    [groupIds],
  );
  for (const row of columns) {
    facts.set(row.id, { column: parseAudience(row.audience) ?? "all", sources: [] });
  }
  const requests = await db.query<{ group_id: string; room_id: string }>(
    `select distinct group_id, room_id from theme_group_request
     where status = 'approved' and room_id <> '' and group_id = any($1::text[])`,
    [groupIds],
  );
  const roomIds = [...new Set(requests.map((row) => row.room_id))];
  const rooms =
    roomIds.length === 0
      ? []
      : await db.query<{ id: string; audience: string }>(
          `select id, audience from room where name <> '' and id = any($1::text[])`,
          [roomIds],
        );
  const live = new Map(rooms.map((row) => [row.id, parseAudience(row.audience) ?? "all"]));
  for (const request of requests) {
    const fact = facts.get(request.group_id);
    if (!fact) continue;
    const audience = live.get(request.room_id);
    if (!audience) continue;
    fact.sources.push({ roomId: request.room_id, audience });
  }
  return facts;
}

function displayAudience(column: Audience, sources: GroupSource[]): Audience {
  if (sources.length === 0) return column;
  const restricted = [
    ...new Set(sources.map((source) => source.audience).filter((item) => item !== "all")),
  ];
  if (restricted.length === 1) return restricted[0] ?? "all";
  return "all";
}

/**
 * A group with an approved source room uses that room's audience as it is now.
 * A group with no source room uses the audience stored on the group, which
 * defaults to everyone.
 */
export async function filterGroups<T extends { id: string }>(
  db: Db,
  input: {
    userId: string;
    rows: T[];
    now: Date;
    moderate: boolean;
    record?: boolean;
    actor?: BoardActor;
    detailOf?: (row: T) => string;
    policy?: GenderPolicy;
  },
): Promise<{ visible: Array<T & { audience: Audience }>; denied: Map<string, AudienceDenial> }> {
  const denied = new Map<string, AudienceDenial>();
  const facts = await groupFacts(
    db,
    input.rows.map((row) => row.id),
  );
  const decorated = input.rows.map((row) => {
    const fact = facts.get(row.id) ?? { column: "all" as Audience, sources: [] };
    return { row, fact, audience: displayAudience(fact.column, fact.sources) };
  });
  const restricted = decorated.some(
    (item) =>
      item.audience !== "all" || item.fact.sources.some((source) => source.audience !== "all"),
  );
  if (!restricted) {
    return { visible: decorated.map((item) => ({ ...item.row, audience: item.audience })), denied };
  }
  const actor = await actorOrLoad(db, input.userId, input.actor);
  const gender = await statedGender(db, input.userId);
  const policy = input.policy ?? GENDER_POLICY;
  const detailOf = input.detailOf ?? ((row: T) => row.id);
  const visible: Array<T & { audience: Audience }> = [];
  for (const item of decorated) {
    const checks =
      item.fact.sources.length > 0
        ? item.fact.sources
        : [{ roomId: "", audience: item.fact.column }];
    let blocked: AudienceDenial | null = null;
    const overrides: GroupSource[] = [];
    for (const source of checks) {
      const decision = audienceDecision(
        {
          audience: source.audience,
          stated: gender.stated,
          confirmed: gender.confirmed,
          canModerate: input.moderate && stewardsRoom(actor, source.roomId),
        },
        policy,
      );
      if (!decision.allow) {
        blocked = denial("group", decision.code, decision.error, source.audience);
        break;
      }
      if (decision.override) overrides.push(source);
    }
    if (blocked) {
      denied.set(item.row.id, blocked);
      continue;
    }
    visible.push({ ...item.row, audience: item.audience });
    if (input.record) {
      for (const source of overrides) {
        await writeGenderAudit(db, {
          actorUserId: input.userId,
          subjectUserId: input.userId,
          roomId: source.roomId,
          action: "audience-override",
          path: "group",
          detail: detailOf(item.row),
          now: input.now,
        });
      }
    }
  }
  return { visible, denied };
}

/** Live audience of one group. Missing groups return null. */
export async function displayedGroupAudience(db: Db, groupId: string): Promise<Audience | null> {
  const facts = await groupFacts(db, [groupId]);
  const fact = facts.get(groupId);
  if (!fact) return null;
  return displayAudience(fact.column, fact.sources);
}

export async function groupFollowsRoom(db: Db, groupId: string): Promise<boolean> {
  const sources = await approvedRoomIds(db, groupId);
  return sources.length > 0;
}

/** Every path reads the source room now, the same way a ban does. */
export async function guardGroupAudience(
  db: Db,
  input: {
    userId: string;
    groupId: string;
    now: Date;
    moderate?: boolean;
    record?: boolean;
    detail?: string;
    actor?: BoardActor;
    policy?: GenderPolicy;
  },
): Promise<{ ok: true } | AudienceDenial> {
  const rows = await db.query<{ id: string }>(`select id from theme_group where id = $1`, [
    input.groupId,
  ]);
  if (!rows[0]) return { ok: true };
  const split = await filterGroups(db, {
    userId: input.userId,
    actor: input.actor,
    rows: [{ id: input.groupId }],
    now: input.now,
    moderate: input.moderate === true,
    record: input.record === true,
    detailOf: () => input.detail || input.groupId,
    policy: input.policy,
  });
  return split.denied.get(input.groupId) ?? { ok: true };
}

export async function roomAudience(db: Db, roomId: string): Promise<Audience | null> {
  if (!roomId) return null;
  const rows = await db.query<{ audience: string }>(
    `select audience from room where id = $1 and name <> ''`,
    [roomId],
  );
  const audience = rows[0]?.audience;
  if (!audience) return null;
  return parseAudience(audience) ?? "all";
}

async function subjectIsMember(db: Db, userId: string): Promise<boolean> {
  const actor = await actorRole(db, userId);
  return actor.member;
}

/**
 * Records a member's first stated gender. It never changes one that is set:
 * that goes through an admin-reviewed correction request.
 */
export async function setMemberGender(
  db: Db,
  input: {
    actorUserId: string;
    subjectUserId: string;
    gender: unknown;
    now: Date;
    policy?: GenderPolicy;
  },
): Promise<GenderResult<{ gender: Gender }>> {
  const next = parseGender(input.gender);
  if (!next) return { ok: false, status: 400, error: "Say whether you are a man or a woman." };
  const policy = input.policy ?? GENDER_POLICY;
  const actor = await actorRole(db, input.actorUserId);
  if (!actor.member) return { ok: false, status: 403, error: "Only a member can do that." };
  if (!(await subjectIsMember(db, input.subjectUserId))) {
    return { ok: false, status: 404, error: "That person is not a member." };
  }
  const current = await statedGender(db, input.subjectUserId);
  const invited = await db.query<{ invited_by_user_id: string | null }>(
    `select invited_by_user_id from invite_redemption where invited_user_id = $1`,
    [input.subjectUserId],
  );
  const inviterId = invited[0]?.invited_by_user_id ?? "";
  const decision = genderWriteDecision(
    {
      current: current.stated,
      next,
      actorIsSubject: input.actorUserId === input.subjectUserId,
      actorIsInviter: inviterId !== "" && inviterId === input.actorUserId,
      actorHasNoInviter: invited.length === 0 || inviterId === "",
      actorIsSteward: actor.admin || actor.stewardRooms.length > 0,
      actorIsAdmin: actor.admin,
    },
    policy,
  );
  if (!decision.ok) return decision;
  if (decision.kind === "same") return { ok: true, value: { gender: next } };
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into members (user_id, gender, gender_confirmed_by, gender_confirmed_at, display_name)
       values (
         $1,
         $2,
         null,
         null,
         coalesce(
           (select left(nullif(trim(name), ''), 80) from "user" where id = $1),
           'Member'
         )
       )
       on conflict (user_id) do update
         set gender = excluded.gender,
             gender_confirmed_by = null,
             gender_confirmed_at = null`,
      [input.subjectUserId, next],
    );
    await writeGenderAudit(tx, {
      actorUserId: input.actorUserId,
      subjectUserId: input.subjectUserId,
      action: "set-gender",
      detail: current.stated ? `${current.stated} -> ${next}` : next,
      now: input.now,
    });
  });
  return { ok: true, value: { gender: next } };
}

export async function confirmMemberGender(
  db: Db,
  input: {
    actorUserId: string;
    subjectUserId: string;
    now: Date;
    policy?: GenderPolicy;
  },
): Promise<GenderResult<{ gender: Gender }>> {
  const policy = input.policy ?? GENDER_POLICY;
  if (!policy.GENDER_REQUIRES_CONFIRMATION) {
    return { ok: false, status: 400, error: "That does not need confirmation." };
  }
  if (input.actorUserId === input.subjectUserId) {
    return { ok: false, status: 403, error: "Someone else confirms it." };
  }
  const actor = await actorRole(db, input.actorUserId);
  if (!actor.member) return { ok: false, status: 403, error: "Only a member can do that." };
  if (!(actor.admin || actor.stewardRooms.length > 0)) {
    return { ok: false, status: 403, error: "A steward confirms it." };
  }
  const current = await statedGender(db, input.subjectUserId);
  if (!current.stated) return { ok: false, status: 400, error: "Nothing is stated yet." };
  await db.transaction(async (tx) => {
    await tx.query(
      `update members
       set gender_confirmed_by = $2, gender_confirmed_at = $3
       where user_id = $1 and gender is not null`,
      [input.subjectUserId, input.actorUserId, input.now],
    );
    await writeGenderAudit(tx, {
      actorUserId: input.actorUserId,
      subjectUserId: input.subjectUserId,
      action: "confirm-gender",
      detail: current.stated ?? "",
      now: input.now,
    });
  });
  return { ok: true, value: { gender: current.stated } };
}

export async function setRoomAudience(
  db: Db,
  input: { userId: string; roomId: string; audience: unknown; now: Date },
): Promise<GenderResult<{ audience: Audience }>> {
  const next = parseAudience(input.audience);
  if (!next) return { ok: false, status: 400, error: "Choose everyone, men, or women." };
  const rows = await db.query<{ audience: string; created_by: string | null }>(
    `select audience, created_by from room where id = $1 and name <> ''`,
    [input.roomId],
  );
  const room = rows[0];
  if (!room) return { ok: false, status: 404, error: "That room is not here." };
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return { ok: false, status: 403, error: "Only a member can do that." };
  if (!isRoomHost({ createdBy: room.created_by, userId: input.userId, admin: actor.admin })) {
    return { ok: false, status: 403, error: "The host sets who the room is for." };
  }
  const current = parseAudience(room.audience) ?? "all";
  if (current === next) return { ok: true, value: { audience: next } };
  await db.transaction(async (tx) => {
    await tx.query(`update room set audience = $2 where id = $1`, [input.roomId, next]);
    if (next !== "all") {
      await tx.query(
        `update public_gathering set shared = false, updated_at = now()
         where room_id = $1 and shared = true`,
        [input.roomId],
      );
    }
    await writeGenderAudit(tx, {
      actorUserId: input.userId,
      roomId: input.roomId,
      action: "set-audience",
      detail: `${current} -> ${next}`,
      now: input.now,
    });
  });
  return { ok: true, value: { audience: next } };
}

/** An admin sets the audience of a group that has no source room. */
export async function setGroupAudience(
  db: Db,
  input: { userId: string; groupId: string; audience: unknown; now: Date },
): Promise<GenderResult<{ audience: Audience }>> {
  const next = parseAudience(input.audience);
  if (!next) return { ok: false, status: 400, error: "Choose everyone, men, or women." };
  const rows = await db.query<{ id: string; audience: string }>(
    `select id, audience from theme_group where id = $1`,
    [input.groupId],
  );
  const group = rows[0];
  if (!group) return { ok: false, status: 404, error: "That group is not here." };
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return { ok: false, status: 403, error: "Only a member can do that." };
  if (!actor.admin) return { ok: false, status: 403, error: "An admin sets who a group is for." };
  if (await groupFollowsRoom(db, input.groupId)) {
    return { ok: false, status: 403, error: "That group follows its room." };
  }
  const current = parseAudience(group.audience) ?? "all";
  if (current === next) return { ok: true, value: { audience: next } };
  await db.transaction(async (tx) => {
    await tx.query(`update theme_group set audience = $2 where id = $1`, [input.groupId, next]);
    await writeGenderAudit(tx, {
      actorUserId: input.userId,
      roomId: "",
      action: "set-audience",
      detail: `${input.groupId} ${current} -> ${next}`,
      now: input.now,
    });
  });
  return { ok: true, value: { audience: next } };
}
