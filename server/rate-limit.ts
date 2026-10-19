import { randomUUID } from "node:crypto";
import { isUniqueViolation, type Db } from "./db.ts";

export const SIGNUP_LIMIT = { windowMs: 10 * 60 * 1000, max: 5 };
export const SIGN_IN_LIMIT = { windowMs: 10 * 60 * 1000, max: 5 };
export const INVITE_LIMIT = { windowMs: 60 * 60 * 1000, max: 30 };
export const DM_SEND_LIMIT = { windowMs: 10 * 60 * 1000, max: 30 };
export const DM_BUNDLE_LIMIT = { windowMs: 10 * 60 * 1000, max: 60 };

export type LimitRule = { windowMs: number; max: number };

/**
 * Shared per-key limit stored in the rateLimit table so two API processes
 * on the box see the same counts. The window starts at the first request
 * and does not slide.
 */
export async function consumeLimit(
  db: Db,
  key: string,
  rule: LimitRule,
  now: number,
  attempt = 0,
): Promise<{ allowed: boolean; retryAfter: number }> {
  if (!Number.isFinite(rule.max) || rule.max < 1)
    throw new Error("Rate limit max must be at least 1.");
  if (!Number.isFinite(rule.windowMs) || rule.windowMs < 1000) {
    throw new Error("Rate limit window must be at least 1 second.");
  }
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx.query<{ count: number; lastRequest: number | string }>(
        `select "count", "lastRequest" from "rateLimit" where "key" = $1 for update`,
        [key],
      );
      const row = rows[0];
      const last = row ? Number(row.lastRequest) : 0;
      const fresh = !row || now - last >= rule.windowMs;
      if (fresh) {
        if (row) {
          await tx.query(
            `update "rateLimit" set "count" = 1, "lastRequest" = $2 where "key" = $1`,
            [key, now],
          );
        } else {
          await tx.query(
            `insert into "rateLimit" ("id", "key", "count", "lastRequest") values ($1, $2, 1, $3)`,
            [randomUUID(), key, now],
          );
        }
        return { allowed: true, retryAfter: 0 };
      }
      const count = Number(row.count);
      if (count >= rule.max) {
        return {
          allowed: false,
          retryAfter: Math.max(1, Math.ceil((last + rule.windowMs - now) / 1000)),
        };
      }
      await tx.query(`update "rateLimit" set "count" = "count" + 1 where "key" = $1`, [key]);
      return { allowed: true, retryAfter: 0 };
    });
  } catch (error) {
    if (attempt < 1 && isUniqueViolation(error))
      return consumeLimit(db, key, rule, now, attempt + 1);
    throw error;
  }
}
