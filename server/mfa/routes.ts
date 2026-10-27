import type { Db } from "../db.ts";
import { CLIENT_IP_HEADER, rateLimitIp } from "../proxy.ts";
import { isStepUpAction, mfaExempt, privilegedPath, stepUpAction } from "./policy.ts";
import {
  accountExport,
  approveReset,
  confirmEnroll,
  disableMfa,
  guardRequest,
  listResets,
  mfaView,
  noteSignIn,
  requestReset,
  startEnroll,
  submitChallenge,
  submitStepUp,
  type MfaFailure,
  type SessionRef,
} from "./store.ts";

type SessionUser = { id: string; name: string; email: string; sessionId?: string };

type Deps = {
  db: Db;
  now: () => Date;
  readSession: (headers: Headers) => Promise<SessionUser | null>;
};

function json(status: number, body: unknown, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function failureResponse(failure: MfaFailure): Response {
  const headers = new Headers();
  if (failure.retryAfter) headers.set("retry-after", String(failure.retryAfter));
  return json(
    failure.status,
    {
      error: failure.error,
      message: failure.message,
      ...(failure.step ? { step: failure.step } : {}),
      ...(failure.action ? { action: failure.action } : {}),
    },
    headers,
  );
}

function ref(session: SessionUser): SessionRef {
  return { id: session.id, sessionId: session.sessionId, email: session.email };
}

function clientIp(request: Request): string {
  return rateLimitIp(request.headers.get(CLIENT_IP_HEADER)?.trim() || "local");
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  const text = await request.text();
  if (text.length > 65_536) return json(413, { error: "That request is too large." });
  if (!text) return {};
  try {
    const body = JSON.parse(text) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(400, { error: "Send a JSON object." });
    }
    return body as Record<string, unknown>;
  } catch {
    return json(400, { error: "Send JSON." });
  }
}

function field(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

export async function handleMfa(deps: Deps, request: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/mfa")) return null;
  const session = await deps.readSession(request.headers);
  if (!session) return json(401, { error: "Sign in first." });
  const user = ref(session);
  const now = deps.now();
  const ip = clientIp(request);

  if (url.pathname === "/api/mfa/status" && request.method === "GET") {
    const view = await mfaView(deps.db, user);
    return json(200, {
      required: view.required,
      enrolled: view.enrolled,
      pending: view.pending,
      recoveryRemaining: view.recoveryRemaining,
      mfa: view.mfa,
    });
  }

  if (url.pathname === "/api/mfa/enroll/start" && request.method === "POST") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const started = await startEnroll(deps.db, user, field(body, "kind") || "totp");
    if (!started.ok) return failureResponse(started.failure);
    return json(200, { secret: started.secret, otpauth: started.otpauth, modules: started.modules });
  }

  if (url.pathname === "/api/mfa/enroll/confirm" && request.method === "POST") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const confirmed = await confirmEnroll(deps.db, user, field(body, "code"), now, ip);
    if (!confirmed.ok) return failureResponse(confirmed.failure);
    return json(200, { recoveryCodes: confirmed.recoveryCodes });
  }

  if (url.pathname === "/api/mfa/challenge" && request.method === "POST") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const result = await submitChallenge(deps.db, user, field(body, "code"), now, ip);
    if (!result.ok) return failureResponse(result.failure);
    return json(200, { mfa: "ok" });
  }

  if (url.pathname === "/api/mfa/step-up" && request.method === "POST") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const action = field(body, "action");
    if (!isStepUpAction(action)) return json(400, { error: "Name the action." });
    const result = await submitStepUp(deps.db, user, action, field(body, "code"), now, ip);
    if (!result.ok) return failureResponse(result.failure);
    return json(200, { ok: true, action });
  }

  if (url.pathname === "/api/mfa/disable" && request.method === "POST") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const result = await disableMfa(deps.db, user, field(body, "code"), now, ip);
    if (!result.ok) return failureResponse(result.failure);
    return json(200, { ok: true });
  }

  if (url.pathname === "/api/mfa/reset/request" && request.method === "POST") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const subject = field(body, "userId") || user.id;
    const result = await requestReset(deps.db, user, subject);
    if (!result.ok) return failureResponse(result.failure);
    return json(200, { id: result.id });
  }

  if (url.pathname === "/api/mfa/reset" && request.method === "GET") {
    const result = await listResets(deps.db, user);
    if (!result.ok) return failureResponse(result.failure);
    return json(200, { resets: result.resets });
  }

  const approve = /^\/api\/mfa\/reset\/([A-Za-z0-9-]{1,80})\/approve$/.exec(url.pathname);
  if (approve && request.method === "POST") {
    const result = await approveReset(deps.db, user, approve[1] ?? "", now);
    if (!result.ok) return failureResponse(result.failure);
    return json(200, { ok: true, completed: result.completed });
  }

  return json(404, { error: "Not found." });
}

/** Second step, enrollment, and step-up. Null means the route may continue. */
export async function enforceMfa(deps: Deps, request: Request, url: URL): Promise<Response | null> {
  if (request.method === "OPTIONS" || mfaExempt(url.pathname, request.method)) return null;
  const stepUp = stepUpAction(url.pathname, request.method);
  const privileged = privilegedPath(url.pathname, request.method);
  if (!stepUp && !privileged) {
    const session = await deps.readSession(request.headers);
    if (!session) return null;
    const view = await mfaView(deps.db, ref(session));
    if (view.mfa !== "challenge") return null;
    return failureResponse({
      status: 403,
      error: "mfa_required",
      message: "Enter the authenticator code to finish signing in.",
      step: "challenge",
    });
  }
  const session = await deps.readSession(request.headers);
  // No session, no second factor to ask for: the route answers its own 401.
  if (!session) return null;
  const gate = await guardRequest(deps.db, ref(session), { stepUp, privileged }, deps.now());
  if (!gate) return null;
  return failureResponse(gate);
}

/**
 * A member route that shows more to an admin (the network-wide invite log)
 * asks an admin for the authenticator like any privileged route.
 */
export async function guardAdminView(deps: Deps, session: SessionUser): Promise<Response | null> {
  const gate = await guardRequest(deps.db, ref(session), { privileged: true }, deps.now());
  return gate ? failureResponse(gate) : null;
}

export async function exportAccount(deps: Deps, request: Request): Promise<Response> {
  const session = await deps.readSession(request.headers);
  if (!session) return json(401, { error: "Sign in first." });
  const result = await accountExport(deps.db, ref(session), deps.now());
  if (!result.ok) return failureResponse(result.failure);
  return json(200, result.body);
}

export function cookieHeaderFrom(response: Response): string {
  const cookies = response.headers.getSetCookie?.() ?? [];
  return cookies
    .map((cookie) => cookie.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

/** Adds the MFA phase to a successful sign-in body and strips a session token. */
export async function annotateAuthBody(
  deps: Deps,
  response: Response,
  mode: "sign-in" | "session",
  requestHeaders?: Headers,
): Promise<Response> {
  if (response.status < 200 || response.status >= 300) return response;
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    const parsed = text ? (JSON.parse(text) as unknown) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    return new Response(text, { status: response.status, headers: response.headers });
  }
  const lookup = new Headers(mode === "session" ? requestHeaders : undefined);
  if (mode === "sign-in") {
    const cookie = cookieHeaderFrom(response);
    if (cookie) lookup.set("cookie", cookie);
  }
  const session = await deps.readSession(lookup);
  if (!session) return copyResponse(response, text);
  const phase =
    mode === "sign-in" ? await noteSignIn(deps.db, ref(session)) : await mfaView(deps.db, ref(session));
  const mfa = phase.mfa;
  const enrolled = "mfaEnrolled" in phase ? phase.mfaEnrolled : phase.enrolled;
  if (mfa === "challenge") delete body.token;
  body.mfa = mfa;
  body.mfaEnrolled = enrolled;
  return copyResponse(response, JSON.stringify(body));
}

function copyResponse(response: Response, body: string): Response {
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "content-length" || key.toLowerCase() === "set-cookie") return;
    headers.set(key, value);
  });
  for (const cookie of response.headers.getSetCookie?.() ?? []) headers.append("set-cookie", cookie);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(body, { status: response.status, headers });
}
