import { BOARD_READ_LIMIT, BOARD_WRITE_LIMIT, consumeLimit } from "../rate-limit.ts";
import { CLIENT_IP_HEADER, rateLimitIp } from "../proxy.ts";
import type { Db } from "../db.ts";
import {
  banMember,
  closeAsked,
  createRoom,
  listBoard,
  markPost,
  removePost,
  replyToPost,
  revisePost,
  setSteward,
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
    return json(
      result.status,
      result.stops ? { error: result.error, stops: result.stops } : { error: result.error },
    );
  }
  return json(status, result.value);
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

export async function handleBoard(
  deps: BoardDeps,
  request: Request,
  url: URL,
): Promise<Response | null> {
  const postAction =
    /^\/api\/posts\/([A-Za-z0-9_-]{1,80})\/(replies|revise|close|mark|remove)$/.exec(url.pathname);
  const matched =
    (url.pathname === "/api/board" && request.method === "GET") ||
    (url.pathname === "/api/rooms" && request.method === "POST") ||
    (url.pathname === "/api/access" && request.method === "POST") ||
    (url.pathname === "/api/bans" && request.method === "POST") ||
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

    if (url.pathname === "/api/access") {
      const changed = await setSteward(deps.db, {
        userId: session.id,
        name: session.name,
        email: stringField(body, "email"),
        action: stringField(body, "action"),
        note: stringField(body, "note"),
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
