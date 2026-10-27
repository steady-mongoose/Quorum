import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "./closed-test/test-db.ts";
import { purgeSecurityLogs, SECURITY_LOG_DAYS } from "./security-log-purge.ts";

const now = new Date("2026-10-27T12:00:00Z");
const days = (n: number) => new Date(now.getTime() - n * 864e5);

test("sign-in and security logs older than 90 days are deleted; live sessions are kept", async () => {
  const { db, close } = await openTestDb();
  try {
    assert.equal(SECURITY_LOG_DAYS, 90);
    await db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ('u', 'U', 'u@example.test', true, $1, $1)`,
      [days(400)],
    );
    const session = async (id: string, created: Date, expires: Date) =>
      db.query(
        `insert into "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId", "ipAddress")
         values ($1, $2, $1, $3, $3, 'u', '203.0.113.9')`,
        [id, expires, created],
      );
    await session("old-ended", days(120), days(100));
    await session("old-live", days(120), new Date(now.getTime() + 864e5));
    await session("recent-ended", days(30), days(20));
    const limit = (id: string, at: Date) =>
      db.query(`insert into "rateLimit" (id, key, count, "lastRequest") values ($1, $1, 1, $2)`, [id, at.getTime()]);
    await limit("old-ip", days(91));
    await limit("new-ip", days(1));

    const counts = await purgeSecurityLogs(db, now);
    assert.deepEqual(counts, { sessions: 1, rateLimits: 1, mfaAudit: 0 });
    const left = await db.query<{ id: string }>(`select id from "session" order by id`);
    assert.deepEqual(left.map((r) => r.id), ["old-live", "recent-ended"]);
    const limits = await db.query<{ id: string }>(`select id from "rateLimit"`);
    assert.deepEqual(limits.map((r) => r.id), ["new-ip"]);
    assert.deepEqual(await purgeSecurityLogs(db, now), { sessions: 0, rateLimits: 0, mfaAudit: 0 });
  } finally {
    await close();
  }
});

test("mfa_audit rows older than 90 days are deleted when that table exists", async () => {
  const { db, close } = await openTestDb();
  try {
    await db.query(`create table if not exists mfa_audit (id text primary key, at timestamptz not null)`);
    await db.query(`insert into mfa_audit values ($1, $2), ($3, $4)`, [randomUUID(), days(100), "keep", days(10)]);
    const counts = await purgeSecurityLogs(db, now);
    assert.equal(counts.mfaAudit, 1);
    const rows = await db.query<{ id: string }>(`select id from mfa_audit`);
    assert.deepEqual(rows.map((r) => r.id), ["keep"]);
  } finally {
    await close();
  }
});
