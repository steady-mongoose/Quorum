import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { INVITE_TRACKER_SQL, listInviteTracker } from "./invite-tracker.ts";
import { handleInviteTracker } from "./invite-tracker-routes.ts";

const now = new Date("2026-10-20T12:00:00Z");

async function user(db: Db, id: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $1, $2, true, $3, $3)`,
    [id, `${id}@example.test`, now],
  );
}
async function grant(db: Db, userId: string, role: string) {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, 'n', $3, '', 'grant', 't', 't', 't', 'Granted for the test.', $4)`,
    [randomUUID(), userId, role, now],
  );
}
async function session(db: Db, userId: string, at: Date) {
  await db.query(
    `insert into "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
     values ($1, $2, $1, $3, $3, $4)`,
    [randomUUID(), new Date(at.getTime() + 864e5), at, userId],
  );
}

async function seed() {
  const opened = await openTestDb();
  const { db } = opened;
  for (const id of ["admin", "member", "newbie"]) await user(db, id);
  await grant(db, "admin", "admin");
  await grant(db, "member", "member");
  await db.query(
    `insert into invite_code (id, code_hash, created_by, max_uses, expires_at, note, created_at)
     values ('inv1', 'SECRETHASH1', 'admin', 1, $1, 'For Tom from shop night', $2),
            ('inv2', 'SECRETHASH2', 'admin', 1, $1, 'Unused', $2)`,
    [new Date(now.getTime() + 7 * 864e5), now],
  );
  await db.query(
    `insert into invite_redemption (id, invite_id, invited_user_id, invited_by_user_id, invited_name, invited_by_name, redeemed_at)
     values ('r1', 'inv1', 'newbie', 'admin', 'Tom', 'admin', $1)`,
    [now],
  );
  await session(db, "newbie", new Date("2026-10-21T09:00:00Z"));
  await session(db, "newbie", new Date("2026-10-25T09:00:00Z"));
  return opened;
}

test("the tracker query never selects the code hash", () => {
  assert.equal(INVITE_TRACKER_SQL.includes("code_hash"), false);
});

test("an admin sees note, dates, redemption, email and newest sign-in, and no hash", async () => {
  const { db, close } = await seed();
  try {
    const result = await listInviteTracker(db, "admin");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(JSON.stringify(result.value).includes("SECRETHASH"), false);
    const used = result.value.find((row) => row.id === "inv1");
    assert.equal(used?.note, "For Tom from shop night");
    assert.equal(used?.redeemed, true);
    assert.equal(used?.redeemedBy, "Tom");
    assert.equal(used?.memberEmail, "newbie@example.test");
    assert.equal(used?.lastSignIn, new Date("2026-10-25T09:00:00Z").getTime());
    assert.equal(used?.createdAt, now.getTime());
    const unused = result.value.find((row) => row.id === "inv2");
    assert.equal(unused?.redeemed, false);
    assert.equal(unused?.lastSignIn, null);
  } finally {
    await close();
  }
});

test("a member is refused, the route is GET-only and needs a session", async () => {
  const { db, close } = await seed();
  try {
    const refused = await listInviteTracker(db, "member");
    assert.equal(refused.ok, false);
    const url = new URL("http://x/api/admin/invites");
    const as = (id: string | null) => ({ db, readSession: async () => (id ? { id } : null) });
    assert.equal((await handleInviteTracker(as(null), new Request(url), url))?.status, 401);
    assert.equal((await handleInviteTracker(as("member"), new Request(url), url))?.status, 403);
    assert.equal(
      (await handleInviteTracker(as("admin"), new Request(url, { method: "POST", body: "{}" }), url))?.status,
      405,
    );
    const ok = await handleInviteTracker(as("admin"), new Request(url), url);
    assert.equal(ok?.status, 200);
    const body = await ok?.text();
    assert.equal(body?.includes("SECRETHASH"), false);
    assert.equal(body?.includes("code_hash"), false);
    const other = new URL("http://x/api/other");
    assert.equal(await handleInviteTracker(as("admin"), new Request(other), other), null);
  } finally {
    await close();
  }
});

test("a banned admin cannot see the invite tracker", async () => {
  const { db, close } = await seed();
  try {
    assert.equal((await listInviteTracker(db, "admin", now)).ok, true);
    await db.query(
      `insert into board_ban (id, user_id, name, reason, by_user_id, by_name, strikes, until_at, room_id, created_at)
       values ($1, 'admin', 'admin', 'threat', null, 'owner', 1, $2, '', $3)`,
      [randomUUID(), new Date(now.getTime() + 86_400_000), now],
    );
    assert.deepEqual(await listInviteTracker(db, "admin", now), {
      ok: false,
      status: 403,
      error: "This account is banned and cannot act as an admin right now.",
    });
  } finally {
    await close();
  }
});
