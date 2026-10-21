import { BOARD_READ_LIMIT, BOARD_WRITE_LIMIT, consumeLimit } from "../rate-limit.ts";
import { CLIENT_IP_HEADER, rateLimitIp } from "../proxy.ts";
import type { Db } from "../db.ts";
import { CHAT_UNAVAILABLE, roomChatReady } from "./ready.ts";
import { listChat, removeChatMessage, sendChat, type ChatResult } from "./store.ts";

type SessionUser = { id: string; name: string; email: string };

export type ChatDeps = {
  db: Db;
  readSession: (headers: Headers) => Promise<SessionUser | null>;
  now: () => Date;
};

const CHAT_PATH = /^\/api\/rooms\/([a-z0-9-]{1,32})\/chat$/;
const REMOVE_PATH = /^\/api\/rooms\/([a-z0-9-]{1,32})\/chat\/([A-Za-z0-9_-]{1,80})\/remove$/;

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
  const ipHit = await consumeLimit(db, `chat-${kind}:ip:${clientIp(request)}`, rule, Date.now());
  if (!ipHit.allowed) return tooMany(ipHit.retryAfter);
  const userHit = await consumeLimit(db, `chat-${kind}:user:${userId}`, rule, Date.now());
  if (!userHit.allowed) return tooMany(userHit.retryAfter);
  return null;
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
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Send a JSON object.");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Send JSON.");
  }
}

function fromResult(status: number, result: ChatResult<unknown>): Response {
  if (!result.ok) {
    return json(result.status, {
      error: result.error,
      ...(result.ban ? { ban: result.ban } : {}),
    });
  }
  return json(status, result.value);
}

function cursor(value: string | null): number | null {
  if (value == null || value === "") return null;
  if (!/^\d{1,16}$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

export async function handleRoomChat(
  deps: ChatDeps,
  request: Request,
  url: URL,
): Promise<Response | null> {
  const remove = REMOVE_PATH.exec(url.pathname);
  const chat = CHAT_PATH.exec(url.pathname);
  if (!remove && !chat) return null;
  const methodOk = remove
    ? request.method === "POST"
    : request.method === "GET" || request.method === "POST";
  if (!methodOk) return null;

  try {
    const session = await deps.readSession(request.headers);
    if (!session) return json(401, { error: "Sign in first." });
    if (!(await roomChatReady(deps.db))) return json(503, { error: CHAT_UNAVAILABLE });
    const kind = request.method === "GET" ? "read" : "write";
    const blocked = await limit(deps.db, request, session.id, kind);
    if (blocked) return blocked;
    const now = deps.now();

    if (remove && request.method === "POST") {
      const body = await readJson(request);
      const reason = typeof body.reason === "string" ? body.reason : "";
      return fromResult(
        200,
        await removeChatMessage(deps.db, {
          userId: session.id,
          name: session.name,
          roomId: remove[1] ?? "",
          messageId: remove[2] ?? "",
          reason,
          now,
        }),
      );
    }

    if (!chat) return json(404, { error: "Not found." });
    const roomId = chat[1] ?? "";
    if (request.method === "GET") {
      const after = cursor(url.searchParams.get("after"));
      const before = cursor(url.searchParams.get("before"));
      if (Number.isNaN(after) || Number.isNaN(before))
        return json(400, { error: "That page is not valid." });
      return fromResult(
        200,
        await listChat(deps.db, {
          userId: session.id,
          roomId,
          now,
          after,
          before,
        }),
      );
    }

    const body = await readJson(request);
    const text = typeof body.text === "string" ? body.text : "";
    const sent = await sendChat(deps.db, {
      userId: session.id,
      name: session.name,
      roomId,
      text,
      now,
    });
    if (!sent.ok) return fromResult(400, sent);
    return json(201, { message: sent.value });
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message });
    throw error;
  }
}
