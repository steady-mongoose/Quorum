import type { Db } from "../db.ts";
import type { BoardActor } from "./access.ts";
import { roleCounts } from "../../src/lib/board/rsvp-rules.ts";
import { isGatheringId } from "../../src/lib/board/public-gathering.ts";
import { rsvpCutoff, writeUpWithin } from "./rsvp-retention.ts";

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
  namedIn?: ReadonlySet<string> & { resolved?: ReadonlySet<string>; stale?: ReadonlySet<string> };
  /**
   * Gathering ids this account really hosts (public_gathering.host_user_id).
   * For a gathering's write-up the host role comes from here, never from who
   * filed the write-up (QA S1, Oct 30). Missing = hosts none (fail closed).
   */
  hosts?: ReadonlySet<string>;
};

/** The gatherings this account hosts, lowercased. */
export async function hostedGatherings(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db.query<{ id: string }>(`select id from public_gathering where host_user_id = $1`, [userId]);
  return new Set(rows.map((row) => row.id.toLowerCase()));
}

export async function cameViewer(db: Db, userId: string, actor: BoardActor): Promise<CameViewer> {
  const rows = await db.query<{ name: string | null; shared: boolean }>(
    `select u.name,
            exists (select 1 from "user" o where o.name = u.name and o.id <> u.id) as shared
     from "user" u where u.id = $1`,
    [userId],
  );
  return {
    userId,
    name: rows[0]?.name ?? "",
    nameOwn: rows[0]?.shared !== true,
    actor,
    hosts: await hostedGatherings(db, userId),
  };
}

/**
 * True when this viewer reads the whole roll call of a write-up in roomId.
 * Only two real roles grant it: a steward seat in that room, or hosting the
 * gathering (public_gathering.host_user_id, via viewer.hosts). For a
 * gathering's write-up, having filed it is never enough (QA S1). For an older
 * device card (not a gathering id), the card's host is whoever claimed it
 * (dm_card_host), which is the write-up's author, so hostId is used there.
 */
export function seesWhoCame(
  viewer: CameViewer,
  roomId: string,
  hostId: string | null | undefined,
  cardId?: string | null,
): boolean {
  // Not stewardsRoom(): that counts every admin as a steward, which is right
  // for moderation, not for who came.
  if (!roleCounts(viewer.actor.admin)) return false;
  if (viewer.actor.stewardRooms.includes(roomId)) return true;
  if (cardId && isGatheringId(cardId)) return viewer.hosts?.has(cardId.toLowerCase()) ?? false;
  return Boolean(hostId) && hostId === viewer.userId;
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
  // Older than 12 months (Josh's rule, QA N7): no "You came", whether or not
  // OLD_WRITE_UPS_DROP_DM_LINKS kept the link for DMs.
  if (viewer.namedIn?.stale?.has(post.id)) {
    return { came: seesWhoCame(viewer, post.roomId, post.hostId, post.cardId) ? came : [], youCame: false };
  }
  const byId = viewer.namedIn?.has(post.id) ?? false;
  const resolved = viewer.namedIn?.resolved?.has(post.id) ?? false;
  // A gathering's write-up is linked by the roll call's ids only (QA S3): a
  // name never stands in for one.
  const byNameOk = !resolved && !isGatheringId(post.cardId ?? "");
  const youCame = byId || (byNameOk && viewer.nameOwn !== false && viewer.name !== "" && came.includes(viewer.name));
  if (seesWhoCame(viewer, post.roomId, post.hostId, post.cardId)) return { came, youCame };
  return { came: [], youCame };
}

/** Which of these write-ups name this viewer by account, and which were resolved at all. */
export async function namedIn(
  db: Db,
  userId: string,
  postIds: string[],
  now: Date = new Date(),
): Promise<Set<string> & { resolved?: Set<string>; stale?: Set<string> }> {
  const out: Set<string> & { resolved?: Set<string>; stale?: Set<string> } = new Set();
  out.resolved = new Set();
  out.stale = new Set();
  if (postIds.length === 0) return out;
  // Write-ups older than the 12-month cutoff read as nobody came, for "You came" (QA N7).
  const cutoff = rsvpCutoff(now);
  const old = await db.query<{ id: string }>(
    `select p.id from board_post p
     where p.id = any ($1::text[]) and p.type = 'hosted' and not ${writeUpWithin("$2", "$3")}`,
    [postIds, cutoff.toISOString().slice(0, 10), cutoff],
  );
  for (const row of old) out.stale.add(row.id);
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
  now: Date = new Date(),
): Promise<CameViewer> {
  const viewer = await cameViewer(db, userId, actor);
  return { ...viewer, namedIn: await namedIn(db, userId, [postId], now) };
}
