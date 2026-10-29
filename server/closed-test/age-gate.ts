import type { Db } from "../db.ts";
import { AGE_SIGNUP_ERROR, confirmedAdult } from "../../src/lib/board/age.ts";

/** The status body a member without an 18+ confirmation gets. The client routes it to the age step. */
export const AGE_REQUIRED = "age_required";
export const AGE_REQUIRED_MESSAGE = "Confirm you are 18 or older to continue.";
export const AGE_CONFIRM_PATH = "/api/age/confirm";

type SessionRef = { id: string };

/**
 * Routes a signed-in member may use before confirming: reading the session,
 * signing in or out, the second factor (it comes first), and the confirmation
 * itself. Everything else waits.
 */
export function ageExempt(pathname: string, method: string): boolean {
  if (pathname === "/api/health") return true;
  if (method === "GET" && pathname === "/api/auth/get-session") return true;
  if (method === "POST" && pathname === "/api/auth/sign-out") return true;
  if (method === "POST" && pathname.startsWith("/api/auth/sign-in")) return true;
  if (method === "POST" && pathname === "/api/signup") return true;
  if (pathname.startsWith("/api/mfa")) return true;
  if (method === "POST" && pathname === AGE_CONFIRM_PATH) return true;
  if (method === "GET" && (pathname === "/api/calls/status" || pathname === "/api/media/status")) return true;
  return false;
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
