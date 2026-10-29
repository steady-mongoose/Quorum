import type { Db } from "../db.ts";
import { actorRole } from "./access.ts";
import {
  DEFAULT_ROOM_OPTIONS,
  LEGACY_ROOM_OPTIONS,
  ROOM_OPTION_OFF,
  roomOptionsFrom,
  type RoomOption,
} from "../../src/lib/board/room-options.ts";

export { DEFAULT_ROOM_OPTIONS, LEGACY_ROOM_OPTIONS, ROOM_OPTION_OFF, roomOptionsFrom };
export type { RoomOption };

function missingColumn(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return code === "42703" || /column .*options.* does not exist/i.test(message);
}

/** False until migration 0044 adds room.options. Until then every room keeps all four. */
export async function optionsColumnReady(db: Db): Promise<boolean> {
  try {
    await db.query(`select options from room limit 0`);
    return true;
  } catch (error) {
    if (missingColumn(error)) return false;
    throw error;
  }
}

/** The options a room has switched on. */
export async function roomOptions(db: Db, roomId: string): Promise<RoomOption[]> {
  if (!(await optionsColumnReady(db))) return [...LEGACY_ROOM_OPTIONS];
  const rows = await db.query<{ options: unknown }>(`select options from room where id = $1`, [
    roomId,
  ]);
  // A group is not a room row. Options are a room setting, so a group keeps all four.
  if (!rows[0]) return [...LEGACY_ROOM_OPTIONS];
  return roomOptionsFrom(rows[0].options);
}

export async function roomHas(db: Db, roomId: string, option: RoomOption): Promise<boolean> {
  return (await roomOptions(db, roomId)).includes(option);
}

/** Read an options list sent by a client. Unknown names are refused, not dropped. */
export function parseRoomOptions(value: unknown): RoomOption[] | null {
  if (!Array.isArray(value)) return null;
  const known = new Set<string>(LEGACY_ROOM_OPTIONS);
  const picked: RoomOption[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !known.has(item)) return null;
    if (!picked.includes(item as RoomOption)) picked.push(item as RoomOption);
  }
  return LEGACY_ROOM_OPTIONS.filter((option) => picked.includes(option));
}

/** Only an admin sets which options a room has. */
export async function adminMaySetOptions(db: Db, userId: string): Promise<boolean> {
  return (await actorRole(db, userId)).admin;
}
