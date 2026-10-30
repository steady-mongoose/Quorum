import type { Db } from "../db.ts";
import { CALLS_LIMIT, consumeLimit } from "../rate-limit.ts";
import { createIceSource, publicCallsStatus, type CallsConfig, type IceSource } from "./config.ts";
import { bindTurnRelease } from "./evict.ts";
import {
  blockedEitherWay,
  canRing,
  createRingStore,
  dmOther,
  memberName,
  ringableMembers,
  type Ring,
  type RingStore,
} from "./rings.ts";
import { callDisplayName as ringName } from "./store.ts";
import { roomCallMember } from "./membership.ts";
import { dmCallMember, type DmCallCheck } from "./dm-membership.ts";
import { callDisplayName, type CallStore } from "./store.ts";

export type CallsRuntime = {
  config: CallsConfig;
  store: CallStore;
  now: () => Date;
  /** Tests may stub the DM rule. Production reads dm_thread and attendance. */
  dmMember?: (db: Db, userId: string, threadId: string, now: Date) => Promise<DmCallCheck>;
  /** Cloudflare Realtime TURN or coturn. Defaults to the shared process source. */
  ice?: IceSource;
  rings?: RingStore;
  roomMember?: typeof roomCallMember;
  canRing?: (db: Db, userId: string, roomId: string) => Promise<boolean>;
  /** Tests may stub these reads. Production reads "user" and dm_thread. */
  memberName?: (db: Db, userId: string) => Promise<string>;
  dmOther?: (
    db: Db,
    userId: string,
    threadId: string,
  ) => Promise<{ id: string; name: string } | null>;
  /** Tests may stub the block check. Production reads dm_block. */
  blocked?: (db: Db, a: string, b: string) => Promise<boolean>;
};

/** The caller's note when the per-caller ring cap stops a ring. */
export const RING_CAP_ERROR = "You've called a lot of people just now. Try again in a few minutes.";
/** Same words for a block, a closed inbox, or anything else that refuses a DM call. */
export const DM_CALL_REFUSED = "This member isn't taking messages right now.";
/** Same words for a block or for someone who can't join this room's call. */
export const ROOM_RING_REFUSED = "That member can't join this room's call.";

const defaultIce = createIceSource();
bindTurnRelease((userId, prefix) => defaultIce.release(userId, prefix));
const defaultRings = createRingStore();

/** A DM call holds exactly the two people in the thread. */
export const DM_CALL_PEERS = 2;

function json(status: number, body: unknown, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const claimed = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(claimed) && claimed > 16_384) {
    return Promise.reject(Object.assign(new Error("That request is too large."), { status: 413 }));
  }
  const text = await request.text();
  if (text.length > 16_384) {
    return Promise.reject(Object.assign(new Error("That request is too large."), { status: 413 }));
  }
  if (!text) return {};
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return Promise.reject(Object.assign(new Error("Send JSON."), { status: 400 }));
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Promise.reject(Object.assign(new Error("Send a JSON object."), { status: 400 }));
  }
  return body as Record<string, unknown>;
}

const roomPath = /^\/api\/calls\/rooms\/([a-z0-9-]{1,32})(\/(?:join|leave|signal|ring))?$/;
const ringPath = /^\/api\/calls\/rings(?:\/(r\d{1,12})\/(dismiss|decline))?$/;

/** What the person rung sees. Room rings keep the old shape. */
function ringRow(ring: Ring) {
  return ring.kind === "dm"
    ? { id: ring.id, kind: "dm", threadId: ring.roomId, fromName: ring.fromName }
    : { id: ring.id, kind: "room", roomId: ring.roomId, fromName: ring.fromName };
}
const dmPath = /^\/api\/calls\/dm\/([0-9a-f-]{36})(\/(?:join|leave|signal))?$/;

/**
 * Group calls for one room. The session user is the only identity. Signals
 * are offer, answer, and ICE, kept in memory until the peer leaves. There is
 * no recording route and no place to put a recording.
 */
export async function handleCalls(
  runtime: CallsRuntime,
  db: Db,
  request: Request,
  url: URL,
  session: { id: string; name: string } | null,
): Promise<Response> {
  const { pathname } = url;
  if (pathname === "/api/calls/status" && request.method === "GET") {
    return json(200, publicCallsStatus(runtime.config));
  }
  if (!pathname.startsWith("/api/calls")) {
    return json(404, { error: "Not found." });
  }
  if (!runtime.config.enabled) return json(404, { error: "Not found." });

  const rings = runtime.rings ?? defaultRings;
  const ringMatch = ringPath.exec(pathname);
  if (ringMatch) {
    if (!session) return json(401, { error: "Sign in first.", record: false });
    const at = runtime.now().getTime();
    if (!ringMatch[1] && request.method === "GET") {
      const live: Ring[] = [];
      for (const ring of rings.pending(session.id, at)) {
        // Nobody is in that call any more (the caller hung up or dropped).
        if (runtime.store.size(ring.key, at) === 0) {
          rings.cancel(ring.key, at);
          continue;
        }
        // Removed from the room, banned, or blocked since: the ring goes, quietly.
        const still =
          ring.kind === "dm"
            ? await (runtime.dmMember ?? dmCallMember)(db, session.id, ring.roomId, runtime.now())
            : await (runtime.roomMember ?? roomCallMember)(
                db,
                session.id,
                ring.roomId,
                runtime.now(),
              );
        if (still.kind === "member") live.push(ring);
        else if (still.kind !== "unavailable") rings.drop(ring.id, at);
      }
      return json(200, {
        rings: live.map(ringRow),
        settled: rings.settled(session.id, at),
        record: false,
      });
    }
    if (ringMatch[1] && request.method === "POST") {
      if (ringMatch[2] === "decline") rings.decline(session.id, ringMatch[1], at);
      else rings.dismiss(session.id, ringMatch[1], at);
      return json(200, { ok: true, record: false });
    }
    return json(404, { error: "Not found.", record: false });
  }

  const roomMatch = roomPath.exec(pathname);
  const dmMatch = roomMatch ? null : dmPath.exec(pathname);
  const match = roomMatch ?? dmMatch;
  if (!match) return json(404, { error: "Not found.", record: false });
  const targetId = match[1] ?? "";
  const action = match[2] ?? "";
  // DM calls live in the same in-memory store under a key no room id can take.
  const roomId = dmMatch ? `dm:${targetId}` : targetId;
  const cap = dmMatch ? DM_CALL_PEERS : undefined;
  if (request.method !== "GET" && request.method !== "POST") {
    return json(405, { error: "Not found.", record: false });
  }
  if (!session) return json(401, { error: "Sign in first.", record: false });

  const counted =
    (action === "/join" && request.method === "POST") ||
    (action === "/leave" && request.method === "POST") ||
    (action === "/ring" && request.method === "POST") ||
    (action === "" && request.method === "GET");
  if (counted) {
    const hit = await consumeLimit(
      db,
      `calls:user:${session.id}`,
      CALLS_LIMIT,
      runtime.now().getTime(),
    );
    if (!hit.allowed) {
      return json(
        429,
        { error: "Too many attempts. Wait and try again.", record: false },
        new Headers({ "retry-after": String(hit.retryAfter) }),
      );
    }
  }

  const member = dmMatch
    ? await (runtime.dmMember ?? dmCallMember)(db, session.id, targetId, runtime.now())
    : await (runtime.roomMember ?? roomCallMember)(db, session.id, targetId, runtime.now());
  if (member.kind === "bad-room" || member.kind === "hidden") {
    return json(404, { error: "Not found.", record: false });
  }
  if (member.kind === "unavailable")
    return json(503, { error: "Calls are not available.", record: false });
  if (member.kind === "banned") {
    runtime.store.evict(session.id);
    rings.evict(session.id);
    (runtime.ice ?? defaultIce).release(session.id);
    return json(403, { error: "banned", ban: member.ban, record: false });
  }
  if (member.kind === "audience") {
    return json(403, { error: member.error, code: member.code, record: false });
  }
  if (member.kind === "outsider") {
    runtime.store.leave(roomId, session.id);
    (runtime.ice ?? defaultIce).release(session.id, `${roomId}#`);
    return json(403, {
      error: dmMatch ? DM_CALL_REFUSED : "You have not stood in that room.",
      record: false,
    });
  }

  const at = runtime.now().getTime();
  const ice = runtime.ice ?? defaultIce;
  try {
    if (action === "/ring" && request.method === "GET" && !dmMatch) {
      if (!(await (runtime.canRing ?? canRing)(db, session.id, targetId))) {
        return json(200, { canRing: false, members: [], record: false });
      }
      const rows = await ringableMembers(db, targetId, session.id);
      return json(200, {
        canRing: true,
        members: rows.map((row) => ({ id: row.id, name: ringName(row.name) })),
        record: false,
      });
    }
    if (action === "/ring" && request.method === "POST" && !dmMatch) {
      const body = await readJson(request);
      const to = typeof body.to === "string" ? body.to : "";
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(to) || to === session.id) {
        return json(400, { error: "Choose a member to call.", record: false });
      }
      if (!(await (runtime.canRing ?? canRing)(db, session.id, targetId))) {
        return json(403, {
          error: "Only the room's host or a steward can call members.",
          record: false,
        });
      }
      // Ringing only works from inside the call; the ring brings them to you.
      if (
        runtime.store.size(roomId, at) === 0 ||
        runtime.store.generationOf(roomId, session.id) === 0
      ) {
        return json(409, { error: "Join the call first, then call members.", record: false });
      }
      const target = await (runtime.roomMember ?? roomCallMember)(db, to, targetId, runtime.now());
      if (
        target.kind !== "member" ||
        (await (runtime.blocked ?? blockedEitherWay)(db, session.id, to))
      ) {
        return json(409, { error: ROOM_RING_REFUSED, record: false });
      }
      const toName = ringName(await (runtime.memberName ?? memberName)(db, to));
      const rung = rings.ring(
        { roomId: targetId, from: session.id, fromName: ringName(session.name), to, toName },
        at,
      );
      if (!rung) {
        return json(
          429,
          { error: RING_CAP_ERROR, record: false },
          new Headers({ "retry-after": "600" }),
        );
      }
      return json(200, { ok: true, record: false });
    }
    if (action === "/join" && request.method === "POST") {
      const asked = await readJson(request);
      const joined = runtime.store.join(
        roomId,
        { id: session.id, name: callDisplayName(session.name) },
        at,
        cap,
      );
      if (!joined.ok) return json(joined.status, { error: joined.error, record: false });
      rings.answer(session.id, roomId, at);
      // A DM call rings the other person when the caller starts it alone.
      // A rejoin after a dropped poll sends no `ring`, so it never rings twice.
      let ringing = false;
      let ringError: string | undefined;
      if (dmMatch && asked.ring === true && joined.peers.length === 0) {
        const other = await (runtime.dmOther ?? dmOther)(db, session.id, targetId);
        if (other && other.id !== session.id) {
          ringing = Boolean(
            rings.ring(
              {
                kind: "dm",
                key: roomId,
                roomId: targetId,
                from: session.id,
                fromName: ringName(session.name),
                to: other.id,
                toName: ringName(other.name),
              },
              at,
            ),
          );
          // Over the ring cap: the call is open, but they were not rung. Say so.
          if (!ringing) ringError = RING_CAP_ERROR;
        }
      }
      return json(200, {
        ringing,
        ...(ringError ? { ringError } : {}),
        selfId: session.id,
        peers: joined.peers,
        iceServers: await ice(
          runtime.config,
          {
            userId: session.id,
            session: `${roomId}#${runtime.store.generationOf(roomId, session.id)}`,
          },
          at,
        ),
        cursor: joined.cursor,
        record: false,
      });
    }
    if (action === "/leave" && request.method === "POST") {
      await readJson(request);
      runtime.store.leave(roomId, session.id);
      ice.release(session.id, `${roomId}#`);
      // Last one out: any ring into this call is stale, so it goes too.
      if (runtime.store.size(roomId, at) === 0) rings.cancel(roomId, at);
      return json(200, { ok: true, record: false });
    }
    if (action === "/signal" && request.method === "POST") {
      const body = await readJson(request);
      const sent = runtime.store.signal(roomId, session.id, body, at);
      if (!sent.ok) {
        const headers = sent.retryAfter
          ? new Headers({ "retry-after": String(sent.retryAfter) })
          : undefined;
        return json(sent.status, { error: sent.error, record: false }, headers);
      }
      return json(200, { ok: true, record: false });
    }
    if (action === "" && request.method === "GET") {
      const since = Number(url.searchParams.get("since") ?? "0");
      const polled = runtime.store.poll(roomId, session.id, since, at);
      if (!polled.ok) return json(polled.status, { error: polled.error, record: false });
      return json(200, {
        peers: polled.peers,
        signals: polled.signals.map((signal) => ({
          id: signal.id,
          from: signal.from,
          kind: signal.kind,
          payload: signal.payload,
        })),
        iceServers: await ice(
          runtime.config,
          {
            userId: session.id,
            session: `${roomId}#${runtime.store.generationOf(roomId, session.id)}`,
          },
          at,
        ),
        cursor: polled.cursor,
        rings: rings.outcomes(session.id, roomId, at),
        // Whether any ring this person sent into this call is still unanswered.
        ringsOut: rings.ringing(session.id, roomId, at),
        record: false,
      });
    }
    return json(404, { error: "Not found.", record: false });
  } catch (error) {
    const status =
      typeof error === "object" && error && "status" in error ? Number(error.status) : 400;
    const message = error instanceof Error ? error.message : "Send JSON.";
    return json(Number.isInteger(status) ? status : 400, { error: message, record: false });
  }
}
