import { actorRole, stewardsRoom } from "./access.ts";
import { canReadRoom, isPublicRoomStatus, readRoomListing } from "./room-visibility.ts";
import { guardRoomAudience, roomAudience } from "./audience.ts";
import { openBan } from "./store.ts";
import type { Db } from "../db.ts";
import { ROOM_ID } from "../../src/lib/media/limits.ts";
import {
  acceptPublicGathering,
  isGatheringId,
  type PublicGathering,
} from "../../src/lib/board/public-gathering.ts";
import { isEnglish } from "../../src/lib/board/text.ts";

export type GatheringRecord = {
  id: string;
  roomId: string;
  title: string;
  date: string;
  time: string;
  town: string;
  place: string;
  shared: boolean;
  /** True when the caller is the host. A steward may still change sharing. */
  mine: boolean;
};

type Fail = { ok: false; status: number; error: string };

type Row = {
  id: string;
  room_id: string;
  title: string;
  gather_on: string;
  gather_time: string;
  town: string;
  place: string;
  shared: boolean;
  removed: boolean;
  host_user_id: string;
};

function fail(status: number, error: string): Fail {
  return { ok: false, status, error };
}

function toRecord(row: Row, userId: string): GatheringRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    title: row.title,
    date: row.gather_on,
    time: row.gather_time,
    town: row.town,
    place: row.place,
    shared: row.shared,
    mine: row.host_user_id === userId,
  };
}

/** Participation. A steward who does not match is refused, the same as any member. */
async function gatheringAudience(
  db: Db,
  userId: string,
  roomId: string,
  now: Date,
): Promise<Fail | null> {
  const gate = await guardRoomAudience(db, {
    userId,
    roomId,
    now,
    path: "read",
  });
  if (gate.ok) return null;
  if (gate.status === 404) return fail(404, "Not found.");
  return fail(gate.status, gate.error);
}

async function roomIsOpen(db: Db, roomId: string): Promise<boolean> {
  const audience = await roomAudience(db, roomId);
  return audience === null || audience === "all";
}

async function roomExists(db: Db, roomId: string): Promise<boolean> {
  const room = await readRoomListing(db, roomId);
  return Boolean(room);
}

async function publicRoom(db: Db, roomId: string): Promise<boolean> {
  const room = await readRoomListing(db, roomId);
  return Boolean(room && isPublicRoomStatus(room.status));
}

async function hidden(db: Db, row: Row, now: Date): Promise<boolean> {
  if (row.removed || !row.room_id) return true;
  if (!(await roomExists(db, row.room_id))) return true;
  const ban = await openBan(db, row.host_user_id, now, row.room_id);
  return ban !== null;
}

async function loadRow(db: Db, id: string): Promise<Row | null> {
  const rows = await db.query<Row>(
    `select id, room_id, title, gather_on, gather_time, town, place, shared, removed, host_user_id
     from public_gathering where id = $1`,
    [id.toLowerCase()],
  );
  return rows[0] ?? null;
}

/**
 * The public town comes only from structured data: the town a town room is
 * scoped to. A free-text place line never reaches the public page, so a
 * street name can't leak. Any other room shows no town.
 */
async function structuredTown(db: Db, roomId: string): Promise<string> {
  const rows = await db.query<{ name: string }>(
    `select t.name from room r join town t on t.id = r.town_id
     where r.id = $1 and r.scope_kind = 'town'`,
    [roomId],
  );
  return rows[0]?.name?.trim() ?? "";
}

function fieldsOf(input: {
  title: unknown;
  date: unknown;
  time: unknown;
  place: unknown;
  town: string;
}): { ok: true; gathering: PublicGathering; place: string } | Fail {
  const place = typeof input.place === "string" ? input.place.trim() : "";
  if (!place || place.length > 240 || !isEnglish(place)) {
    return fail(400, "Say where it meets. The public page shows only the room's town, never the place line.");
  }
  const accepted = acceptPublicGathering({
    title: input.title,
    date: input.date,
    time: input.time,
    town: input.town,
  });
  if (!accepted.ok) return fail(400, accepted.error);
  return { ok: true, gathering: accepted.gathering, place };
}

/**
 * Create a gathering, or update one the caller already hosts or stewards.
 * Sharing is not taken from this body.
 */
export async function saveGathering(
  db: Db,
  input: {
    userId: string;
    id: string;
    roomId: string;
    title: unknown;
    date: unknown;
    time: unknown;
    place: unknown;
    now: Date;
  },
): Promise<{ ok: true; gathering: GatheringRecord } | Fail> {
  if (!isGatheringId(input.id)) return fail(404, "Not found.");
  const id = input.id.toLowerCase();
  const roomId = input.roomId.trim();
  if (!ROOM_ID.test(roomId) || !(await roomExists(db, roomId))) {
    return fail(400, "That room is not on the board.");
  }
  const blocked = await gatheringAudience(db, input.userId, roomId, input.now);
  if (blocked) return blocked;
  const actor = await actorRole(db, input.userId);
  if (!actor.member && !actor.steward) return fail(403, "You are not a member.");
  const listed = await readRoomListing(db, roomId);
  if (!listed || !canReadRoom(listed.status, actor)) {
    return fail(400, "That room is not on the board.");
  }
  if (await openBan(db, input.userId, input.now, roomId)) return fail(404, "Not found.");
  const fields = fieldsOf({ ...input, town: await structuredTown(db, roomId) });
  if (!fields.ok) return fields;

  const existing = await loadRow(db, id);
  if (existing) {
    if (await hidden(db, existing, input.now)) return fail(404, "Not found.");
    const existingRoom = await readRoomListing(db, existing.room_id);
    if (!existingRoom || !canReadRoom(existingRoom.status, actor)) return fail(404, "Not found.");
    const allowed = existing.host_user_id === input.userId || stewardsRoom(actor, existing.room_id);
    if (!allowed) return fail(403, "Only the organizer can change this gathering.");
    if (
      existing.room_id !== roomId &&
      !stewardsRoom(actor, roomId) &&
      existing.host_user_id !== input.userId
    ) {
      return fail(403, "Only the organizer can change this gathering.");
    }
    await db.query(
      `update public_gathering
       set title = $2, gather_on = $3, gather_time = $4, town = $5, place = $6, room_id = $7, updated_at = now()
       where id = $1 and removed = false`,
      [
        id,
        fields.gathering.title,
        fields.gathering.date,
        fields.gathering.time,
        fields.gathering.town,
        fields.place,
        roomId,
      ],
    );
  } else {
    await db.query(
      `insert into public_gathering
       (id, title, gather_on, gather_time, town, place, room_id, shared, removed, host_user_id)
       values ($1, $2, $3, $4, $5, $6, $7, false, false, $8)`,
      [
        id,
        fields.gathering.title,
        fields.gathering.date,
        fields.gathering.time,
        fields.gathering.town,
        fields.place,
        roomId,
        input.userId,
      ],
    );
  }
  const saved = await loadRow(db, id);
  if (!saved) return fail(404, "Not found.");
  return { ok: true, gathering: toRecord(saved, input.userId) };
}

/**
 * The host turns sharing on or off. A steward of that room can only turn it
 * off. Everyone else is refused.
 */
export async function setGatheringShared(
  db: Db,
  input: { userId: string; id: string; shared: boolean; now: Date },
): Promise<{ ok: true; shared: boolean } | Fail> {
  if (!isGatheringId(input.id)) return fail(404, "Not found.");
  const row = await loadRow(db, input.id);
  if (!row || (await hidden(db, row, input.now))) return fail(404, "Not found.");
  if (await openBan(db, input.userId, input.now, row.room_id)) return fail(404, "Not found.");
  const blocked = await gatheringAudience(db, input.userId, row.room_id, input.now);
  if (blocked) return blocked;
  const actor = await actorRole(db, input.userId);
  const listedRoom = await readRoomListing(db, row.room_id);
  if (!listedRoom || !canReadRoom(listedRoom.status, actor)) return fail(404, "Not found.");
  const host = row.host_user_id === input.userId;
  const steward = stewardsRoom(actor, row.room_id);
  if (input.shared) {
    if (!host) return fail(403, "Only the organizer can share this gathering.");
    if (!(await publicRoom(db, row.room_id))) {
      return fail(403, "Sharing stays off until this room is claimed.");
    }
    if (!(await roomIsOpen(db, row.room_id))) {
      return fail(403, "A public page is only for a room everyone can join.");
    }
  } else if (!host && !steward) {
    return fail(403, "Only the organizer can change sharing.");
  }
  await db.query(
    `update public_gathering set shared = $2, updated_at = now() where id = $1 and removed = false`,
    [row.id, input.shared],
  );
  return { ok: true, shared: input.shared };
}

export async function removeGathering(
  db: Db,
  input: { userId: string; id: string; now: Date },
): Promise<{ ok: true } | Fail> {
  if (!isGatheringId(input.id)) return fail(404, "Not found.");
  const row = await loadRow(db, input.id);
  if (!row || row.removed) return fail(404, "Not found.");
  if (await openBan(db, input.userId, input.now, row.room_id)) return fail(404, "Not found.");
  const blocked = await gatheringAudience(db, input.userId, row.room_id, input.now);
  if (blocked) return blocked;
  const actor = await actorRole(db, input.userId);
  const listedRoom = await readRoomListing(db, row.room_id);
  if (!listedRoom || !canReadRoom(listedRoom.status, actor)) return fail(404, "Not found.");
  const allowed = row.host_user_id === input.userId || stewardsRoom(actor, row.room_id);
  if (!allowed) return fail(403, "Only the organizer can change this gathering.");
  await db.query(
    `update public_gathering set removed = true, shared = false, updated_at = now() where id = $1`,
    [row.id],
  );
  await dropGatheringRsvps(db, row.id);
  return { ok: true };
}

/**
 * A removed gathering keeps no RSVPs or attendance. Before 0049 is applied
 * there is no table, and that is fine.
 */
async function dropGatheringRsvps(db: Db, id: string): Promise<void> {
  try {
    await db.query(`delete from gathering_rsvp where gathering_id = $1`, [id]);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const message = error instanceof Error ? error.message : String(error);
    if (code === "42P01" || /gathering_rsvp" does not exist/.test(message)) return;
    throw error;
  }
}

export async function readGatheringFor(
  db: Db,
  input: { userId: string; id: string; now: Date },
): Promise<{ ok: true; gathering: GatheringRecord } | Fail> {
  if (!isGatheringId(input.id)) return fail(404, "Not found.");
  const row = await loadRow(db, input.id);
  if (!row || (await hidden(db, row, input.now))) return fail(404, "Not found.");
  const blocked = await gatheringAudience(db, input.userId, row.room_id, input.now);
  if (blocked) return blocked;
  const actor = await actorRole(db, input.userId);
  const listed = await readRoomListing(db, row.room_id);
  if (!listed || !canReadRoom(listed.status, actor)) return fail(404, "Not found.");
  const allowed = row.host_user_id === input.userId || stewardsRoom(actor, row.room_id);
  if (!allowed) return fail(404, "Not found.");
  return { ok: true, gathering: toRecord(row, input.userId) };
}

export async function listGatheringsFor(
  db: Db,
  input: { userId: string; now: Date },
): Promise<GatheringRecord[]> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member && !actor.steward) return [];
  // A gathering is for its room's audience, not only its host. Every member
  // who can read the room sees it, so they can RSVP, mark "I went", and meet
  // the host. A member barred from the room does not.
  const rows = await db.query<Row>(
    `select id, room_id, title, gather_on, gather_time, town, place, shared, removed, host_user_id
     from public_gathering
     where removed = false
     order by updated_at desc
     limit 500`,
  );
  const visible: GatheringRecord[] = [];
  for (const row of rows) {
    if (await hidden(db, row, input.now)) continue;
    const listed = await readRoomListing(db, row.room_id);
    if (!listed || !canReadRoom(listed.status, actor)) continue;
    if (await gatheringAudience(db, input.userId, row.room_id, input.now)) continue;
    if (
      row.host_user_id !== input.userId &&
      (await openBan(db, input.userId, input.now, row.room_id))
    )
      continue;
    visible.push(toRecord(row, input.userId));
  }
  return visible;
}

/** The live public fields. Unshared, removed, missing, or barred is null. */
export async function loadSharedGathering(
  db: Db,
  id: string,
  now: Date,
): Promise<PublicGathering | null> {
  if (!isGatheringId(id)) return null;
  const row = await loadRow(db, id);
  if (!row || !row.shared || (await hidden(db, row, now))) return null;
  if (!(await publicRoom(db, row.room_id))) return null;
  if (!(await roomIsOpen(db, row.room_id))) return null;
  return { title: row.title, date: row.gather_on, time: row.gather_time, town: row.town };
}

/**
 * A gathering one member may RSVP to: the same rule as listGatheringsFor.
 * Missing, removed, barred, or outside the room's audience is a 404, so a
 * member cannot learn that a gathering they cannot see exists.
 */
export async function rsvpGatheringFor(
  db: Db,
  input: { userId: string; id: string; now: Date },
): Promise<
  | {
      ok: true;
      gathering: { id: string; roomId: string; hostUserId: string };
      actor: Awaited<ReturnType<typeof actorRole>>;
    }
  | Fail
> {
  if (!isGatheringId(input.id)) return fail(404, "Not found.");
  const actor = await actorRole(db, input.userId);
  if (!actor.member && !actor.steward) return fail(404, "Not found.");
  const row = await loadRow(db, input.id);
  if (!row || (await hidden(db, row, input.now))) return fail(404, "Not found.");
  const listed = await readRoomListing(db, row.room_id);
  if (!listed || !canReadRoom(listed.status, actor)) return fail(404, "Not found.");
  if (await gatheringAudience(db, input.userId, row.room_id, input.now)) return fail(404, "Not found.");
  if (row.host_user_id !== input.userId && (await openBan(db, input.userId, input.now, row.room_id))) {
    return fail(404, "Not found.");
  }
  return {
    ok: true,
    gathering: { id: row.id, roomId: row.room_id, hostUserId: row.host_user_id },
    actor,
  };
}
