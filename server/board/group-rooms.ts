import type { Db } from "../db.ts";

function missingTable(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return code === "42P01";
}

/** Rooms whose stewards approved this group. A seed group has none. */
export async function approvedRoomIds(db: Db, groupId: string): Promise<string[]> {
  try {
    const rows = await db.query<{ room_id: string }>(
      `select distinct room_id from theme_group_request
       where group_id = $1 and status = 'approved' and room_id <> ''`,
      [groupId],
    );
    return rows.map((row) => row.room_id);
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

/** Groups a room steward approved. A room bar covers these calls as well. */
export async function groupsApprovedFrom(db: Db, roomId: string): Promise<string[]> {
  if (!roomId) return [];
  try {
    const rows = await db.query<{ group_id: string }>(
      `select distinct r.group_id
       from theme_group_request r
       where r.room_id = $1
         and r.status = 'approved'
         and r.group_id <> ''
         and not exists (select 1 from room m where m.id = r.group_id)`,
      [roomId],
    );
    return rows.map((row) => row.group_id);
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}
