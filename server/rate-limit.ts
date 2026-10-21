import { randomUUID } from "node:crypto";
import { isUniqueViolation, type Db } from "./db.ts";

/** Five attempts a minute. A further attempt while blocked doubles the wait, up to 16 minutes. */
export const ATTEMPT_LIMIT = { windowMs: 60_000, max: 5 };
export const SIGNUP_LIMIT = ATTEMPT_LIMIT;
export const SIGN_IN_LIMIT = ATTEMPT_LIMIT;
export const INVITE_LIMIT = ATTEMPT_LIMIT;
/** Per member and per address. A picture is a direct upload, so this stays tight. */
export const UPLOAD_LIMIT = { windowMs: 60 * 60 * 1000, max: 20 };
/** Join, leave, and poll. Sixty in ten seconds per signed-in member. */
export const CALLS_LIMIT = { windowMs: 10_000, max: 60 };

export type LimitRule = { windowMs: number; max: number };

const BACKOFF_CAP = 4;

/** Same length cap as account email checks. Longer values are not used as keys. */
export const EMAIL_KEY_MAX = 200;

const EMAIL_SHAPE =
  /^[a-z0-9._+-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** How long the current count keeps the key closed, in milliseconds. */
export function lockMs(count: number, rule: LimitRule): number {
  const strikes = Math.max(0, count - rule.max);
  const steps = Math.min(strikes, BACKOFF_CAP);
  return rule.windowMs * 2 ** steps;
}

/** Oldest lastRequest that can still be inside a lock. Rows older than this are deleted. */
export function maxLockMs(rule: LimitRule): number {
  return lockMs(rule.max + BACKOFF_CAP, rule);
}

/**
 * Rate-limit identity for an email. Trimmed and lowercased, and the plus tag
 * dropped. Dots in the local part are removed only for gmail.com and
 * googlemail.com, and those two domains share one key (gmail.com). Other
 * providers keep dots, because first.last and firstlast are different
 * mailboxes there. Null when the value is empty, too long, or not an address.
 * Account rows still keep the address the person typed, aside from trim and case.
 */
export function emailRateKey(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > EMAIL_KEY_MAX) return null;
  if (!EMAIL_SHAPE.test(trimmed)) return null;
  const at = trimmed.lastIndexOf("@");
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replaceAll(".", "");
  if (!local) return null;
  const key = `${local}@${domain}`;
  if (key.length > EMAIL_KEY_MAX || !/^[a-z0-9._-]+@[a-z0-9.-]+$/.test(key)) return null;
  return key;
}

export function emailLimitKeys(email: string): string[] | null {
  const key = emailRateKey(email);
  if (!key) return null;
  return ["sign-in", "signup", "invite"].map((scope) => `${scope}:email:${key}`);
}

/** Deletes the three email buckets. Returns the keys removed from consideration. */
export async function clearEmailLimit(db: Db, email: string): Promise<string[]> {
  const keys = emailLimitKeys(email);
  if (!keys) throw new Error("Enter an email address.");
  await db.query(`delete from "rateLimit" where "key" in ($1, $2, $3)`, keys);
  return keys;
}

/** One prune covers this many expired rows. The rest wait for a later sample. */
export const PRUNE_BATCH = 500;

/** A prune runs on every Nth limited write, not on each one. */
export const PRUNE_EVERY = 20;

let writesSincePrune = 0;

/** Test hook. Production starts at zero and counts writes in this process. */
export function resetPruneSchedule(): void {
  writesSincePrune = 0;
}

/** True on writes N, 2N, 3N, … so concurrent floods do not each scan the table. */
export function shouldPruneWrite(writeIndex: number): boolean {
  return writeIndex > 0 && writeIndex % PRUNE_EVERY === 0;
}

/**
 * Deletes at most `limit` rows whose last request is older than the longest
 * lock. The lastRequest index (migration 0005, owner approval required)
 * serves the filter. Callers sample writes instead of pruning on every one.
 */
export async function pruneRateLimits(
  db: Db,
  now: number,
  rule: LimitRule,
  limit = PRUNE_BATCH,
): Promise<void> {
  const cutoff = now - maxLockMs(rule);
  await db.query(
    `delete from "rateLimit" where ctid in (
       select ctid from "rateLimit" where "lastRequest" < $1 order by "lastRequest" limit $2
     )`,
    [cutoff, limit],
  );
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
    writesSincePrune += 1;
    if (shouldPruneWrite(writesSincePrune)) {
      try {
        await pruneRateLimits(db, now, rule);
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : null;
        console.error(
          JSON.stringify({
            event: "rate-limit-prune-failed",
            code,
            message: error instanceof Error ? error.message : "unknown",
          }),
        );
      }
    }
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
