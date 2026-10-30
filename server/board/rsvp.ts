import { rsvpCutoff, writeUpWithin } from "./rsvp-retention.ts";
import { DID_NOT_NAMES, rsvpHandle } from "./rsvp-handle.ts";
import { ADMIN_NO_NAMES, MARK_NOT_GOING, MARK_TOO_EARLY, RSVP_SPECIAL_ONLY, markOpen, roleCounts } from "../../src/lib/board/rsvp-rules.ts";
import { rsvpSummary } from "./rsvp-summary.ts";
import type { Db } from "../db.ts";
import { limitBoard } from "./routes.ts";
import { GATHERING_0050_COLUMNS, GATHERING_IS_SPECIAL, listGatheringsFor, rsvpGatheringFor } from "./gathering-record.ts";
import { actorRole } from "./access.ts";
import { roomOptions } from "./room-options.ts";
import { ROOM_OPTION_OFF } from "../../src/lib/board/room-options.ts";
import { banOpen } from "./ban.ts";
import { queryBanTable } from "./ban-check.ts";
import { isGatheringId } from "../../src/lib/board/public-gathering.ts";

/**
 * RSVPs and attendance, stored on the server (migration 0049).
 *
 * The rule (Josh via CoS, Oct 30, 7:01–7:04 AM ET; replaces Oct 29's
 * "admins see all"; see src/lib/board/rsvp-rules.ts):
 *   - An admin, as an admin, gets counts only: GET /api/rsvps/summary.
 *     Never a respondent's name, email, id or handle, and no marking.
 *     Barred members are counted there, with no identity.
 *   - A gathering's host, and the stewards of its room, see who is going to,
 *     and who came to, that gathering, and mark who came. Barred members are
 *     hidden from them; other members' ids go out as handles.
 *   - An admin who really hosts or stewards gets that role's view and marks
 *     (Josh, Oct 30 7:54/7:55; ADMIN_ROLE_SEES_NAMES in rsvp-rules.ts).
 *   - Anyone else sees only their own "You're going". Never a name, never a number.
 *   - A member cannot mark themselves.
 * The same rule runs in SQL here and in forViewer (src/lib/board/model.ts).
 *
 *   GET  /api/rsvps                      the rows this viewer may see
 *   GET  /api/rsvps/summary              admin only: counts, no identities
 *   GET  /api/gatherings/:id/rsvps       mine; host and stewards also get `people`
 *   POST /api/gatherings/:id/rsvp        { going?: boolean, attended?: true (host or steward) }
 *   POST /api/gatherings/:id/attendance  host or steward: { userIds (handles from the list), close?, happened? }
 *   POST /api/rsvps/move                 the one-time move from this browser
 */

type SessionUser = { id: string; name: string; email: string };

export type RsvpDeps = {
  db: Db;
  readSession: (headers: Headers) => Promise<SessionUser | null>;
  now: () => Date;
};

export type RsvpRow = {
  gatheringId: string;
  roomId: string;
  userId: string;
  name: string;
  going: boolean;
  attended: boolean;
};

/** The one refusal for anyone who is not the host or a steward of the room. */
export const MARK_REFUSED = "Only the host or a steward of this room can mark who came.";

/** Before 0049 is applied. The client keeps the RSVP on the device for this code only. */
export const RSVP_NOT_READY = "rsvp-not-ready";
/** Same line as src/lib/board/rsvp-api.ts ROLL_CALL_STALE (a test keeps them equal). */
export const ROLL_CALL_STALE = "That list is out of date.";

/** The most rows one move or one roll call may carry. */
export const RSVP_BATCH_MAX = 200;

/** Exact match only: lowercase ids (as stored) and lowercase actions. */
const ONE = /^\/api\/gatherings\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(rsvps|rsvp|attendance)$/;

const LOOSE = /^\/api\/(rsvps(\/move|\/summary)?\/?|gatherings\/[^/]+\/(rsvps|rsvp|attendance)\/?)$/i;

/**
 * Every refusal from these routes says `api: "rsvp"`, so the client can tell
 * this API's 404 (no such gathering for you) from an API that predates the
 * RSVP routes (its 404 has no marker; the client keeps the RSVP on the device).
 */
function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const marked =
    status >= 400 && body && typeof body === "object" && !Array.isArray(body) ? { ...body, api: "rsvp" } : body;
  return new Response(JSON.stringify(marked), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

class BadBody extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readBody(request: Request, max = 32_768): Promise<Record<string, unknown>> {
  // Refuse a declared oversize body before reading any of it.
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) throw new BadBody(413, "That request is too large.");
  // No (or a false) Content-Length: read the stream and stop at the cap (QA S4).
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        void reader.cancel().catch(() => {});
        throw new BadBody(413, "That request is too large.");
      }
      chunks.push(value);
    }
  }
  const joined = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  const text = new TextDecoder().decode(joined);
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BadBody(400, "Send JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BadBody(400, "Send a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/** Before 0049 is applied the table is missing. Say so instead of a 500. */
function missingTable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return code === "42P01" || /gathering_rsvp" does not exist/.test(message);
}

type DbRow = {
  gathering_id: string;
  room_id: string;
  moved_from: string[];
  user_id: string;
  name: string;
  going: boolean;
  attended: boolean;
};

function toRow(row: DbRow): RsvpRow {
  return {
    gatheringId: row.gathering_id,
    roomId: row.room_id,
    userId: row.user_id,
    name: row.name,
    going: row.going === true,
    attended: row.attended === true,
  };
}

/**
 * No internal account ids in host or steward lists (Josh, Oct 29, 10:21 PM ET).
 * Other people's rows carry an opaque per-gathering handle in `userId` instead:
 * an HMAC of the gathering and the account under a key that never leaves the
 * server, so it cannot be turned back into an id or linked across gatherings.
 * The host sends handles back to mark who came; the server maps them. Admins
 * keep real ids. A viewer's own row keeps their own id.
 */
export { rsvpHandle } from "./rsvp-handle.ts";

export function withHandles(rows: RsvpRow[], reader: { userId: string }): RsvpRow[] {
  // Everyone, admins too, gets handles for other members: only my own row keeps my id.
  return rows.map((row) =>
    row.userId === reader.userId ? row : { ...row, userId: rsvpHandle(row.gatheringId, row.userId) },
  );
}

/** Handles from a roll call (or my own id), as account ids for this gathering. */
export async function idsFromHandles(
  db: Db,
  input: RsvpReader & { gatheringId: string; sent: string[]; now: Date },
): Promise<string[] | null> {
  // Only rows this reader can see: a barred member, hidden from the list,
  // cannot be marked by handle or by id (QA S4).
  const rows = await readRsvps(db, { ...input, gatheringIds: [input.gatheringId] });
  const byHandle = new Map(rows.map((row) => [rsvpHandle(input.gatheringId, row.userId), row.userId]));
  const ids = new Set(rows.map((row) => row.userId));
  const out: string[] = [];
  for (const sent of input.sent) {
    const id = byHandle.get(sent) ?? (sent === input.userId && ids.has(sent) ? sent : undefined);
    // A stale or unknown entry fails the whole call: marking the rest would
    // silently drop someone the host picked (QA S4).
    if (!id) return null;
    out.push(id);
  }
  return out;
}

/** Who is reading. `stewardRooms` is from actorRole: rooms this person actually stewards. */
export type RsvpReader = { userId: string; admin: boolean; stewardRooms: readonly string[] };

/**
 * The only read, filtered in SQL so a row this viewer may not see never
 * leaves the database:
 *   - my own row, always;
 *   - the host of a gathering gets every row for it, going and came;
 *   - a steward of the gathering's room gets every row for it, going and came;
 *   - an admin gets nothing more as an admin (counts are in rsvpSummary);
 *     as a real host or steward, that role's view (ADMIN_ROLE_SEES_NAMES).
 */
export async function readRsvps(
  db: Db,
  input: RsvpReader & { gatheringIds: string[]; now?: Date },
): Promise<RsvpRow[]> {
  if (input.gatheringIds.length === 0) return [];
  const rows = await db.query<DbRow>(
    `select r.gathering_id, g.room_id, r.user_id, u.name, r.going,
            r.attended, ${GATHERING_0050_COLUMNS}
     from gathering_rsvp r
     join "user" u on u.id = r.user_id
     join public_gathering g on g.id = r.gathering_id
     where r.gathering_id = any ($1::text[])
       -- Only a special event has RSVPs (Josh via CoS, Oct 30 12:47 PM ET).
       and ${GATHERING_IS_SPECIAL}
       and (
         r.user_id = $3
         or ($2::boolean and g.host_user_id = $3)
         or ($2::boolean and g.room_id <> '' and g.room_id = any ($4::text[]))
       )
     order by r.gathering_id, u.name, r.user_id`,
    [input.gatheringIds, roleCounts(input.admin), input.userId, [...input.stewardRooms]],
  );
  // The rooms each gathering was in before a move: a bar there still hides (0050).
  const movedFrom = new Map(rows.map((row) => [row.gathering_id, row.moved_from ?? []]));
  return hideBanned(db, rows.map(toRow), { viewer: input.userId, now: input.now ?? new Date(), movedFrom });
}

/**
 * A member barred from the board, or from the gathering's room, drops out of
 * everyone else's lists (and so out of the roll call). Their own row still
 * reads back to them. The rule is banOpen's, applied in code, not copied
 * into SQL.
 */
async function hideBanned(
  db: Db,
  rows: RsvpRow[],
  input: { viewer: string; now: Date; movedFrom?: ReadonlyMap<string, readonly string[]> },
): Promise<RsvpRow[]> {
  const others = [...new Set(rows.filter((row) => row.userId !== input.viewer).map((row) => row.userId))];
  if (others.length === 0) return rows;
  const bans = await queryBanTable<{ user_id: string; room_id: string; strikes: number; until_at: Date | string; reason: string }>(
    db,
    `select user_id, room_id, strikes, until_at, reason from board_ban where user_id = any ($1::text[])`,
    [others],
  );
  const now = input.now.getTime();
  const barred = (row: RsvpRow) =>
    bans.some(
      (ban) =>
        ban.user_id === row.userId &&
        (ban.room_id === "" ||
          ban.room_id === row.roomId ||
          // Barred in a room this gathering moved out of: still hidden (Josh, Oct 30 12:47 PM ET).
          (input.movedFrom?.get(row.gatheringId) ?? []).includes(ban.room_id)) &&
        banOpen(
          {
            reason: ban.reason,
            strikes: Number(ban.strikes),
            until: typeof ban.until_at === "string" ? new Date(ban.until_at).getTime() : ban.until_at.getTime(),
          },
          now,
        ),
    );
  return rows.filter((row) => row.userId === input.viewer || !barred(row));
}

/**
 * Whether this viewer may read anyone else's row for one gathering, and mark
 * who came: its host or a steward of its room. Being an admin adds nothing.
 */
export function seesPeople(
  reader: RsvpReader,
  gathering: { hostUserId: string; roomId: string },
): boolean {
  if (!roleCounts(reader.admin)) return false;
  return (
    gathering.hostUserId === reader.userId ||
    (gathering.roomId !== "" && reader.stewardRooms.includes(gathering.roomId))
  );
}
/** Marking who came: the same people who read the list (host and stewards). */
export const marksCame = seesPeople;

/** Set or clear my own RSVP. `attended` only ever turns on, as "I went" does on the device. */
export async function setMyRsvp(
  db: Db,
  input: { userId: string; gatheringId: string; going?: boolean; attended?: boolean },
): Promise<{ going: boolean; attended: boolean }> {
  const going = input.going;
  const attended = input.attended === true ? true : undefined;
  if (going === undefined && attended === undefined) {
    const rows = await db.query<{ going: boolean; attended: boolean }>(
      `select going, attended from gathering_rsvp where gathering_id = $1 and user_id = $2`,
      [input.gatheringId, input.userId],
    );
    return { going: rows[0]?.going === true, attended: rows[0]?.attended === true };
  }
  if (going === false && attended === undefined) {
    // Clearing "going". A row that also says "I've been" keeps that; a row
    // with nothing left to say is removed, never kept empty.
    await db.query(
      `delete from gathering_rsvp where gathering_id = $1 and user_id = $2 and not attended`,
      [input.gatheringId, input.userId],
    );
    // Only a row that also says "came" is left to update. A "going" that
    // lands between the two statements (a second tap, another device) has
    // attended = false, so it is not touched here and can never become an
    // all-false row (the check would answer 500).
    await db.query(
      `update gathering_rsvp set going = false, updated_at = now()
       where gathering_id = $1 and user_id = $2 and going and attended`,
      [input.gatheringId, input.userId],
    );
    return setMyRsvp(db, { userId: input.userId, gatheringId: input.gatheringId });
  }
  const rows = await db.query<{ going: boolean; attended: boolean }>(
    `insert into gathering_rsvp as r (gathering_id, user_id, going, attended)
     values ($1, $2, coalesce($3::boolean, false), coalesce($4::boolean, false))
     on conflict (gathering_id, user_id) do update set
       going = coalesce($3::boolean, r.going),
       attended = r.attended or coalesce($4::boolean, false),
       updated_at = now()
     returning going, attended`,
    [input.gatheringId, input.userId, going ?? null, attended ?? null],
  );
  const row = rows[0];
  return { going: row?.going === true, attended: row?.attended === true };
}

/**
 * Roll call. Only people who said they would come can be marked as having
 * come. `close` ends the date: every "going" resets, as the device does.
 * The host sends the member ids from their own roll call (the host can read
 * who is going to their gathering), so attendance is recorded on the server
 * for a host who is not an admin too. The answer names nobody.
 */
export async function markAttendance(
  db: Db,
  input: { gatheringId: string; userIds: string[]; unmark?: string[]; close: boolean; check?: (tx: Db) => Promise<boolean> },
): Promise<boolean> {
  const ids = [...new Set(input.userIds)].slice(0, RSVP_BATCH_MAX);
  const unmark = [...new Set(input.unmark ?? [])].slice(0, RSVP_BATCH_MAX);
  const run = async (tx: Db): Promise<boolean> => {
    if (input.check) {
      // Lock this gathering's rows, then check the host's list inside the same
      // transaction, so an RSVP that lands between the check and the close
      // cannot be deleted by it (QA S4 #5).
      // The gathering row first: a first-time RSVP insert takes a key-share
      // lock on it (the foreign key), so it waits for this close (QA S3 #2).
      await tx.query(`select 1 from public_gathering where id = $1 for update`, [input.gatheringId]);
      await tx.query(`select 1 from gathering_rsvp where gathering_id = $1 for update`, [input.gatheringId]);
      if (!(await input.check(tx))) return false;
    }
    if (ids.length > 0) {
      await tx.query(
        `update gathering_rsvp set attended = true, updated_at = now()
         where gathering_id = $1 and going = true and user_id = any ($2::text[])`,
        [input.gatheringId, ids],
      );
    }
    if (unmark.length > 0) {
      // Taking a mark back. A row left saying nothing is removed, never kept
      // empty (the check would refuse it). attended is one flag per member
      // and gathering, so this also clears an earlier date's mark.
      await tx.query(
        `delete from gathering_rsvp where gathering_id = $1 and not going and user_id = any ($2::text[])`,
        [input.gatheringId, unmark],
      );
      await tx.query(
        `update gathering_rsvp set attended = false, updated_at = now()
         where gathering_id = $1 and going and user_id = any ($2::text[])`,
        [input.gatheringId, unmark],
      );
    }
    if (input.close) {
      await tx.query(`delete from gathering_rsvp where gathering_id = $1 and not attended`, [
        input.gatheringId,
      ]);
      // As in setMyRsvp: a "going" for the next date that arrives during the
      // close is left alone, so the close never fails on the check.
      await tx.query(
        `update gathering_rsvp set going = false, updated_at = now()
         where gathering_id = $1 and going and attended`,
        [input.gatheringId],
      );
    }
    return true;
  };
  return db.transaction(run);
}

export { RSVP_RETENTION_MONTHS, rsvpCutoff } from "./rsvp-retention.ts";
/** One delete removes at most this many rows; a run stops after RSVP_PURGE_ROUNDS. */
export const RSVP_PURGE_BATCH = 1000;
const RSVP_PURGE_ROUNDS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;


/**
 * Retention: "Delete attendance records after 12 months." (Josh, Oct 29,
 * 9:29 PM ET). Runs in the API, not in 0049. A row is deleted, going and
 * attended alike, when either:
 *   - its gathering's date (gather_on, YYYY-MM-DD) is more than 12 months
 *     ago: the gathering ended and was never given a later date; or
 *   - nobody has touched it for 12 months (updated_at, from 0049), whether it
 *     says "going", "came" or both. A weekly meeting keeps moving its date
 *     forward, and a gathering may have no date, so this is what ages out a
 *     row on a gathering that still meets or never had a date (QA r5707425337);
 *   - its gathering was removed, or its room no longer exists (no route can
 *     reach those rows). Removing a gathering also deletes its rows at once
 *     (removeGathering); this catches anything left from before.
 * Deletes run in bounded batches. Before 0049 is applied there is no table,
 * and this does nothing.
 */
export async function purgeOldRsvps(
  db: Db,
  now: Date,
  /** Tests only: the purge with the other setting of OLD_WRITE_UPS_DROP_DM_LINKS. */
  dropDmLinks: boolean = OLD_WRITE_UPS_DROP_DM_LINKS,
): Promise<{ deleted: number; writeUps?: number }> {
  const present = await db.query<{ present: string | null }>(
    `select to_regclass('public.gathering_rsvp')::text as present`,
  );
  const cutoff = rsvpCutoff(now);
  if (!present[0]?.present) return { deleted: 0, writeUps: await purgeOldWriteUpNames(db, cutoff, dropDmLinks) };
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  let deleted = 0;
  for (let round = 0; round < RSVP_PURGE_ROUNDS; round += 1) {
    const rows = await db.query<{ gathering_id: string }>(
      `delete from gathering_rsvp d
       using (
         select r.gathering_id, r.user_id
         from gathering_rsvp r
         join public_gathering g on g.id = r.gathering_id
         where (g.gather_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and g.gather_on < $1)
            or r.updated_at < $2
            or g.removed
            or (g.room_id <> '' and not exists (select 1 from room where room.id = g.room_id))
         limit $3
       ) old
       where d.gathering_id = old.gathering_id and d.user_id = old.user_id
       returning d.gathering_id`,
      [cutoffDay, cutoff, RSVP_PURGE_BATCH],
    );
    deleted += rows.length;
    if (rows.length < RSVP_PURGE_BATCH) break;
  }
  const writeUps = await purgeOldWriteUpNames(db, cutoff, dropDmLinks);
  console.log(JSON.stringify({ event: "rsvp-retention-purge", deleted, writeUps }));
  return { deleted, writeUps };
}

/**
 * QA N3, decided: "the purge also deletes write-up DM links older than 12
 * months" (Josh via CoS, Oct 30 12:47 PM ET), so this stays true. dm_named_account links
 * a write-up to the accounts its roll call named, and those links are what
 * make two people "met at a meeting" for DMs: whether they may message, the
 * peer list, and confirming attendance (server/dm/store.ts REAL_MEETINGS).
 * true (now, under Josh's 12-month rule): a write-up older than 12 months
 * loses its links, so someone named only there loses that DM eligibility.
 * false: the links stay and that eligibility stays; the came list itself
 * is still cleared, so a write-up with no link (named by name only) loses
 * it either way. Either way the room member list shows no "came" date older
 * than 12 months: it reads the came list and the 12-month window, never a
 * link alone (QA N4, server/board/members.ts). This switch only moves DM
 * eligibility.
 */
export const OLD_WRITE_UPS_DROP_DM_LINKS = true;

/**
 * Josh's 12-month rule covers who came on a write-up too (QA F3, Oct 30): a
 * hosted write-up older than the cutoff (by its date, or when it was filed if
 * it has none) loses its came list and its named-account links, so no one
 * reads an old "came" date for a member. The write-up itself stays. This
 * deletes data. Queries only; no schema change. Dropping the links also
 * ends DM "met at a meeting" eligibility from that write-up: see
 * OLD_WRITE_UPS_DROP_DM_LINKS.
 */
async function purgeOldWriteUpNames(db: Db, cutoff: Date, dropDmLinks: boolean): Promise<number> {
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  // The exact inverse of what the readers keep (members.ts, came-sight.ts):
  // one predicate, so the purge and the readers cannot drift (QA N9).
  const old = `p.type = 'hosted' and not ${writeUpWithin("$1", "$2")}`;
  const named = await db.query<{ ready: string | null }>(`select to_regclass('public.dm_named_account')::text as ready`);
  if (dropDmLinks && named[0]?.ready) {
    await db.query(
      `delete from dm_named_account n using board_post p where n.post_id = p.id and ${old}`,
      [cutoffDay, cutoff],
    );
  }
  const stripped = await db.query<{ id: string }>(
    `update board_post p set came = '{}' where ${old} and cardinality(p.came) > 0 returning p.id`,
    [cutoffDay, cutoff],
  );
  return stripped.length;
}

/** Runs once at start and then every 24 hours, like the security-log purge. */
export function startRsvpRetention(db: Db, now: () => Date = () => new Date()): () => void {
  const run = () => {
    void purgeOldRsvps(db, now()).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          event: "rsvp-retention-purge-failed",
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
    });
  };
  run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}

export type MoveEntry = { gatheringId: string; going: boolean; attended: boolean };

/** Read the move body. Bad rows are dropped; nothing here is about anyone else. */
export function moveEntries(value: unknown): MoveEntry[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > RSVP_BATCH_MAX) return null;
  const seen = new Map<string, MoveEntry>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.gatheringId !== "string" || !isGatheringId(row.gatheringId)) continue;
    const going = row.going === true;
    const attended = row.attended === true;
    if (!going && !attended) continue;
    const id = row.gatheringId.toLowerCase();
    const prior = seen.get(id);
    seen.set(id, {
      gatheringId: id,
      going: going || Boolean(prior?.going),
      attended: attended || Boolean(prior?.attended),
    });
  }
  return [...seen.values()];
}

/**
 * The one-time move. It only ever turns my own flags on, so running it twice
 * changes nothing. A gathering this member cannot see is skipped quietly.
 * A self-marked "I've been" from the device is kept only when I am that
 * gathering's host or a steward of its room; anyone else's is dropped,
 * because only they mark who came. An entry left with nothing is skipped.
 */
export async function moveMyRsvps(
  db: Db,
  input: { userId: string; entries: MoveEntry[]; now: Date },
): Promise<string[]> {
  const saved: string[] = [];
  for (const raw of input.entries) {
    const gate = await rsvpGatheringFor(db, { userId: input.userId, id: raw.gatheringId, now: input.now });
    if (!gate.ok) continue;
    // Not a special event: it takes no RSVPs, so the device's is not moved.
    if (!gate.gathering.special) continue;
    const marks = marksCame(
      { userId: input.userId, admin: gate.actor.admin, stewardRooms: gate.actor.stewardRooms },
      gate.gathering,
    );
    // Not before the gathering, and only with a "going" (QA F4).
    const entry = { ...raw, attended: raw.attended && marks && raw.going && markOpen(gate.gathering, input.now) };
    if (!entry.going && !entry.attended) continue;
    await db.query(
      `insert into gathering_rsvp as r (gathering_id, user_id, going, attended)
       values ($1, $2, $3, $4)
       on conflict (gathering_id, user_id) do update set
         going = r.going or excluded.going,
         attended = r.attended or excluded.attended,
         updated_at = now()`,
      [gate.gathering.id, input.userId, entry.going, entry.attended],
    );
    saved.push(gate.gathering.id);
  }
  return saved;
}

export async function handleRsvp(
  deps: RsvpDeps,
  request: Request,
  url: URL,
): Promise<Response | null> {
  const one = ONE.exec(url.pathname);
  const list = url.pathname === "/api/rsvps";
  const move = url.pathname === "/api/rsvps/move";
  const summary = url.pathname === "/api/rsvps/summary";
  if (!one && !list && !move && !summary) {
    // Oddly cased or trailing-slash forms of these routes: 404 with the marker (QA S4).
    if (LOOSE.test(url.pathname)) return json(404, { error: "Not found." });
    return null;
  }
  const action = one?.[2] ?? "";
  const method = request.method;
  const matched =
    (list && method === "GET") ||
    (summary && method === "GET") ||
    (move && method === "POST") ||
    (action === "rsvps" && method === "GET") ||
    ((action === "rsvp" || action === "attendance") && method === "POST");
  if (!matched) {
    const allow = list || summary || action === "rsvps" ? "GET" : "POST";
    return json(405, { error: "Method not allowed." }, { allow });
  }

  const session = await deps.readSession(request.headers);
  if (!session) return json(401, { error: "Sign in first." });
  const limited = await limitBoard(deps.db, request, session.id, method === "GET" ? "read" : "write");
  if (limited) return limited;
  const now = deps.now();

  try {
    if (summary) {
      // Admin-only counts: no names, emails, ids or handles (rsvp-summary.ts).
      const actor = await actorRole(deps.db, session.id);
      if (!actor.admin) return json(403, { error: "These counts are for an admin." });
      return json(200, await rsvpSummary(deps.db, now));
    }
    if (list) {
      const actor = await actorRole(deps.db, session.id);
      const gatherings = await listGatheringsFor(deps.db, { userId: session.id, now });
      const rsvps = await readRsvps(deps.db, {
        userId: session.id,
        gatheringIds: gatherings.map((row) => row.id),
        admin: actor.admin,
        stewardRooms: actor.stewardRooms,
        now,
      });
      return json(200, {
        viewer: session.id,
        // Says only whether the summary link shows; the rows below are this
        // viewer's own, or a host's or steward's, never an admin's extra.
        admin: actor.admin,
        // Which gatherings I host, and which rooms I steward: the client
        // applies the same rule again (forViewer) with these.
        hosts: gatherings.filter((row) => row.mine).map((row) => row.id),
        stewardRooms: actor.stewardRooms,
        rsvps: withHandles(rsvps, { userId: session.id }),
      });
    }

    if (move) {
      const body = await readBody(request);
      const entries = moveEntries(body.entries);
      if (!entries) return json(400, { error: `Send up to ${RSVP_BATCH_MAX} entries.` });
      const saved = await moveMyRsvps(deps.db, { userId: session.id, entries, now });
      return json(200, { ok: true, saved });
    }

    const body = method === "POST" ? await readBody(request) : {};
    // Only "not going", with nothing else: a barred member may still clear their own.
    const clearingOwn =
      action === "rsvp" && body.going === false && Object.keys(body).length === 1;
    const gate = await rsvpGatheringFor(deps.db, { userId: session.id, id: one?.[1] ?? "", now, clearingOwn });
    if (!gate.ok) return json(gate.status, { error: gate.error });
    const gatheringId = gate.gathering.id;
    // Only a special event takes an RSVP or a mark (Josh via CoS, Oct 30
    // 12:47 PM ET). Clearing my own "going" is always allowed.
    if (action !== "rsvps" && !clearingOwn && !gate.gathering.special) {
      return json(409, { error: RSVP_SPECIAL_ONLY });
    }

    const reader: RsvpReader = {
      userId: session.id,
      admin: gate.actor.admin,
      stewardRooms: gate.actor.stewardRooms,
    };
    const host = gate.gathering.hostUserId === session.id;

    if (action === "rsvps") {
      const rows = await readRsvps(deps.db, { ...reader, gatheringIds: [gatheringId], now });
      const mine = rows.find((row) => row.userId === session.id);
      return json(200, {
        mine: { going: mine?.going === true, attended: mine?.attended === true },
        ...(seesPeople(reader, gate.gathering) ? { people: withHandles(rows, reader) } : {}),
      });
    }

    // A room with roll off records nobody as having come (QA r5707425337).
    // A close with no names still clears the going list.
    const rollOff = async () =>
      gate.gathering.roomId !== "" && !(await roomOptions(deps.db, gate.gathering.roomId)).includes("roll_call");

    if (action === "rsvp") {
      const going = body.going === true ? true : body.going === false ? false : undefined;
      if ("going" in body && going === undefined) return json(400, { error: "Say whether you are going." });
      if ("attended" in body && body.attended !== true) {
        return json(400, { error: "Say that you came, or leave it out." });
      }
      // A member cannot mark themselves as having come. The host and the
      // room's stewards can; an admin as an admin cannot.
      if (body.attended === true && !marksCame(reader, gate.gathering)) {
        return json(403, { error: !roleCounts(reader.admin) ? ADMIN_NO_NAMES : MARK_REFUSED });
      }
      if (body.attended === true && (await rollOff())) {
        return json(409, { error: ROOM_OPTION_OFF.roll_call });
      }
      if (body.attended === true) {
        // Not before the gathering, and only after saying "going" (QA F4).
        if (!markOpen(gate.gathering, now)) return json(409, { error: MARK_TOO_EARLY });
        const own = await setMyRsvp(deps.db, { userId: session.id, gatheringId });
        if (!own.going && !own.attended) return json(409, { error: MARK_NOT_GOING });
      }
      const mine = await setMyRsvp(deps.db, {
        userId: session.id,
        gatheringId,
        ...(going === undefined ? {} : { going }),
        ...(body.attended === true ? { attended: true } : {}),
      });
      return json(200, { mine });
    }

    // attendance
    if (!marksCame(reader, gate.gathering)) {
      return json(403, { error: !roleCounts(reader.admin) ? ADMIN_NO_NAMES : MARK_REFUSED });
    }
    if ("close" in body && typeof body.close !== "boolean") {
      return json(400, { error: "Say whether this closes the date: true or false." });
    }
    if ("happened" in body && typeof body.happened !== "boolean") {
      return json(400, { error: "Say whether it happened: true or false." });
    }
    const raw = body.userIds ?? [];
    if (!Array.isArray(raw) || raw.length > RSVP_BATCH_MAX || raw.some((id) => typeof id !== "string")) {
      return json(400, { error: `Send up to ${RSVP_BATCH_MAX} member ids.` });
    }
    // "It did not happen" marks nobody (QA S3). The attended marks an earlier
    // close of this date set are not cleared: `attended` is one flag per
    // member and gathering, not per date, so clearing it would also erase
    // earlier weeks. Doing that needs a per-date column (a migration).
    if (body.happened === false && raw.length > 0) {
      return json(400, { error: DID_NOT_NAMES });
    }
    if (raw.length > 0 && (await rollOff())) {
      return json(409, { error: ROOM_OPTION_OFF.roll_call });
    }
    // Taking a mark back (QA F4): handles of members already marked as came.
    const unmarkRaw = body.unmark ?? [];
    if (!Array.isArray(unmarkRaw) || unmarkRaw.length > RSVP_BATCH_MAX || unmarkRaw.some((id) => typeof id !== "string")) {
      return json(400, { error: `Send up to ${RSVP_BATCH_MAX} member ids.` });
    }
    if (unmarkRaw.some((id) => (raw as string[]).includes(id as string))) {
      return json(400, { error: "A member cannot be marked and unmarked at once." });
    }
    // No marks before the gathering's date or start time (QA F4).
    if (raw.length > 0 && !markOpen(gate.gathering, now)) {
      return json(409, { error: MARK_TOO_EARLY });
    }
    const userIds = await idsFromHandles(deps.db, {
      ...reader,
      gatheringId,
      sent: raw as string[],
      now,
    });
    if (!userIds) return json(409, { error: ROLL_CALL_STALE });
    const unmarkIds = await idsFromHandles(deps.db, { ...reader, gatheringId, sent: unmarkRaw as string[], now });
    if (!unmarkIds) return json(409, { error: ROLL_CALL_STALE });
    if (userIds.length > 0) {
      // Only members who said they're going (or are already marked) can be marked (QA F4).
      const rows = await readRsvps(deps.db, { ...reader, gatheringIds: [gatheringId], now });
      const byId = new Map(rows.map((row) => [row.userId, row]));
      if (userIds.some((id) => !byId.get(id)?.going && !byId.get(id)?.attended)) {
        return json(409, { error: MARK_NOT_GOING });
      }
    }
    let check: ((tx: Db) => Promise<boolean>) | undefined;
    if (body.close === true) {
      // A close clears every "going". Refuse one from a list that never showed
      // someone who is going now (a retry after a stale roll call, another
      // tab), so a close cannot wipe RSVPs the host never saw (QA S3).
      const seenRaw = body.seen ?? [];
      if (!Array.isArray(seenRaw) || seenRaw.length > RSVP_BATCH_MAX || seenRaw.some((id) => typeof id !== "string")) {
        return json(400, { error: `Send up to ${RSVP_BATCH_MAX} member ids.` });
      }
      const seen = new Set([...(seenRaw as string[]), ...(raw as string[])]);
      check = async (tx) => {
        const rows = await readRsvps(tx, { ...reader, gatheringIds: [gatheringId], now });
        return !rows.some(
          (row) =>
            row.going &&
            !seen.has(rsvpHandle(gatheringId, row.userId)) &&
            !(row.userId === reader.userId && seen.has(row.userId)),
        );
      };
    }
    const done = await markAttendance(deps.db, {
      gatheringId,
      userIds,
      unmark: unmarkIds,
      close: body.close === true,
      ...(check ? { check } : {}),
    });
    if (!done) return json(409, { error: ROLL_CALL_STALE });
    return json(200, { ok: true });
  } catch (error) {
    if (error instanceof BadBody) return json(error.status, { error: error.message });
    if (missingTable(error)) return json(503, { error: RSVP_NOT_READY });
    throw error;
  }
}
