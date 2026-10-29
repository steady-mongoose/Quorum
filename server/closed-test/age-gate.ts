import type { Db } from "../db.ts";
import { AGE_SIGNUP_ERROR, confirmedAdult } from "../../src/lib/board/age.ts";

/** The status body a member without an 18+ confirmation gets. The client routes it to the age step. */
export const AGE_REQUIRED = "age_required";
export const AGE_REQUIRED_MESSAGE = "Confirm you are 18 or older to continue.";
export const AGE_CONFIRM_PATH = "/api/age/confirm";

type SessionRef = { id: string };

/**
 * Routes a signed-in member may use before confirming, by exact method and
 * path: the health probe, reading the session, signing in or out, redeeming
 * an invite, the sign-in steps of the second factor (it comes first), the
 * confirmation itself, and the two public feature probes (no member data).
 * Everything else waits, including every other /api/mfa route: the reset
 * queue lists other members, and approve, request, disable and step-up act
 * on accounts.
 */
export const AGE_EXEMPT_ROUTES: ReadonlyArray<readonly [method: string, path: string]> = [
  ["GET", "/api/health"],
  ["GET", "/api/auth/get-session"],
  ["POST", "/api/auth/sign-in/email"],
  ["POST", "/api/auth/sign-out"],
  ["POST", "/api/signup"],
  ["GET", "/api/mfa/status"],
  ["POST", "/api/mfa/challenge"],
  ["POST", "/api/mfa/enroll/start"],
  ["POST", "/api/mfa/enroll/confirm"],
  ["POST", AGE_CONFIRM_PATH],
  ["GET", "/api/calls/status"],
  ["GET", "/api/media/status"],
];

export function ageExempt(pathname: string, method: string): boolean {
  return AGE_EXEMPT_ROUTES.some(([verb, path]) => verb === method && path === pathname);
}

/** True when the member has confirmed. A missing account reads as confirmed: the route answers its own 401. */
export async function ageConfirmed(db: Db, userId: string): Promise<boolean> {
  const rows = await db.query<{ age_confirmed_at: Date | string | null }>(
    `select age_confirmed_at from "user" where id = $1`,
    [userId],
  );
  if (!rows[0]) return true;
  return rows[0].age_confirmed_at !== null;
}

/** Stores the member's own confirmation once. Only a boolean true counts. */
export async function confirmAge(
  db: Db,
  session: SessionRef,
  adult: unknown,
  now: Date,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!confirmedAdult(adult)) return { ok: false, status: 400, error: AGE_SIGNUP_ERROR };
  // coalesce keeps the first time if the step is sent twice.
  await db.query(
    `update "user" set age_confirmed_at = coalesce(age_confirmed_at, $2) where id = $1`,
    [session.id, now],
  );
  return { ok: true };
}

/** Null means the route may continue. */
export async function enforceAge(
  db: Db,
  request: Request,
  url: URL,
  readSession: (headers: Headers) => Promise<SessionRef | null>,
): Promise<Response | null> {
  if (request.method === "OPTIONS" || !url.pathname.startsWith("/api/")) return null;
  if (ageExempt(url.pathname, request.method)) return null;
  const session = await readSession(request.headers);
  if (!session) return null;
  if (await ageConfirmed(db, session.id)) return null;
  return new Response(JSON.stringify({ error: AGE_REQUIRED, message: AGE_REQUIRED_MESSAGE }), {
    status: 403,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
