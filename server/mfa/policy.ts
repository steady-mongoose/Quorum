import type { Db } from "../db.ts";
import { actorRole, type BoardActor } from "../board/access.ts";

/**
 * Live factor is TOTP. Passkeys are named so a later migration can store a
 * credential without a new enrollment protocol. The server refuses them today.
 */
export const LIVE_FACTOR_KINDS = ["totp"] as const;
export const RESERVED_FACTOR_KINDS = ["passkey"] as const;

export const STEP_UP_ACTIONS = ["role-grant", "mfa-reset", "claim-approval", "data-export"] as const;
export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

export const MFA_FAIL_LIMIT = 5;
export const MFA_LOCK_MS = 15 * 60 * 1000;
export const STEP_UP_MS = 5 * 60 * 1000;
export const MFA_RATE = { windowMs: 60_000, max: 10 };
/**
 * One address shared by many people (a NAT, or a missing proxy header that
 * falls back to "local") gets a wider bucket. One person's wrong codes use up
 * their own account's bucket, not everyone's second step on that address.
 */
/** A reset that has not reached two approvals in 7 days is cancelled. */
export const MFA_RESET_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const MFA_IP_RATE = { windowMs: 60_000, max: 60 };

const CLAIM_DECIDE =
  /^\/api\/claims\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/decide$/i;

export function isStepUpAction(value: string): value is StepUpAction {
  return (STEP_UP_ACTIONS as readonly string[]).includes(value);
}

/** Sensitive actions. A fresh authenticator code is required. */
export function stepUpAction(pathname: string, method: string): StepUpAction | null {
  if (method === "POST" && pathname === "/api/access") return "role-grant";
  if (method === "POST" && CLAIM_DECIDE.test(pathname)) return "claim-approval";
  if (
    method === "GET" &&
    (pathname === "/api/admin/export" || pathname === "/api/admin/stats.csv")
  ) {
    return "data-export";
  }
  return null;
}

const ID = "[A-Za-z0-9_-]{1,80}";
const ROOM = "[a-z0-9-]{1,32}";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * The routes a plain member uses. Anything not listed here, including any
 * route added later, any GET of a moderation queue and any PUT or PATCH, is
 * privileged: an owner, admin or steward needs an authenticator for it.
 * Members are never required to enroll, so this list does not limit them.
 */
const MEMBER_ROUTES: Array<[string, RegExp]> = [
  ["GET", /^\/api\/(board|home|place|gatherings|groups|claims|invite-log)$/],
  ["GET", new RegExp(`^/api/groups/${ROOM}$`)],
  ["GET", new RegExp(`^/api/groups/${ROOM}/log$`)],
  ["GET", new RegExp(`^/api/rooms/${ROOM}/chat$`)],
  ["GET", /^\/api\/categories(\/[a-z0-9-]{1,40})?$/],
  ["GET", new RegExp(`^/api/gatherings/${UUID}$`, "i")],
  ["GET", /^\/api\/calls(\/.*)?$/],
  ["GET", /^\/api\/media\/.+$/],
  ["GET", /^\/api\/dm(\/.*)?$/],
  ["GET", /^\/api\/profiles?(\/.*)?$/],
  ["POST", /^\/api\/(place|gender|invites|gatherings|room-requests|claims)$/],
  ["POST", new RegExp(`^/api/rooms/${ROOM}/(posts|join|leave|chat)$`)],
  ["POST", new RegExp(`^/api/posts/${ID}/(replies|revise|close|appeal)$`)],
  ["POST", new RegExp(`^/api/group-posts/${ID}/appeal$`)],
  ["POST", new RegExp(`^/api/groups/${ROOM}/(join|leave|posts)$`)],
  ["POST", new RegExp(`^/api/claims/${UUID}/confirm$`, "i")],
  ["POST", /^\/api\/calls(\/.*)?$/],
  ["POST", /^\/api\/media\/uploads$/],
  ["POST", /^\/api\/dm(\/.*)?$/],
  ["DELETE", /^\/api\/dm(\/.*)?$/],
];

export function memberRoute(pathname: string, method: string): boolean {
  return MEMBER_ROUTES.some(([verb, pattern]) => verb === method && pattern.test(pathname));
}

/**
 * Deny by default. Every route that is not a plain member route stays closed
 * to an owner, admin or steward until an authenticator is on. Role grants,
 * claim approval and export are step-up on top of this.
 */
export function privilegedPath(pathname: string, method: string): boolean {
  if (method === "OPTIONS") return false;
  if (mfaExempt(pathname, method)) return false;
  return !memberRoute(pathname, method);
}

/** Password is enough for these. Everything else waits on the second step. */
export function mfaExempt(pathname: string, method: string): boolean {
  if (pathname === "/api/health") return true;
  if (method === "POST" && pathname.startsWith("/api/auth/sign-in")) return true;
  if (method === "POST" && pathname.startsWith("/api/auth/sign-up")) return true;
  if (method === "POST" && pathname === "/api/auth/sign-out") return true;
  if (method === "GET" && pathname === "/api/auth/get-session") return true;
  if (method === "POST" && pathname === "/api/signup") return true;
  if (method === "GET" && pathname === "/api/mfa/status") return true;
  if (method === "POST" && pathname === "/api/mfa/challenge") return true;
  if (method === "POST" && (pathname === "/api/mfa/enroll/start" || pathname === "/api/mfa/enroll/confirm"))
    return true;
  if (method === "POST" && pathname === "/api/mfa/reset/request") return true;
  if (pathname.startsWith("/api/mfa")) return true;
  return false;
}

/** Owner, admin, or a live room-steward grant. */
export function roleRequiresMfa(actor: BoardActor): boolean {
  return actor.owner || actor.admin || actor.stewardRooms.length > 0;
}

/**
 * Rollout order: the owner enrolls first. Until the owner has an active
 * authenticator, admins and stewards are not yet required to enroll, so no one
 * is locked out of a privileged page before the owner can approve resets.
 * Once the owner is enrolled, every admin and steward is required.
 */
export function rolloutRequiresMfa(actor: BoardActor, ownerEnrolled: boolean): boolean {
  if (actor.owner) return true;
  return ownerEnrolled && roleRequiresMfa(actor);
}

export async function ownerHasMfa(db: Db): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `select f.id from mfa_factor f
       join bootstrap_seat b on b.id = 'founding' and b.user_id = f.user_id
      where f.status = 'active'
      limit 1`,
  );
  return rows.length > 0;
}

export async function actorRequiresMfa(db: Db, userId: string): Promise<boolean> {
  const actor = await actorRole(db, userId);
  if (actor.owner) return true;
  if (!roleRequiresMfa(actor)) return false;
  return rolloutRequiresMfa(actor, await ownerHasMfa(db));
}

export type MfaPhase = "ok" | "challenge" | "enroll";

export function phaseFor(input: {
  required: boolean;
  enrolled: boolean;
  verified: boolean;
}): MfaPhase {
  if (input.enrolled && !input.verified) return "challenge";
  if (input.required && !input.enrolled) return "enroll";
  return "ok";
}
