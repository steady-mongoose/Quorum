import type { Db } from "../db.ts";
import type { BoardActor } from "./access.ts";
import { roleCounts } from "../../src/lib/board/rsvp-rules.ts";
import { isGatheringId } from "../../src/lib/board/public-gathering.ts";

/**
 * Who came is private (Josh, Oct 29, 10:06 PM ET; admins dropped Oct 30,
 * 7:01 AM ET): only the host and the room's stewards see it, and each member
 * sees their own. An admin as an admin gets counts only (rsvp-summary.ts).
 * The server strips everyone else's attendance before a payload leaves it.
 */
export type CameViewer = {
  userId: string;
  name: string;
  /** False when another account has this name: then only an id match counts. */
  nameOwn?: boolean;
  actor: BoardActor;
  /** Write-ups whose roll call names this account by id (dm_named_account). */
  namedIn?: ReadonlySet<string> & { resolved?: ReadonlySet<string> };
};

export async function cameViewer(db: Db, userId: string, actor: BoardActor): Promise<CameViewer> {
  const rows = await db.query<{ name: string | null; shared: boolean }>(
    `select u.name,
            exists (select 1 from "user" o where o.name = u.name and o.id <> u.id) as shared
     from "user" u where u.id = $1`,
    [userId],
  );
  return { userId, name: rows[0]?.name ?? "", nameOwn: rows[0]?.shared !== true, actor };
}

/** True when this viewer reads the whole roll call of a gathering hosted by hostId in roomId. */
export function seesWhoCame(
  viewer: CameViewer,
  roomId: string,
  hostId: string | null | undefined,
): boolean {
  // Not stewardsRoom(): that counts every admin as a steward, which is right
  // for moderation, not for who came.
  if (!roleCounts(viewer.actor.admin)) return false;
  return viewer.actor.stewardRooms.includes(roomId) || (Boolean(hostId) && hostId === viewer.userId);
}

/**
 * What a write-up's roll call shows this viewer: every name, or no names and
 * only whether they came. "You came" is matched on the account id the roll
 * call resolved to (dm_named_account), and on the name only for a write-up
 * whose names were never resolved to accounts, and then only when no other
 * account shares the viewer's name.
 */
export function cameFor(
  came: string[],
  viewer: CameViewer,
  post: { id: string; roomId: string; hostId: string | null | undefined; cardId?: string | null },
): { came: string[]; youCame: boolean } {
  const byId = viewer.namedIn?.has(post.id) ?? false;
  const resolved = viewer.namedIn?.resolved?.has(post.id) ?? false;
  // A gathering's write-up is linked by the roll call's ids only (QA S3): a
  // name never stands in for one.
  const byNameOk = !resolved && !isGatheringId(post.cardId ?? "");
  const youCame = byId || (byNameOk && viewer.nameOwn !== false && viewer.name !== "" && came.includes(viewer.name));
  if (seesWhoCame(viewer, post.roomId, post.hostId)) return { came, youCame };
  return { came: [], youCame };
}

/** Which of these write-ups name this viewer by account, and which were resolved at all. */
export async function namedIn(
  db: Db,
  userId: string,
  postIds: string[],
): Promise<Set<string> & { resolved?: Set<string> }> {
  const out: Set<string> & { resolved?: Set<string> } = new Set();
  out.resolved = new Set();
  if (postIds.length === 0) return out;
  const ready = await db.query<{ ready: string | null }>(
    `select to_regclass('public.dm_named_account')::text as ready`,
  );
  if (!ready[0]?.ready) return out;
  const rows = await db.query<{ post_id: string; user_id: string }>(
    `select post_id, user_id from dm_named_account where post_id = any ($1::text[])`,
    [postIds],
  );
  for (const row of rows) {
    out.resolved.add(row.post_id);
    if (row.user_id === userId) out.add(row.post_id);
  }
  return out;
}

/** A viewer for one post's response (create, edit): "You came" by id, as on the board (QA S4 5). */
export async function cameViewerFor(
  db: Db,
  userId: string,
  actor: BoardActor,
  postId: string,
): Promise<CameViewer> {
  const viewer = await cameViewer(db, userId, actor);
  return { ...viewer, namedIn: await namedIn(db, userId, [postId]) };
}
