import type { Db } from "../db.ts";
import { BOARD_WRITE_LIMIT, consumeLimit } from "../rate-limit.ts";
import { CLIENT_IP_HEADER, rateLimitIp } from "../proxy.ts";
import {
  declineTakedown,
  listTakedowns,
  removeForTakedown,
  submitTakedown,
  type TakedownResult,
} from "./store.ts";

type SessionUser = { id: string; name: string; email: string };

export type TakedownDeps = {
  db: Db;
  readSession: (headers: Headers) => Promise<SessionUser | null>;
  now: () => Date;
};

function json(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      ...extra,
    },
  });
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const text = await request.text();
    if (text.length > 16_384) return json(413, { error: "That request is too large." });
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json(400, { error: "Send a JSON object." });
    }
    return parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "Send JSON." });
  }
}

const str = (body: Record<string, unknown>, key: string) =>
  typeof body[key] === "string" ? (body[key] as string) : "";

function result<T>(status: number, value: TakedownResult<T>, key: string): Response {
  return value.ok ? json(status, { [key]: value.value }) : json(value.status, { error: value.error });
}

const ACTION = /^\/api\/takedown\/(TD-[2-9A-HJKMNP-Z]{10})\/(remove|decline)$/;

/**
 * POST /api/takedown needs no account. The queue and its actions are admin-only.
 * Returns null for any other path.
 */
export async function handleTakedown(
  deps: TakedownDeps,
  request: Request,
  url: URL,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/takedown")) return null;
  if (url.pathname === "/api/takedown" && request.method === "POST") {
    const ip = rateLimitIp(request.headers.get(CLIENT_IP_HEADER)?.trim() || "local");
    const hit = await consumeLimit(deps.db, `takedown:ip:${ip}`, BOARD_WRITE_LIMIT, Date.now());
    if (!hit.allowed) {
      return json(429, { error: "Too many requests. Wait and try again." }, {
        "retry-after": String(hit.retryAfter),
      });
    }
    const body = await readBody(request);
    if (body instanceof Response) return body;
    const saved = await submitTakedown(
      deps.db,
      {
        name: str(body, "name"),
        email: str(body, "email"),
        phone: str(body, "phone"),
        contentUrl: str(body, "contentUrl"),
        description: str(body, "description"),
        goodFaith: body.goodFaith === true,
        signature: str(body, "signature"),
      },
      deps.now(),
    );
    return result(201, saved, "request");
  }
  const session = await deps.readSession(request.headers);
  if (!session) return json(401, { error: "Sign in first." });
  if (url.pathname === "/api/takedown" && request.method === "GET") {
    return result(200, await listTakedowns(deps.db, session.id), "requests");
  }
  const action = ACTION.exec(url.pathname);
  if (action && request.method === "POST") {
    const body = await readBody(request);
    if (body instanceof Response) return body;
    if (action[2] === "remove") {
      const media = Array.isArray(body.media)
        ? body.media.filter((item): item is string => typeof item === "string").slice(0, 50)
        : [];
      return result(
        200,
        await removeForTakedown(deps.db, {
          userId: session.id,
          requestId: action[1]!,
          media,
          note: str(body, "note"),
          now: deps.now(),
        }),
        "result",
      );
    }
    return result(
      200,
      await declineTakedown(deps.db, {
        userId: session.id,
        requestId: action[1]!,
        note: str(body, "note"),
        now: deps.now(),
      }),
      "request",
    );
  }
  return json(404, { error: "Not found." });
}
