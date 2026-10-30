import type { Db } from "../db.ts";
import { limitBoard } from "./routes.ts";
import { listGatheringsFor, rsvpGatheringFor } from "./gathering-record.ts";
import { actorRole } from "./access.ts";
import { isGatheringId } from "../../src/lib/board/public-gathering.ts";

/**
 * RSVPs and attendance, stored on the server (migration 0049).
 *
 * Josh's rule (#91, then Oct 29): a member sees only their own "You're
 * going" or "You've been", never anyone else's and never a number. An admin
 * sees the full list. The host is not an admin for this: a host can close a
 * date and mark who came from those who said they would, but reading the
 * list is admin only, the same as forViewer in src/lib/board/model.ts.
 *
 *   GET  /api/rsvps                      my rows; an admin gets every row
 *   GET  /api/gatherings/:id/rsvps       mine; an admin also gets `people`
 *   POST /api/gatherings/:id/rsvp        { going?: boolean, attended?: true }
 *   POST /api/gatherings/:id/attendance  host or admin: { userIds, close? }
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
  userId: string;
  name: string;
  going: boolean;
  attended: boolean;
};

/** The most rows one move or one roll call may carry. */
export const RSVP_BATCH_MAX = 200;

const ONE = /^\/api\/gatherings\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(rsvps|rsvp|attendance)$/i;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
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
  const text = await request.text();
  if (text.length > max) throw new BadBody(413, "That request is too large.");
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

type DbRow = { gathering_id: string; user_id: string; name: string; going: boolean; attended: boolean };

function toRow(row: DbRow): RsvpRow {
  return {
    gatheringId: row.gathering_id,
    userId: row.user_id,
    name: row.name,
    going: row.going === true,
    attended: row.attended === true,
  };
}

/**
 * The only read. A non-admin's query is filtered to their own user id in
 * SQL, so another member's row never leaves the database for them.
 */
export async function readRsvps(
  db: Db,
  input: { userId: string; gatheringIds: string[]; admin: boolean },
): Promise<RsvpRow[]> {
  if (input.gatheringIds.length === 0) return [];
  const rows = await db.query<DbRow>(
    `select r.gathering_id, r.user_id, u.name, r.going, r.attended
     from gathering_rsvp r join "user" u on u.id = r.user_id
     where r.gathering_id = any ($1::text[])
       and ($2::boolean or r.user_id = $3)
     order by r.gathering_id, u.name, r.user_id`,
    [input.gatheringIds, input.admin, input.userId],
  );
  return rows.map(toRow);
}

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
    await db.query(
      `update gathering_rsvp set going = false, updated_at = now()
       where gathering_id = $1 and user_id = $2 and going`,
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
 * The answer carries nothing about anyone, so a host who is not an admin
 * learns no names from it.
 */
export async function markAttendance(
  db: Db,
  input: { gatheringId: string; userIds: string[]; close: boolean },
): Promise<void> {
  const ids = [...new Set(input.userIds)].slice(0, RSVP_BATCH_MAX);
  const run = async (tx: Db) => {
    if (ids.length > 0) {
      await tx.query(
        `update gathering_rsvp set attended = true, updated_at = now()
         where gathering_id = $1 and going = true and user_id = any ($2::text[])`,
        [input.gatheringId, ids],
      );
    }
    if (input.close) {
      await tx.query(`delete from gathering_rsvp where gathering_id = $1 and not attended`, [
        input.gatheringId,
      ]);
      await tx.query(
        `update gathering_rsvp set going = false, updated_at = now() where gathering_id = $1 and going`,
        [input.gatheringId],
      );
    }
  };
  await db.transaction(run);
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
 */
export async function moveMyRsvps(
  db: Db,
  input: { userId: string; entries: MoveEntry[]; now: Date },
): Promise<string[]> {
  const saved: string[] = [];
  for (const entry of input.entries) {
    const gate = await rsvpGatheringFor(db, { userId: input.userId, id: entry.gatheringId, now: input.now });
    if (!gate.ok) continue;
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
  if (!one && !list && !move) return null;
  const action = one?.[2]?.toLowerCase() ?? "";
  const method = request.method;
  const matched =
    (list && method === "GET") ||
    (move && method === "POST") ||
    (action === "rsvps" && method === "GET") ||
    ((action === "rsvp" || action === "attendance") && method === "POST");
  if (!matched) return json(405, { error: "Not found." });

  const session = await deps.readSession(request.headers);
  if (!session) return json(401, { error: "Sign in first." });
  const limited = await limitBoard(deps.db, request, session.id, method === "GET" ? "read" : "write");
  if (limited) return limited;
  const now = deps.now();

  try {
    if (list) {
      const actor = await actorRole(deps.db, session.id);
      const gatherings = await listGatheringsFor(deps.db, { userId: session.id, now });
      const rsvps = await readRsvps(deps.db, {
        userId: session.id,
        gatheringIds: gatherings.map((row) => row.id),
        admin: actor.admin,
      });
      return json(200, { viewer: session.id, admin: actor.admin, rsvps });
    }

    if (move) {
      const body = await readBody(request);
      const entries = moveEntries(body.entries);
      if (!entries) return json(400, { error: `Send up to ${RSVP_BATCH_MAX} entries.` });
      const saved = await moveMyRsvps(deps.db, { userId: session.id, entries, now });
      return json(200, { ok: true, saved });
    }

    const gate = await rsvpGatheringFor(deps.db, { userId: session.id, id: one?.[1] ?? "", now });
    if (!gate.ok) return json(gate.status, { error: gate.error });
    const gatheringId = gate.gathering.id;

    if (action === "rsvps") {
      const rows = await readRsvps(deps.db, {
        userId: session.id,
        gatheringIds: [gatheringId],
        admin: gate.actor.admin,
      });
      const mine = rows.find((row) => row.userId === session.id);
      return json(200, {
        mine: { going: mine?.going === true, attended: mine?.attended === true },
        ...(gate.actor.admin ? { people: rows } : {}),
      });
    }

    const body = await readBody(request);

    if (action === "rsvp") {
      const going = body.going === true ? true : body.going === false ? false : undefined;
      if ("going" in body && going === undefined) return json(400, { error: "Say whether you are going." });
      if ("attended" in body && body.attended !== true) {
        return json(400, { error: "Only an admin or the host changes who came." });
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
    const host = gate.gathering.hostUserId === session.id;
    if (!host && !gate.actor.admin) {
      return json(403, { error: "Only the host or an admin marks who came." });
    }
    const raw = body.userIds ?? [];
    if (!Array.isArray(raw) || raw.length > RSVP_BATCH_MAX || raw.some((id) => typeof id !== "string")) {
      return json(400, { error: `Send up to ${RSVP_BATCH_MAX} member ids.` });
    }
    await markAttendance(deps.db, {
      gatheringId,
      userIds: raw as string[],
      close: body.close === true,
    });
    return json(200, { ok: true });
  } catch (error) {
    if (error instanceof BadBody) return json(error.status, { error: error.message });
    if (missingTable(error)) return json(503, { error: "RSVPs are not on the server yet." });
    throw error;
  }
}
