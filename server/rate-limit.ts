import { randomUUID } from "node:crypto";
import { isUniqueViolation, type Db } from "./db.ts";

/** Five attempts a minute. A further attempt while blocked doubles the wait, up to 16 minutes. */
export const ATTEMPT_LIMIT = { windowMs: 60_000, max: 5 };
export const SIGNUP_LIMIT = ATTEMPT_LIMIT;
export const SIGN_IN_LIMIT = ATTEMPT_LIMIT;
export const INVITE_LIMIT = ATTEMPT_LIMIT;

/** Private messages, separate from the sign-in attempt cap. */
export const DM_SEND_LIMIT = { windowMs: 10 * 60 * 1000, max: 30 };
export const DM_BUNDLE_LIMIT = { windowMs: 10 * 60 * 1000, max: 60 };

export type LimitRule = { windowMs: number; max: number };

const BACKOFF_CAP = 4;

/** How long the current count keeps the key closed, in milliseconds. */
export function lockMs(count: number, rule: LimitRule): number {
  const strikes = Math.max(0, count - rule.max);
  const steps = Math.min(strikes, BACKOFF_CAP);
  return rule.windowMs * 2 ** steps;
}

/**
 * Shared per-key limit in the rateLimit table. Better Auth uses the same
 * table for its own limiter. The window starts at the first request. Once
 * the max is hit, each extra request doubles the wait from that start.
 */
export async function consumeLimit(
  db: Db,
  key: string,
  rule: LimitRule,
  now: number,
  attempt = 0,
): Promise<{ allowed: boolean; retryAfter: number }> {
  if (!Number.isFinite(rule.max) || rule.max < 1) throw new Error("Rate limit max must be at least 1.");
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
      const count = row ? Number(row.count) : 0;
      const last = row ? Number(row.lastRequest) : 0;
      const lock = row ? lockMs(count, rule) : 0;
      const fresh = !row || now - last >= lock;
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
      if (count < rule.max) {
        await tx.query(`update "rateLimit" set "count" = "count" + 1 where "key" = $1`, [key]);
        return { allowed: true, retryAfter: 0 };
      }
      const retryAfter = Math.max(1, Math.ceil((last + lock - now) / 1000));
      await tx.query(`update "rateLimit" set "count" = "count" + 1 where "key" = $1`, [key]);
      return { allowed: false, retryAfter };
    });
  } catch (error) {
    if (attempt < 1 && isUniqueViolation(error)) return consumeLimit(db, key, rule, now, attempt + 1);
    throw error;
  }
}
