import type { Db } from "./db.ts";
import { CLIENT_IP_HEADER } from "./proxy.ts";
import { handleMedia, type MediaRuntime } from "./media/routes.ts";
import { readMediaConfig } from "./media/config.ts";
import { consumeLimit, INVITE_LIMIT, SIGN_IN_LIMIT, SIGNUP_LIMIT } from "./rate-limit.ts";
import { isOpenSignupPath } from "./closed-test/rules.ts";
import {
  listInviteLog,
  mintInvite,
  redeemInvite,
  type CreateAccount,
  type SignIn,
} from "./closed-test/store.ts";

export type SessionUser = { id: string; name: string; email: string };

export type AppDeps = {
  db: Db;
  origins: string[];
  now: () => Date;
  createAccount: CreateAccount;
  signIn: SignIn;
  readSession: (headers: Headers) => Promise<SessionUser | null>;
  forwardAuth: (request: Request) => Promise<Response>;
  /** Omitted in tests that do not exercise pictures. Storage stays off. */
  media?: MediaRuntime;
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(status: number, body: unknown, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function withCors(request: Request, response: Response, origins: string[]): Response {
  const origin = request.headers.get("origin");
  if (!origin || !origins.includes(origin)) return response;
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    headers.set(key, value);
  });
  for (const cookie of response.headers.getSetCookie?.() ?? [])
    headers.append("set-cookie", cookie);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
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

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function clientIp(request: Request): string {
  const value = request.headers.get(CLIENT_IP_HEADER)?.trim();
  return value || "local";
}

function tooMany(retryAfter: number): Response {
  return json(
    429,
    { error: "Too many attempts. Wait and try again." },
    new Headers({ "retry-after": String(retryAfter) }),
  );
}

export function createApp(deps: AppDeps): (request: Request) => Promise<Response> {
  const media: MediaRuntime = deps.media ?? {
    config: readMediaConfig({}),
    store: null,
    now: deps.now,
  };
  return async (request) => {
    const url = new URL(request.url);
    try {
      const response = await route(deps, media, request, url);
      return withCors(request, response, deps.origins);
    } catch (error) {
      if (error instanceof HttpError)
        return withCors(request, json(error.status, { error: error.message }), deps.origins);
      console.error(
        JSON.stringify({
          event: "api-error",
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
      return withCors(
        request,
        json(500, { error: "The server could not finish that." }),
        deps.origins,
      );
    }
  };
}

async function route(
  deps: AppDeps,
  media: MediaRuntime,
  request: Request,
  url: URL,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    const headers = new Headers({
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
    });
    return new Response(null, { status: 204, headers });
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    try {
      await deps.db.query("select 1 as ok");
      return json(200, { ok: true });
    } catch {
      return json(503, { ok: false, error: "db-unavailable" });
    }
  }

  if (isOpenSignupPath(url.pathname)) {
    return json(403, {
      error: "invite-only",
      message: "Accounts are created with an invite code.",
    });
  }

  if (url.pathname.startsWith("/api/auth/sign-in") && request.method === "POST") {
    const limit = await consumeLimit(
      deps.db,
      `sign-in:${clientIp(request)}`,
      SIGN_IN_LIMIT,
      Date.now(),
    );
    if (!limit.allowed) return tooMany(limit.retryAfter);
  }

  if (url.pathname.startsWith("/api/auth/")) {
    return deps.forwardAuth(request);
  }

  if (url.pathname === "/api/signup" && request.method === "POST") {
    const limit = await consumeLimit(
      deps.db,
      `signup:${clientIp(request)}`,
      SIGNUP_LIMIT,
      Date.now(),
    );
    if (!limit.allowed) return tooMany(limit.retryAfter);
    const body = await readJson(request);
    const result = await redeemInvite(
      deps.db,
      {
        name: stringField(body, "name"),
        email: stringField(body, "email"),
        password: stringField(body, "password"),
        code: stringField(body, "inviteCode"),
        headers: request.headers,
      },
      deps.createAccount,
      deps.signIn,
      deps.now(),
    );
    if (!result.ok) return json(result.status, { error: result.error });
    if (result.value.user.response) return result.value.user.response;
    return json(200, {
      user: {
        id: result.value.user.id,
        name: result.value.user.name,
        email: result.value.user.email,
      },
    });
  }

  if (url.pathname === "/api/invites" && request.method === "POST") {
    const limit = await consumeLimit(
      deps.db,
      `invite:${clientIp(request)}`,
      INVITE_LIMIT,
      Date.now(),
    );
    if (!limit.allowed) return tooMany(limit.retryAfter);
    const session = await deps.readSession(request.headers);
    if (!session) return json(401, { error: "Sign in first." });
    const body = await readJson(request);
    const minted = await mintInvite(
      deps.db,
      {
        userId: session.id,
        maxUses: body.maxUses,
        expiresInDays: body.expiresInDays,
        note: body.note,
        roomId: body.roomId,
      },
      deps.now(),
    );
    if (!minted.ok) return json(minted.status, { error: minted.error });
    return json(201, minted.value);
  }

  if (url.pathname === "/api/invite-log" && request.method === "GET") {
    const session = await deps.readSession(request.headers);
    if (!session) return json(401, { error: "Sign in first." });
    return json(200, { entries: await listInviteLog(deps.db, session.id) });
  }

  if (url.pathname.startsWith("/api/media/")) {
    const session =
      url.pathname === "/api/media/status" ? null : await deps.readSession(request.headers);
    return (
      (await handleMedia(media, deps.db, request, url, session, clientIp(request))) ??
      json(404, { error: "Not found." })
    );
  }

  if (url.pathname.startsWith("/api/")) return json(404, { error: "Not found." });
  return json(404, { error: "Not found." });
}
