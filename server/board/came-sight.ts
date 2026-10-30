import type { Db } from "../db.ts";
import { stewardsRoom, type BoardActor } from "./access.ts";

/**
 * Who came is private (Josh, Oct 29, 10:06 PM ET): "Make who came private: only
 * the host, the room's stewards and admins see it, and each member sees their own."
 * The server strips everyone else's attendance before a payload leaves it.
 */
export type CameViewer = { userId: string; name: string; actor: BoardActor };

export async function cameViewer(db: Db, userId: string, actor: BoardActor): Promise<CameViewer> {
  const rows = await db.query<{ name: string | null }>(`select name from "user" where id = $1`, [
    userId,
  ]);
  return { userId, name: rows[0]?.name ?? "", actor };
}

/** True when this viewer reads the whole roll call of a gathering hosted by hostId in roomId. */
export function seesWhoCame(
  viewer: CameViewer,
  roomId: string,
  hostId: string | null | undefined,
): boolean {
  return stewardsRoom(viewer.actor, roomId) || (Boolean(hostId) && hostId === viewer.userId);
}

/** The names a write-up shows this viewer: all of them, or only their own. */
export function cameFor(
  came: string[],
  viewer: CameViewer,
  roomId: string,
  hostId: string | null | undefined,
): string[] {
  if (seesWhoCame(viewer, roomId, hostId)) return came;
  return viewer.name !== "" && came.includes(viewer.name) ? [viewer.name] : [];
}
