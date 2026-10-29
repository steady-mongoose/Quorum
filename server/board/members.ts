import type { Db } from "../db.ts";
import { requireRoomMember } from "../chat/store.ts";
import { actorRole, stewardsRoom } from "./access.ts";
import { ROOM_OPTION_OFF, roomOptions } from "./room-options.ts";
import { memberMessageStates, type MemberMessage } from "../dm/store.ts";

/**
 * Who is in a room, for the people in it (Josh, 2026-10-29): every member sees
 * every other member's name, when they joined, when they last posted, and the
 * gatherings the host's roll call says they came to, in a room that takes roll. The list is in name order,
 * never by activity, and carries no count or score. Upcoming RSVPs are not here;
 * they stay admin-only.
 */
export type RoomMember = {
  id: string;
  name: string;
  steward: boolean;
  /** YYYY-MM-DD, or "" when the member stood in the room before joins were dated. */
  joinedOn: string;
  /** YYYY-MM-DD of the last post or reply in this room, or "". */
  lastPostedOn: string;
  /** Newest first: each gathering in this room the host's write-up names them at. */
  attended: { on: string; host: string; hosted: boolean }[];
  /** What the list offers the viewer for this person; "none" on their own row. */
  message: MemberMessage;
};

/** Gatherings shown per member. */
export const ATTENDED_SHOWN = 12;
/** Members shown per room. */
export const MEMBERS_SHOWN = 500;

type Failure = { ok: false; status: number; error: string };

function day(value: Date | string | null | undefined): string {
  if (value == null || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export async function listRoomMembers(
  db: Db,
  userId: string,
  roomId: string,
  now: Date,
): Promise<{ ok: true; value: { members: RoomMember[]; rollCall: boolean } } | Failure> {
  const gate = await requireRoomMember(db, userId, roomId, now);
  if (!gate.ok) return { ok: false, status: gate.status, error: gate.error };
  const options = await roomOptions(db, roomId);
  if (!options.includes("members")) return { ok: false, status: 404, error: ROOM_OPTION_OFF.members };
  const rollCall = options.includes("roll_call");

  const people = await db.query<{ id: string; name: string; joined_at: Date | string | null }>(
    `select u.id, u.name, j.joined_at
     from (
       select user_id from room_join where room_id = $1
       union
       select user_id from room_member where room_id = $1
     ) m
     join "user" u on u.id = m.user_id
     left join room_join j on j.user_id = u.id and j.room_id = $1
     order by u.name, u.id
     limit ${MEMBERS_SHOWN}`,
    [roomId],
  );

  // Only people who still stand in the room: not barred, not outside its audience.
  const standing: typeof people = [];
  for (const person of people) {
    if (person.id === userId || (await requireRoomMember(db, person.id, roomId, now)).ok) {
      standing.push(person);
    }
  }
  const ids = standing.map((person) => person.id);
  if (ids.length === 0) return { ok: true, value: { members: [], rollCall } };

  const posted = await db.query<{ author_user_id: string; last_at: Date | string }>(
    `select author_user_id, max(created_at) as last_at
     from board_post
     where room_id = $1 and removed = false and author_user_id = any ($2::text[])
     group by author_user_id`,
    [roomId, ids],
  );
  const lastPosted = new Map(posted.map((row) => [row.author_user_id, day(row.last_at)]));

  // The host's roll call: each write-up in this room, the host and the accounts it named.
  const roll = await db.query<{
    post_id: string;
    host_id: string | null;
    host_name: string;
    on_date: string;
    created_at: Date | string;
    user_id: string | null;
  }>(
    `select p.id as post_id, p.author_user_id as host_id, p.author_name as host_name,
            p.on_date, p.created_at, n.user_id
     from board_post p
     left join dm_named_account n on n.post_id = p.id
     where p.room_id = $1 and p.type = 'hosted' and p.removed = false and p.parent_id is null
     order by p.created_at desc, p.id`,
    [roomId],
  );
  const attended = new Map<string, Map<string, { on: string; host: string; hosted: boolean }>>();
  const note = (personId: string | null, row: (typeof roll)[number], hosted: boolean) => {
    if (!personId) return;
    const mine = attended.get(personId) ?? new Map();
    if (!mine.has(row.post_id)) {
      mine.set(row.post_id, {
        on: /^\d{4}-\d{2}-\d{2}$/.test(row.on_date) ? row.on_date : day(row.created_at),
        host: row.host_name,
        hosted,
      });
    }
    attended.set(personId, mine);
  };
  for (const row of rollCall ? roll : []) {
    note(row.host_id, row, true);
    if (row.user_id && row.user_id !== row.host_id) note(row.user_id, row, false);
  }

  const messaging = await memberMessageStates(db, userId, ids, now);
  const members: RoomMember[] = [];
  for (const person of standing) {
    const actor = await actorRole(db, person.id);
    members.push({
      id: person.id,
      name: person.name,
      steward: stewardsRoom(actor, roomId),
      joinedOn: day(person.joined_at),
      lastPostedOn: lastPosted.get(person.id) ?? "",
      attended: [...(attended.get(person.id)?.values() ?? [])]
        .sort((a, b) => b.on.localeCompare(a.on))
        .slice(0, ATTENDED_SHOWN),
      message: messaging.get(person.id) ?? "none",
    });
  }
  return { ok: true, value: { members, rollCall } };
}
