import type { Db } from "./db.ts";
import { handleInviteTracker } from "./admin/invite-tracker-routes.ts";
import { CLIENT_IP_HEADER, rateLimitIp } from "./proxy.ts";
import { handleCalls, type CallsRuntime } from "./calls/routes.ts";
import { readCallsConfig } from "./calls/config.ts";
import { createCallStore } from "./calls/store.ts";
import { registerRoomPost } from "./media/access.ts";
import { handleGroups } from "./board/group-routes.ts";
import { handleBoard, limitBoardWrite } from "./board/routes.ts";
import { handlePublicGathering } from "./board/public-gathering.ts";
import { handleRoomChat } from "./chat/routes.ts";
import { createPost, openBan } from "./board/store.ts";
import { handleDm } from "./dm/routes.ts";
import { handleMedia, type MediaRuntime } from "./media/routes.ts";
import { readMediaConfig } from "./media/config.ts";
import { ATTEMPT_LIMIT, consumeLimit, emailRateKey } from "./rate-limit.ts";
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
  /** Omitted in tests that do not exercise room calls. Calls stay off. */
  calls?: CallsRuntime;
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

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Allow a state-changing request when:
 * - it is not POST, PUT, PATCH, or DELETE
 * - Origin is on the allow-list
 * - Origin is absent and Referer is absent (non-browser callers, and a
 *   same-origin browser that sent neither header)
 * - Origin is absent and the Referer's origin is on the allow-list
 *
 * Reject when Origin is present and not listed, or when Origin is absent and
 * the Referer names some other origin.
 */
function stateChangeAllowed(request: Request, origins: string[]): boolean {
  if (!STATE_CHANGING.has(request.method)) return true;
  const origin = request.headers.get("origin");
  if (origin) return origins.includes(origin);
  const referer = request.headers.get("referer");
  if (!referer) return true;
  try {
    return origins.includes(new URL(referer).origin);
  } catch {
    return false;
  }
}

function varyOrigin(headers: Headers) {
  const current = headers.get("vary");
  if (!current) {
    headers.set("vary", "Origin");
    return;
  }
  const parts = current.split(",").map((part) => part.trim().toLowerCase());
  if (!parts.includes("origin")) headers.set("vary", `${current}, Origin`);
}

/** Response headers are immutable, so Vary is added on a copy. */
function responseWithVary(response: Response): Response {
  const current = response.headers.get("vary") ?? "";
  const parts = current.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (parts.includes("origin")) return response;
  const headers = new Headers(response.headers);
  varyOrigin(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withCors(request: Request, response: Response, origins: string[]): Response {
  const origin = request.headers.get("origin");
  if (!origin || !origins.includes(origin)) {
    if (request.method === "OPTIONS" || response.status === 403) return responseWithVary(response);
    return response;
  }
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    headers.set(key, value);
  });
  for (const cookie of response.headers.getSetCookie?.() ?? [])
    headers.append("set-cookie", cookie);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  varyOrigin(headers);
  return new Response(response.body, { status: response.status, headers });
}

async function readBody(request: Request): Promise<string> {
  const claimed = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(claimed) && claimed > 65_536)
    throw new HttpError(413, "That request is too large.");
  const text = await request.text();
  if (text.length > 65_536) throw new HttpError(413, "That request is too large.");
  return text;
}

function parseObject(text: string): Record<string, unknown> {
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

async function readJson(request: Request): Promise<Record<string, unknown>> {
  return parseObject(await readBody(request));
}

function replay(request: Request, body: string): Request {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, { method: request.method, headers, body });
}

/**
 * IP first. A blocked address does not consume the email bucket.
 * An empty email counts only the address. A present email that is too long
 * or not an address is rejected and does not become a key.
 */
async function limitIpAndEmail(
  db: Db,
  scope: string,
  ip: string,
  email: string,
): Promise<Response | null> {
  const ipHit = await consumeLimit(db, `${scope}:ip:${rateLimitIp(ip)}`, ATTEMPT_LIMIT, Date.now());
  if (!ipHit.allowed) return tooMany(ipHit.retryAfter);
  if (!email.trim()) return null;
  const emailId = emailRateKey(email);
  if (!emailId) throw new HttpError(400, "Enter an email address.");
  const emailHit = await consumeLimit(db, `${scope}:email:${emailId}`, ATTEMPT_LIMIT, Date.now());
  if (!emailHit.allowed) return tooMany(emailHit.retryAfter);
  return null;
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function clientIp(request: Request): string {
  const value = request.headers.get(CLIENT_IP_HEADER)?.trim();
  return rateLimitIp(value || "local");
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
  const calls: CallsRuntime = deps.calls ?? {
    config: readCallsConfig({}),
    store: createCallStore(),
    now: deps.now,
  };
  return async (request) => {
    const url = new URL(request.url);
    try {
      const response = await route(deps, media, calls, request, url);
      return withCors(request, response, deps.origins);
    } catch (error) {
      if (error instanceof HttpError)
        return withCors(request, json(error.status, { error: error.message }), deps.origins);
      const status =
        error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
      if (status === 503) {
        const message =
          error instanceof Error ? error.message : "The server could not finish that.";
        return withCors(request, json(503, { error: message }), deps.origins);
      }
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
  calls: CallsRuntime,
  request: Request,
  url: URL,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin");
    if (!origin || !deps.origins.includes(origin)) {
      return new Response(null, { status: 403, headers: { vary: "Origin" } });
    }
    const headers = new Headers({
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-max-age": "600",
    });
    return new Response(null, { status: 204, headers });
  }

  // State-changing requests (POST, PUT, PATCH, DELETE) are checked when the
  // browser names an origin. A caller with neither Origin nor Referer is
  // allowed: curl, uptime checks, and other non-browser clients send neither,
  // and a same-origin browser that omits both is treated the same way.
  // GET /api/health is not state-changing, so it stays open with no Origin.
  // An Origin that is not on the allow-list is rejected. When Origin is
  // missing, the Referer URL's origin is checked the same way. A Referer that
  // is not a URL is rejected. The literal Origin "null" is not on the list.
  if (!stateChangeAllowed(request, deps.origins)) {
    return json(403, { error: "That origin is not allowed." }, new Headers({ vary: "Origin" }));
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
    const text = await readBody(request);
    let email = "";
    let parseError: HttpError | null = null;
    try {
      email = stringField(parseObject(text), "email");
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      parseError = error;
    }
    const blocked = await limitIpAndEmail(
      deps.db,
      "sign-in",
      clientIp(request),
      parseError ? "" : email,
    );
    if (blocked) return blocked;
    if (parseError) throw parseError;
    return deps.forwardAuth(replay(request, text));
  }

  if (url.pathname.startsWith("/api/auth/")) {
    return deps.forwardAuth(request);
  }

  if (url.pathname === "/api/signup" && request.method === "POST") {
    const text = await readBody(request);
    let body: Record<string, unknown> | null = null;
    let parseError: HttpError | null = null;
    try {
      body = parseObject(text);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      parseError = error;
    }
    const blocked = await limitIpAndEmail(
      deps.db,
      "signup",
      clientIp(request),
      body ? stringField(body, "email") : "",
    );
    if (blocked) return blocked;
    if (parseError || !body) throw parseError ?? new HttpError(400, "Send JSON.");
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
    if (!result.ok) {
      return json(
        result.status,
        result.code ? { error: result.error, code: result.code } : { error: result.error },
      );
    }
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
    const ipHit = await consumeLimit(
      deps.db,
      `invite:ip:${clientIp(request)}`,
      ATTEMPT_LIMIT,
      Date.now(),
    );
    if (!ipHit.allowed) return tooMany(ipHit.retryAfter);
    const session = await deps.readSession(request.headers);
    if (!session) return json(401, { error: "Sign in first." });
    const emailId = emailRateKey(session.email);
    if (emailId) {
      const emailHit = await consumeLimit(
        deps.db,
        `invite:email:${emailId}`,
        ATTEMPT_LIMIT,
        Date.now(),
      );
      if (!emailHit.allowed) return tooMany(emailHit.retryAfter);
    }
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
    if (!minted.ok) {
      return json(
        minted.status,
        minted.code ? { error: minted.error, code: minted.code } : { error: minted.error },
      );
    }
    return json(201, minted.value);
  }

  if (url.pathname === "/api/invite-log" && request.method === "GET") {
    const session = await deps.readSession(request.headers);
    if (!session) return json(401, { error: "Sign in first." });
    const ban = await openBan(deps.db, session.id, deps.now());
    if (ban) return json(403, { error: "banned", ban });
    return json(200, { entries: await listInviteLog(deps.db, session.id) });
  }

  if (url.pathname.startsWith("/api/dm")) {
    const response = await handleDm(deps, request, url);
    if (response) return response;
  }

  const roomPost = /^\/api\/rooms\/([a-z0-9-]{1,32})\/posts$/.exec(url.pathname);
  if (roomPost && request.method === "POST") {
    const session = await deps.readSession(request.headers);
    if (!session) return json(401, { error: "Sign in first." });
    const body = await readJson(request);
    if (typeof body.type === "string" && body.type.trim()) {
      const limited = await limitBoardWrite(deps.db, request, session.id);
      if (limited) return limited;
      const filed = await createPost(deps.db, {
        userId: session.id,
        name: session.name,
        roomId: roomPost[1] ?? "",
        body,
        now: deps.now(),
      });
      if (!filed.ok) {
        return json(
          filed.status,
          filed.stops ? { error: filed.error, stops: filed.stops } : { error: filed.error },
        );
      }
      return json(201, { post: filed.value });
    }
    const recorded = await registerRoomPost(
      deps.db,
      session.id,
      roomPost[1] ?? "",
      stringField(body, "id"),
      deps.now(),
    );
    if (!recorded.ok) {
      return json(
        recorded.status,
        recorded.ban ? { error: recorded.error, ban: recorded.ban } : { error: recorded.error },
      );
    }
    return json(201, { id: stringField(body, "id"), roomId: roomPost[1] });
  }

  const chat = await handleRoomChat(deps, request, url);
  if (chat) return chat;

  const inviteTracker = await handleInviteTracker(deps, request, url);
  if (inviteTracker) return inviteTracker;

  const board = await handleBoard({ ...deps, store: media.store }, request, url);
  if (board) return board;

  const groups = await handleGroups(deps, request, url);
  if (groups) return groups;

  if (url.pathname.startsWith("/api/calls")) {
    const openStatus = url.pathname === "/api/calls/status" && request.method === "GET";
    const session =
      openStatus || !calls.config.enabled ? null : await deps.readSession(request.headers);
    return handleCalls(calls, deps.db, request, url, session);
  }

  if (url.pathname.startsWith("/api/media/")) {
    const session =
      url.pathname === "/api/media/status" ? null : await deps.readSession(request.headers);
    if (request.method === "GET" && session) {
      const ban = await openBan(deps.db, session.id, deps.now());
      if (ban) return json(403, { error: "banned", ban });
    }
    return (
      (await handleMedia(media, deps.db, request, url, session, clientIp(request))) ??
      json(404, { error: "Not found." })
    );
  }

  const gathering = await handlePublicGathering(deps, request, url);
  if (gathering) return gathering;

  if (url.pathname.startsWith("/api/")) return json(404, { error: "Not found." });
  return json(404, { error: "Not found." });
}
