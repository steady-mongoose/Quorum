import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";

/**
 * Test helper. Gives a user an active authenticator and a session that has
 * already passed the second step, so a test can act as an admin or steward
 * now that privileged routes are closed until an authenticator is on.
 * Returns the session id to send as x-session-id.
 */
export async function trustAuthenticator(db: Db, userId: string): Promise<string> {
  const sessionId = randomUUID();
  await db.query(
    `insert into "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
     values ($1, now() + interval '2 days', $2, now(), now(), $3)`,
    [sessionId, randomUUID(), userId],
  );
  await db.query(
    `insert into mfa_factor (id, user_id, kind, status, confirmed_at)
     select $1, $2, 'totp', 'active', now()
     where not exists (select 1 from mfa_factor where user_id = $2 and status = 'active')`,
    [randomUUID(), userId],
  );
  await db.query(
    `insert into mfa_assurance (session_id, user_id, verified_at) values ($1, $2, now())`,
    [sessionId, userId],
  );
  return sessionId;
}
