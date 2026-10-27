import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import { actorRole } from "./access.ts";
import { checkedCategoryIds, openBan, replaceRoomCategories, type Result } from "./store.ts";
import { UNCATEGORIZED_SLUG } from "../../src/lib/board/categories.ts";

/** One row in the admin Rooms manager. */
export type AdminRoomRow = {
  id: string;
  name: string;
  audience: "all" | "men" | "women";
  status: string;
  categoryIds: string[];
  stewards: string[];
};

export type AdminRoomList = {
  rooms: AdminRoomRow[];
  /** True once the room log table from migration 0039 exists. */
  logReady: boolean;
};

function fail(status: number, error: string): { ok: false; status: number; error: string } {
  return { ok: false, status, error };
}

/** Whether migration 0039's room_admin_log table is present. */
export async function roomLogReady(db: Db): Promise<boolean> {
  const rows = await db.query<{ name: string | null }>(
    `select to_regclass('public.room_admin_log')::text as name`,
  );
  return Boolean(rows[0]?.name);
}

/**
 * Live steward names per room. The newest access_log row for a person and a
 * room decides, the same rule stewardRoomIds uses.
 */
async function stewardsByRoom(db: Db): Promise<Map<string, string[]>> {
  const rows = await db.query<{
    id: string;
    user_id: string | null;
    name: string;
    room_id: string;
    action: "grant" | "revoke";
    at: Date | string;
  }>(
    `select id, user_id, name, room_id, action, at from access_log
     where role = 'steward' and room_id <> ''`,
  );
  const latest = new Map<string, { id: string; name: string; action: string; at: number }>();
  for (const row of rows) {
    const key = `${row.room_id}\u0000${row.user_id ?? row.name}`;
    const at = new Date(row.at).getTime();
    const prev = latest.get(key);
    if (!prev || at > prev.at || (at === prev.at && row.id > prev.id)) {
      latest.set(key, { id: row.id, name: row.name, action: row.action, at });
    }
  }
  const out = new Map<string, string[]>();
  for (const [key, row] of latest) {
    if (row.action !== "grant") continue;
    const roomId = key.split("\u0000")[0] ?? "";
    const list = out.get(roomId) ?? [];
    list.push(row.name);
    out.set(roomId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.localeCompare(b));
  return out;
}

/** Admin, and no open site ban. The same ban check the other admin routes use. */
async function adminGate(db: Db, userId: string, now: Date, denied: string): Promise<Result<null>> {
  const actor = await actorRole(db, userId);
  if (!actor.admin) return fail(403, denied);
  const ban = await openBan(db, userId, now);
  if (ban) return { ok: false, status: 403, error: "banned", ban };
  return { ok: true, value: null };
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((slug, i) => slug === [...b].sort()[i]);

export async function listAdminRooms(
  db: Db,
  userId: string,
  now: Date,
): Promise<Result<AdminRoomList>> {
  const gate = await adminGate(db, userId, now, "Only an admin can manage rooms.");
  if (!gate.ok) return gate;
  const rows = await db.query<{
    id: string;
    name: string;
    audience: string | null;
    status: string | null;
    category_ids: string[] | null;
  }>(
    `select room.id, room.name, room.audience, room.status,
       coalesce((
         select array_agg(c.slug order by c.sort_order, c.slug)
         from room_categories rc join categories c on c.slug = rc.category_id
         where rc.room_id = room.id
       ), array[]::text[]) as category_ids
     from room
     order by lower(room.name), room.id`,
  );
  const stewards = await stewardsByRoom(db);
  return {
    ok: true,
    value: {
      logReady: await roomLogReady(db),
      rooms: rows.map((row) => ({
        id: row.id,
        name: row.name,
        audience: row.audience === "men" || row.audience === "women" ? row.audience : "all",
        status: row.status ?? "active",
        categoryIds: row.category_ids ?? [],
        stewards: stewards.get(row.id) ?? [],
      })),
    },
  };
}

/**
 * Sets a room's categories. Admin only. The change is written to
 * room_admin_log when migration 0039 is applied. Before that, the same
 * record goes to the server log so the move is never silent.
 */
export async function moveRoom(
  db: Db,
  input: {
    userId: string;
    userName: string;
    id: string;
    categoryIds: string[];
    /** The categories the admin saw. A mismatch returns 409. */
    expectedBefore?: string[];
    now: Date;
  },
): Promise<Result<AdminRoomRow>> {
  const gate = await adminGate(db, input.userId, input.now, "Only an admin can move a room.");
  if (!gate.ok) return gate;
  const id = input.id.trim().toLowerCase();
  const found = await db.query<{ id: string }>(`select id from room where id = $1`, [id]);
  if (!found[0]) return fail(404, "That room is not here.");
  const checked = await checkedCategoryIds(db, input.categoryIds);
  if (!Array.isArray(checked)) return checked;
  if (checked.includes(UNCATEGORIZED_SLUG) && checked.length > 1) {
    return fail(400, "Not yet sorted can't be combined with another category.");
  }
  const to = [...checked].sort();
  const logReady = await roomLogReady(db);
  const outcome = await db.transaction(async (tx): Promise<Result<string>> => {
    // Lock the room so two admins saving at once run one after the other.
    await tx.query(`select id from room where id = $1 for update`, [id]);
    const before = await tx.query<{ category_id: string }>(
      `select category_id from room_categories where room_id = $1 order by category_id`,
      [id],
    );
    const from = before.map((row) => row.category_id);
    if (input.expectedBefore && !sameList(input.expectedBefore, from)) {
      return fail(409, "Someone else changed this room's categories. Reload and try again.");
    }
    const detail = `Categories ${from.join(", ") || "none"} → ${to.join(", ")}.`;
    await tx.query(`delete from room_categories where room_id = $1`, [id]);
    await replaceRoomCategories(tx, id, checked);
    if (logReady) {
      await tx.query(
        `insert into room_admin_log (id, room_id, actor_user_id, actor_name, action, detail, at)
         values ($1, $2, $3, $4, 'move', $5, $6)`,
        [randomUUID(), id, input.userId, input.userName, detail, input.now],
      );
    }
    return { ok: true, value: detail };
  });
  if (!outcome.ok) return outcome;
  if (!logReady) {
    console.info(
      JSON.stringify({
        event: "room_admin_log",
        action: "move",
        roomId: id,
        actorUserId: input.userId,
        actorName: input.userName,
        detail: outcome.value,
        at: input.now.toISOString(),
      }),
    );
  }
  const list = await listAdminRooms(db, input.userId, input.now);
  if (!list.ok) return list;
  const row = list.value.rooms.find((room) => room.id === id);
  if (!row) return fail(500, "The room was not saved.");
  return { ok: true, value: row };
}
