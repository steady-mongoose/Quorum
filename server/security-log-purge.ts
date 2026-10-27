import type { Db } from "./db.ts";

/** Sign-in and security records older than this are deleted. */
export const SECURITY_LOG_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PurgeCounts = { sessions: number; rateLimits: number; mfaAudit: number };

/**
 * Deletes sign-in and security logs older than 90 days:
 * - ended sign-in sessions (with their IP and user agent) that began more than 90 days ago;
 *   a session that is still live is never touched, so no one is signed out;
 * - rate-limit rows (keyed by IP) last used more than 90 days ago;
 * - authenticator audit rows (mfa_audit, once #64's migration exists) older than 90 days.
 * Moderation, appeal, role-grant and CSAM records are not sign-in or security logs and are kept.
 */
export async function purgeSecurityLogs(db: Db, now: Date): Promise<PurgeCounts> {
  const cutoff = new Date(now.getTime() - SECURITY_LOG_DAYS * DAY_MS);
  const sessions = await db.query<{ id: string }>(
    `delete from "session" where "createdAt" < $1 and "expiresAt" < $2 returning id`,
    [cutoff, now],
  );
  const rateLimits = await db.query<{ id: string }>(
    `delete from "rateLimit" where "lastRequest" < $1 returning id`,
    [cutoff.getTime()],
  );
  let mfaAudit = 0;
  const hasMfa = await db.query<{ present: string | null }>(
    `select to_regclass('public.mfa_audit')::text as present`,
  );
  if (hasMfa[0]?.present) {
    const rows = await db.query<{ id: string }>(`delete from mfa_audit where at < $1 returning id`, [cutoff]);
    mfaAudit = rows.length;
  }
  const counts = { sessions: sessions.length, rateLimits: rateLimits.length, mfaAudit };
  console.log(JSON.stringify({ event: "security-log-purge", ...counts }));
  return counts;
}

/** Runs once at start and then every 24 hours. */
export function startSecurityLogPurge(db: Db, now: () => Date = () => new Date()): () => void {
  const run = () => {
    void purgeSecurityLogs(db, now()).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          event: "security-log-purge-failed",
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
    });
  };
  run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
