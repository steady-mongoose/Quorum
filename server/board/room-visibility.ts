import type { Db } from "../db.ts";
import type { BoardActor } from "./access.ts";

export type RoomStatus = "draft" | "unclaimed" | "active";

function missingColumn(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "42703") return true;
  const message = error instanceof Error ? error.message : "";
  return /column ["']?status["']? does not exist/i.test(message);
}

/** True once migration 0020 has added room.status. Older databases have no listings. */
export async function listingColumnsReady(db: Db): Promise<boolean> {
  try {
    await db.query(`select status from room limit 0`);
    return true;
  } catch (error) {
    if (missingColumn(error)) return false;
    throw error;
  }
}

export function hiddenStatus(status: string): boolean {
  return status === "draft" || status === "unclaimed";
}

/** Stewards and admins can see a draft or an unclaimed room. Members cannot. */
export function canSeeHiddenRooms(actor: { admin: boolean; steward: boolean }): boolean {
  return actor.admin || actor.steward;
}

/**
 * Active rooms are readable. Draft and unclaimed rooms are readable only
 * by a steward or an admin. Any other status fails closed.
 */
export function canReadRoom(status: string, actor: { admin: boolean; steward: boolean }): boolean {
  if (status === "active") return true;
  if (hiddenStatus(status)) return canSeeHiddenRooms(actor);
  return false;
}

export function isPublicRoomStatus(status: string): boolean {
  return status === "active";
}

/**
 * True when this row is a draft, an unclaimed listing, or an unknown status
 * the caller cannot read. A missing row is not hidden: the caller keeps its
 * existing miss. A row with no status is an older read and stays visible.
 */
export function concealedListing(
  listed: { status?: string } | null,
  actor: { admin: boolean; steward: boolean },
): boolean {
  if (!listed?.status || listed.status === "active") return false;
  return !canReadRoom(listed.status, actor);
}

type ListingRow = {
  id: string;
  name: string;
  status: string;
};

/** The room row, or null. A database without 0020 reports every named room as active. */
export async function readRoomListing(db: Db, roomId: string): Promise<ListingRow | null> {
  const ready = await listingColumnsReady(db);
  if (!ready) {
    const rows = await db.query<{ id: string; name: string }>(
      `select id, name from room where id = $1`,
      [roomId],
    );
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, name: row.name, status: "active" };
  }
  const rows = await db.query<ListingRow>(`select id, name, status from room where id = $1`, [
    roomId,
  ]);
  return rows[0] ?? null;
}

export async function roomVisibleTo(db: Db, actor: BoardActor, roomId: string): Promise<boolean> {
  const room = await readRoomListing(db, roomId);
  if (!room || !room.name) return false;
  return canReadRoom(room.status, actor);
}

/** SQL fragment. `$param` is a boolean: true when the caller may see hidden rooms. */
export function visibleRoomClause(ready: boolean, param: string, column = "status"): string {
  if (!ready) return "true";
  return `($${param}::boolean or ${column} = 'active')`;
}
