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

/**
 * Steward, admin, and owner actions that stay closed until an authenticator
 * is on. Role grants, claim approval, and export are step-up instead, and
 * that check includes this enrollment rule.
 */
export function privilegedPath(pathname: string, method: string): boolean {
  if (method !== "POST" && method !== "DELETE") return false;
  if (pathname === "/api/bans" || pathname === "/api/rooms" || pathname === "/api/rooms/seed")
    return true;
  if (pathname === "/api/gender/confirm") return true;
  if (/^\/api\/rooms\/[a-z0-9-]{1,32}\/audience$/.test(pathname)) return true;
  if (/^\/api\/appeals\/[A-Za-z0-9_-]{1,80}\/decide$/.test(pathname)) return true;
  if (/^\/api\/csam-holds\/[A-Za-z0-9_-]{1,80}\/filed$/.test(pathname)) return true;
  if (/^\/api\/room-requests\/[A-Za-z0-9_-]{1,80}\/decide$/.test(pathname)) return true;
  if (/^\/api\/posts\/[A-Za-z0-9_-]{1,80}\/(mark|remove|council)$/.test(pathname)) return true;
  if (/^\/api\/group-posts\/[A-Za-z0-9_-]{1,80}\/(mark|remove)$/.test(pathname)) return true;
  return false;
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

export async function actorRequiresMfa(db: Db, userId: string): Promise<boolean> {
  return roleRequiresMfa(await actorRole(db, userId));
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
