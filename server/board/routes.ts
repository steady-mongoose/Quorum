import { BOARD_READ_LIMIT, BOARD_WRITE_LIMIT, consumeLimit } from "../rate-limit.ts";
import { CLIENT_IP_HEADER, rateLimitIp } from "../proxy.ts";
import type { Db } from "../db.ts";
import {
  correctZip,
  decideRoom,
  grantAccess,
  joinRoom,
  listHome,
  requestRoom,
  savePlace,
  setCouncil,
} from "./places-store.ts";
import {
  banMember,
  closeAsked,
  createRoom,
  listBoard,
  markPost,
  openBan,
  removePost,
  replyToPost,
  revisePost,
  type Result,
} from "./store.ts";

type SessionUser = { id: string; name: string; email: string };

export type BoardDeps = {
  db: Db;
  readSession: (headers: Headers) => Promise<SessionUser | null>;
  now: () => Date;
};

function json(status: number, body: unknown, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function tooMany(retryAfter: number): Response {
  return json(
    429,
    { error: "Too many attempts. Wait and try again." },
    new Headers({ "retry-after": String(retryAfter) }),
  );
}

function clientIp(request: Request): string {
  const value = request.headers.get(CLIENT_IP_HEADER)?.trim();
  return rateLimitIp(value || "local");
}

async function limit(
  db: Db,
  request: Request,
  userId: string,
  kind: "read" | "write",
): Promise<Response | null> {
  const rule = kind === "read" ? BOARD_READ_LIMIT : BOARD_WRITE_LIMIT;
  const ipHit = await consumeLimit(db, `board-${kind}:ip:${clientIp(request)}`, rule, Date.now());
  if (!ipHit.allowed) return tooMany(ipHit.retryAfter);
  const userHit = await consumeLimit(db, `board-${kind}:user:${userId}`, rule, Date.now());
  if (!userHit.allowed) return tooMany(userHit.retryAfter);
  return null;
}

/** Used by the picture registration route when the body is a real post. */
export async function limitBoardWrite(
  db: Db,
  request: Request,
  userId: string,
): Promise<Response | null> {
  return limit(db, request, userId, "write");
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const claimed = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(claimed) && claimed > 65_536)
    throw new HttpError(413, "That request is too large.");
  const text = await request.text();
  if (text.length > 65_536) throw new HttpError(413, "That request is too large.");
  if (!text) return {};
  try {
    const body = JSON.parse(text) as unknown;
    if (body === null || typeof body !== "object" || Array.isArray(body))
      throw new HttpError(400, "Send a JSON object.");
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Send JSON.");
  }
}

function fromResult(status: number, result: Result<unknown>): Response {
  if (!result.ok) {
    return json(result.status, {
      error: result.error,
      ...(result.stops ? { stops: result.stops } : {}),
      ...(result.ban ? { ban: result.ban } : {}),
    });
  }
  return json(status, result.value);
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function stringList(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export async function handleBoard(
  deps: BoardDeps,
  request: Request,
  url: URL,
): Promise<Response | null> {
  const postAction =
    /^\/api\/posts\/([A-Za-z0-9_-]{1,80})\/(replies|revise|close|mark|remove|council)$/.exec(
      url.pathname,
    );
  const roomJoin = /^\/api\/rooms\/([a-z0-9-]{1,32})\/(join|leave)$/.exec(url.pathname);
  const decide = /^\/api\/room-requests\/([A-Za-z0-9_-]{1,80})\/decide$/.exec(url.pathname);
  const matched =
    (url.pathname === "/api/board" && request.method === "GET") ||
    (url.pathname === "/api/home" && request.method === "GET") ||
    (url.pathname === "/api/rooms" && request.method === "POST") ||
    (url.pathname === "/api/place" && request.method === "POST") ||
    (url.pathname === "/api/room-requests" && request.method === "POST") ||
    (url.pathname === "/api/zips" && request.method === "POST") ||
    (url.pathname === "/api/access" && request.method === "POST") ||
    (url.pathname === "/api/bans" && request.method === "POST") ||
    Boolean(roomJoin && (request.method === "POST" || request.method === "DELETE")) ||
    Boolean(decide && request.method === "POST") ||
    Boolean(postAction && request.method === "POST");
  if (!matched) return null;

  try {
    const session = await deps.readSession(request.headers);
    if (!session) return json(401, { error: "Sign in first." });
    const kind = request.method === "GET" ? "read" : "write";
    const blocked = await limit(deps.db, request, session.id, kind);
    if (blocked) return blocked;
    const now = deps.now();

    if (url.pathname === "/api/board") {
      const room = url.searchParams.get("room") ?? "";
      const cursor = url.searchParams.get("cursor") ?? "";
      const limitRaw = url.searchParams.get("limit");
      const limit = limitRaw === null ? undefined : Number(limitRaw);
      return fromResult(
        200,
        await listBoard(deps.db, session.id, now, {
          ...(room ? { room } : {}),
          ...(cursor ? { cursor } : {}),
          ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
        }),
      );
    }

    if (url.pathname === "/api/home") {
      const ban = await openBan(deps.db, session.id, now);
      if (ban) return json(403, { error: "banned", ban });
      return fromResult(200, await listHome(deps.db, session.id, now));
    }

    if (roomJoin && request.method === "DELETE") {
      return fromResult(
        200,
        await joinRoom(deps.db, {
          userId: session.id,
          roomId: roomJoin[1] ?? "",
          now,
          leave: true,
        }),
      );
    }

    const body = await readJson(request);

    if (url.pathname === "/api/rooms") {
      const created = await createRoom(deps.db, {
        userId: session.id,
        id: stringField(body, "id"),
        name: stringField(body, "name"),
        what: stringField(body, "what"),
        now,
      });
      return fromResult(201, created);
    }

    if (url.pathname === "/api/place") {
      return fromResult(
        200,
        await savePlace(deps.db, {
          userId: session.id,
          zip: stringField(body, "zip"),
          congregationId: stringField(body, "congregationId"),
          now,
        }),
      );
    }

    if (url.pathname === "/api/room-requests") {
      return fromResult(
        201,
        await requestRoom(deps.db, {
          userId: session.id,
          kind: stringField(body, "kind"),
          name: stringField(body, "name"),
          state: stringField(body, "state"),
          now,
        }),
      );
    }

    if (decide) {
      return fromResult(
        200,
        await decideRoom(deps.db, {
          userId: session.id,
          requestId: decide[1] ?? "",
          decision: stringField(body, "decision"),
          note: stringField(body, "note"),
          now,
        }),
      );
    }

    if (url.pathname === "/api/zips") {
      return fromResult(
        201,
        await correctZip(deps.db, {
          userId: session.id,
          zip: stringField(body, "zip"),
          name: stringField(body, "name"),
          state: stringField(body, "state"),
          clear: body.clear === true,
          now,
        }),
      );
    }

    if (roomJoin) {
      return fromResult(
        200,
        await joinRoom(deps.db, {
          userId: session.id,
          roomId: roomJoin[1] ?? "",
          now,
          leave: roomJoin[2] === "leave",
        }),
      );
    }

    if (url.pathname === "/api/access") {
      const changed = await grantAccess(deps.db, {
        userId: session.id,
        action: stringField(body, "action"),
        email: stringField(body, "email"),
        roomId: stringField(body, "roomId"),
        inviterEmail: stringField(body, "inviterEmail"),
        stewardEmail: stringField(body, "stewardEmail"),
        role: stringField(body, "role"),
        now,
      });
      return fromResult(200, changed);
    }

    if (url.pathname === "/api/bans") {
      const banned = await banMember(deps.db, {
        userId: session.id,
        name: session.name,
        email: stringField(body, "email"),
        reason: stringField(body, "reason"),
        now,
      });
      return fromResult(201, banned);
    }

    if (!postAction) return json(404, { error: "Not found." });
    const postId = postAction[1] ?? "";
    const action = postAction[2];
    if (action === "replies") {
      return fromResult(
        201,
        await replyToPost(deps.db, {
          userId: session.id,
          name: session.name,
          postId,
          claim: stringField(body, "claim"),
          now,
        }),
      );
    }
    if (action === "revise") {
      return fromResult(
        200,
        await revisePost(deps.db, {
          userId: session.id,
          name: session.name,
          postId,
          claim: stringField(body, "claim"),
          reason: stringField(body, "reason"),
          now,
        }),
      );
    }
    if (action === "close") {
      return fromResult(
        200,
        await closeAsked(deps.db, { userId: session.id, postId, now }),
      );
    }
    if (action === "council") {
      const result = await setCouncil(deps.db, {
        userId: session.id,
        postId,
        action: stringField(body, "action"),
        reason: stringField(body, "reason"),
        checklist: stringList(body, "checklist"),
        now,
      });
      return fromResult(200, result);
    }
    if (action === "mark") {
      return fromResult(
        200,
        await markPost(deps.db, {
          userId: session.id,
          name: session.name,
          postId,
          mark: body.mark === null ? null : body.mark,
          reason: stringField(body, "reason"),
          now,
        }),
      );
    }
    return fromResult(
      200,
      await removePost(deps.db, {
        userId: session.id,
        name: session.name,
        postId,
        reason: stringField(body, "reason"),
        now,
      }),
    );
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message });
    throw error;
  }
}
