import type { Db } from "../db.ts";
import { CALLS_LIMIT, consumeLimit } from "../rate-limit.ts";
import { iceServersForMember, publicCallsStatus, type CallsConfig } from "./config.ts";
import { roomCallMember } from "./membership.ts";
import { callDisplayName, type CallStore } from "./store.ts";

export type CallsRuntime = {
  config: CallsConfig;
  store: CallStore;
  now: () => Date;
};

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

const roomPath = /^\/api\/calls\/rooms\/([a-z0-9-]{1,32})(\/(?:join|leave|signal))?$/;

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

  const match = roomPath.exec(pathname);
  if (!match) return json(404, { error: "Not found.", record: false });
  const roomId = match[1] ?? "";
  const action = match[2] ?? "";
  if (request.method !== "GET" && request.method !== "POST") {
    return json(405, { error: "Not found.", record: false });
  }
  if (!session) return json(401, { error: "Sign in first.", record: false });

  const counted =
    (action === "/join" && request.method === "POST") ||
    (action === "/leave" && request.method === "POST") ||
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

  const member = await roomCallMember(db, session.id, roomId, runtime.now());
  if (member.kind === "bad-room") return json(404, { error: "Not found.", record: false });
  if (member.kind === "unavailable")
    return json(503, { error: "Calls are not available.", record: false });
  if (member.kind === "banned") {
    runtime.store.evict(session.id);
    return json(403, { error: "banned", ban: member.ban, record: false });
  }
  if (member.kind === "audience") {
    return json(403, { error: member.error, code: member.code, record: false });
  }
  if (member.kind === "outsider") {
    runtime.store.leave(roomId, session.id);
    return json(403, { error: "You have not stood in that room.", record: false });
  }

  const at = runtime.now().getTime();
  try {
    if (action === "/join" && request.method === "POST") {
      await readJson(request);
      const joined = runtime.store.join(
        roomId,
        { id: session.id, name: callDisplayName(session.name) },
        at,
      );
      if (!joined.ok) return json(joined.status, { error: joined.error, record: false });
      return json(200, {
        selfId: session.id,
        peers: joined.peers,
        iceServers: iceServersForMember(runtime.config, session.id, at),
        cursor: joined.cursor,
        record: false,
      });
    }
    if (action === "/leave" && request.method === "POST") {
      await readJson(request);
      runtime.store.leave(roomId, session.id);
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
        iceServers: iceServersForMember(runtime.config, session.id, at),
        cursor: polled.cursor,
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
