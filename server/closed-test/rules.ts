import { createHash, randomBytes } from "node:crypto";

/** Same seat as draft PR #2. The server stores it in Postgres, not the browser. */
export const FOUNDING_ADMIN = "Josh";

export const MEMBER_NOTE = "Member, one inviter.";
export const FOUNDING_MEMBER_NOTE = "Founding member.";
export const FOUNDING_ADMIN_NOTE = "Founding admin and council chair.";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessAction = "grant" | "revoke";

export type AccessRow = {
  id: string;
  userId: string | null;
  role: "member" | "steward" | "admin";
  action: AccessAction;
  at: number;
};

/**
 * `Josh`, `1`, and `true` all name Josh. `0` and `false` do not.
 * Any other text is returned so the caller can refuse a different name.
 * Matches `founderNameFromEnv` on draft PR #2.
 */
export function founderNameFromEnv(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw || raw === "0" || raw.toLowerCase() === "false") return "";
  if (raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "josh") {
    return FOUNDING_ADMIN;
  }
  return raw;
}

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function generateInviteCode(): string {
  const bytes = randomBytes(8);
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export function hashInviteCode(code: string): string {
  return createHash("sha256").update(normalizeInviteCode(code)).digest("hex");
}

export function validPersonName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 80;
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
}

export function validPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 128;
}

export type InviteView = {
  uses: number;
  maxUses: number;
  expiresAt: Date | string;
};

/** Why a code cannot be redeemed, or null when it still can. */
export function inviteBlock(row: InviteView | null, now: Date): string | null {
  if (!row) return "That code is not valid.";
  if (row.uses >= row.maxUses) return "That code has been used up.";
  const expires = new Date(row.expiresAt).getTime();
  if (Number.isNaN(expires) || expires <= now.getTime()) return "That code has expired.";
  return null;
}

export function readMaxUses(
  value: unknown,
): { ok: true; maxUses: number } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, maxUses: 1 };
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 20) {
    return { ok: false, error: "A code can be used from 1 to 20 times." };
  }
  return { ok: true, maxUses: n };
}

export function readExpiry(
  value: unknown,
  now: Date,
): { ok: true; expiresAt: Date } | { ok: false; error: string } {
  let days = 7;
  if (value !== undefined && value !== null && value !== "") {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      return { ok: false, error: "A code lasts from 1 to 30 days." };
    }
    days = n;
  }
  return { ok: true, expiresAt: new Date(now.getTime() + days * DAY_MS) };
}

/** Newest grant wins. A later revoke closes it. Same rule as draft PR #2. */
export function isLiveGrant(
  rows: readonly AccessRow[],
  userId: string,
  role: AccessRow["role"],
): boolean {
  let latest: AccessRow | null = null;
  for (const row of rows) {
    if (row.userId !== userId || row.role !== role) continue;
    if (!latest || row.at > latest.at || (row.at === latest.at && row.id > latest.id)) latest = row;
  }
  return latest?.action === "grant";
}

export function isOpenSignupPath(pathname: string): boolean {
  return pathname === "/api/auth/sign-up" || pathname.startsWith("/api/auth/sign-up/");
}
