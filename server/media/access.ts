import type { Db } from "../db.ts";
import { actorRole } from "../board/access.ts";
import { guardRoomAudience } from "../board/audience.ts";
import { concealedListing, readRoomListing } from "../board/room-visibility.ts";
import { openBanOrNone, type OpenBan } from "../board/store.ts";
import { OBJECT_ID, ROOM_ID } from "../../src/lib/media/limits.ts";

export type AccessResult =
  { ok: true } | { ok: false; status: 400 | 403 | 404; error: string; ban?: OpenBan };

async function isAdmin(db: Db, userId: string): Promise<boolean> {
  const rows = await db.query<{ is_admin: boolean }>(
    `select is_admin from member_role where user_id = $1`,
    [userId],
  );
  return rows[0]?.is_admin === true;
}

export async function roomExists(db: Db, roomId: string): Promise<boolean> {
  if (!ROOM_ID.test(roomId)) return false;
  const rows = await db.query<{ id: string }>(`select id from room where id = $1`, [roomId]);
  return Boolean(rows[0]);
}

/**
 * A member of this room, or the founding admin. A join (room_join) or a
 * room_member row lets the member in. An open ban refuses the room even when
 * either row is still there. An admin is not exempt.
 */
export async function memberOfRoom(
  db: Db,
  userId: string,
  roomId: string,
  now: Date,
): Promise<AccessResult> {
  const listed = await readRoomListing(db, roomId);
  const actor = await actorRole(db, userId);
  if (concealedListing(listed, actor)) {
    return { ok: false, status: 404, error: "That room is not here." };
  }
  const ban = await openBanOrNone(db, userId, now, roomId);
  if (ban) return { ok: false, status: 403, error: "banned", ban };
  if (await isAdmin(db, userId)) return { ok: true };
  const rows = await db.query<{ via: string }>(
    `select 'stood' as via from room_member where room_id = $1 and user_id = $2
     union all
     select 'saved' as via from room_join where room_id = $1 and user_id = $2`,
    [roomId, userId],
  );
  if (rows.some((row) => row.via === "stood")) return { ok: true };
  // A join alone counts as it does in chat: a live member the room's audience still takes.
  if (!rows[0] || !actor.member) {
    return { ok: false, status: 403, error: "You have not stood in that room." };
  }
  const gate = await guardRoomAudience(db, {
    userId,
    roomId,
    now,
    path: "read",
    moderate: true,
    actor,
  });
  if (!gate.ok) return { ok: false, status: gate.status, error: gate.error };
  return { ok: true };
}

/**
 * Record the post this picture will hang on. The room and the membership
 * have to exist already. An invite that names the room writes that membership.
 */
export async function registerRoomPost(
  db: Db,
  userId: string,
  roomId: string,
  postId: string,
  now: Date,
): Promise<AccessResult> {
  if (!ROOM_ID.test(roomId) || !(await roomExists(db, roomId))) {
    return { ok: false, status: 400, error: "Choose a room." };
  }
  if (!OBJECT_ID.test(postId)) {
    return { ok: false, status: 400, error: "Choose the post this picture belongs to." };
  }
  const stood = await memberOfRoom(db, userId, roomId, now);
  if (!stood.ok) {
    if (stood.error === "banned") return stood;
    if (stood.status === 404) return { ok: false, status: 400, error: "Choose a room." };
    return stood;
  }
  const existing = await db.query<{ room_id: string; author_user_id: string }>(
    `select room_id, author_user_id from room_post where id = $1`,
    [postId],
  );
  const row = existing[0];
  if (row) {
    if (row.room_id !== roomId || row.author_user_id !== userId) {
      return { ok: false, status: 404, error: "That post is not here." };
    }
    return { ok: true };
  }
  await db.query(`insert into room_post (id, room_id, author_user_id) values ($1, $2, $3)`, [
    postId,
    roomId,
    userId,
  ]);
  return { ok: true };
}

/** The uploader is a member, and this post is theirs in this room. */
export async function canAttachToPost(
  db: Db,
  userId: string,
  roomId: string,
  postId: string,
  now: Date,
): Promise<AccessResult> {
  if (!(await roomExists(db, roomId))) return { ok: false, status: 400, error: "Choose a room." };
  const stood = await memberOfRoom(db, userId, roomId, now);
  if (!stood.ok) {
    if (stood.error === "banned") return stood;
    if (stood.status === 404) return { ok: false, status: 400, error: "Choose a room." };
    return stood;
  }
  const rows = await db.query<{ id: string }>(
    `select id from room_post where id = $1 and room_id = $2 and author_user_id = $3`,
    [postId, roomId, userId],
  );
  if (!rows[0]) return { ok: false, status: 404, error: "That post is not here." };
  return { ok: true };
}
