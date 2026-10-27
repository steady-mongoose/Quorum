import type { Db } from "../db.ts";
import { listInviteTracker } from "./invite-tracker.ts";

type SessionUser = { id: string };

/**
 * GET /api/admin/invites. Admin only. Read-only. Not a member route, so the
 * MFA policy in #64 (deny by default for admins without a verified second factor)
 * covers it once that merges.
 */
export async function handleInviteTracker(
  deps: { db: Db; readSession: (headers: Headers) => Promise<SessionUser | null> },
  request: Request,
  url: URL,
): Promise<Response | null> {
  if (url.pathname !== "/api/admin/invites") return null;
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "Read only." }), { status: 405, headers });
  const session = await deps.readSession(request.headers);
  if (!session) return new Response(JSON.stringify({ error: "Sign in first." }), { status: 401, headers });
  const result = await listInviteTracker(deps.db, session.id);
  if (!result.ok) return new Response(JSON.stringify({ error: result.error }), { status: result.status, headers });
  return new Response(JSON.stringify({ invites: result.value }), { status: 200, headers });
}
