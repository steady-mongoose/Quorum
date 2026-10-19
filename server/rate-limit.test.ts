import assert from "node:assert/strict";
import test from "node:test";
import { authRateLimit } from "./auth.ts";
import { openTestDb } from "./closed-test/test-db.ts";
import {
  ATTEMPT_LIMIT,
  PRUNE_EVERY,
  clearEmailLimit,
  consumeLimit,
  emailRateKey,
  lockMs,
  maxLockMs,
  pruneRateLimits,
  resetPruneSchedule,
  shouldPruneWrite,
} from "./rate-limit.ts";

test("a shared limit blocks with backoff and resets after the longer wait", async () => {
  const { db, close } = await openTestDb();
  try {
    const rule = { windowMs: 60_000, max: 2 };
    const first = await consumeLimit(db, "signup:203.0.113.5", rule, 1_000);
    const second = await consumeLimit(db, "signup:203.0.113.5", rule, 2_000);
    const third = await consumeLimit(db, "signup:203.0.113.5", rule, 3_000);
    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.equal(third.allowed, false);
    assert.equal(third.retryAfter, 58);
    const other = await consumeLimit(db, "signup:203.0.113.6", rule, 3_000);
    assert.equal(other.allowed, true);
    const fourth = await consumeLimit(db, "signup:203.0.113.5", rule, 4_000);
    assert.equal(fourth.allowed, false);
    assert.equal(fourth.retryAfter, 117);
    await consumeLimit(db, "signup:reset", rule, 1_000);
    await consumeLimit(db, "signup:reset", rule, 2_000);
    const denied = await consumeLimit(db, "signup:reset", rule, 3_000);
    assert.equal(denied.allowed, false);
    assert.equal(denied.retryAfter, 58);
    await consumeLimit(db, "signup:backoff", rule, 1_000);
    await consumeLimit(db, "signup:backoff", rule, 2_000);
    const deniedAgain = await consumeLimit(db, "signup:backoff", rule, 3_000);
    const during = await consumeLimit(db, "signup:backoff", rule, 61_000);
    assert.equal(during.allowed, false);
    assert.ok(during.retryAfter > deniedAgain.retryAfter);
    const later = await consumeLimit(db, "signup:reset", rule, 121_000);
    assert.equal(later.allowed, true);
  } finally {
    await close();
  }
});

test("backoff doubles the wait and stops at sixteen minutes", () => {
  assert.equal(lockMs(ATTEMPT_LIMIT.max, ATTEMPT_LIMIT), 60_000);
  assert.equal(lockMs(ATTEMPT_LIMIT.max + 1, ATTEMPT_LIMIT), 120_000);
  assert.equal(lockMs(ATTEMPT_LIMIT.max + 4, ATTEMPT_LIMIT), 960_000);
  assert.equal(lockMs(ATTEMPT_LIMIT.max + 9, ATTEMPT_LIMIT), 960_000);
});

test("expired rows are pruned in a batch, and only on a sampled write", async () => {
  assert.equal(shouldPruneWrite(1), false);
  assert.equal(shouldPruneWrite(PRUNE_EVERY - 1), false);
  assert.equal(shouldPruneWrite(PRUNE_EVERY), true);
  const { db, close } = await openTestDb();
  try {
    const indexes = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where tablename = 'rateLimit'`,
    );
    assert.ok(indexes.some((row) => row.indexname === "rateLimit_lastRequest_idx"));
    const now = 2_000_000;
    const cutoff = now - maxLockMs(ATTEMPT_LIMIT);
    await db.query(
      `insert into "rateLimit" ("id", "key", "count", "lastRequest") values
        ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12), ($13, $14, $15, $16)`,
      [
        "old-a",
        "signup:email:stale-a@example.com",
        9,
        cutoff - 3,
        "old-b",
        "signup:email:stale-b@example.com",
        9,
        cutoff - 2,
        "old-c",
        "signup:email:stale-c@example.com",
        9,
        cutoff - 1,
        "new",
        "signup:email:fresh@example.com",
        2,
        cutoff,
      ],
    );
    resetPruneSchedule();
    await consumeLimit(db, "signup:ip:203.0.113.9", ATTEMPT_LIMIT, now);
    const before = (await db.query<{ key: string }>(`select "key" from "rateLimit" order by "key"`)).map(
      (row) => row.key,
    );
    assert.deepEqual(before, [
      "signup:email:fresh@example.com",
      "signup:email:stale-a@example.com",
      "signup:email:stale-b@example.com",
      "signup:email:stale-c@example.com",
      "signup:ip:203.0.113.9",
    ]);
    await pruneRateLimits(db, now, ATTEMPT_LIMIT, 2);
    const batched = (await db.query<{ key: string }>(`select "key" from "rateLimit" order by "key"`)).map(
      (row) => row.key,
    );
    assert.deepEqual(batched, [
      "signup:email:fresh@example.com",
      "signup:email:stale-c@example.com",
      "signup:ip:203.0.113.9",
    ]);
    resetPruneSchedule();
    for (let n = 0; n < PRUNE_EVERY; n += 1) {
      await consumeLimit(db, "signup:ip:203.0.113.9", ATTEMPT_LIMIT, now);
    }
    const keys = (await db.query<{ key: string }>(`select "key" from "rateLimit" order by "key"`)).map(
      (row) => row.key,
    );
    assert.deepEqual(keys, ["signup:email:fresh@example.com", "signup:ip:203.0.113.9"]);
  } finally {
    await close();
  }
});

test("email keys drop plus tags everywhere and dots only for gmail", () => {
  assert.equal(emailRateKey("  A.B+tag@Example.com "), "a.b@example.com");
  assert.equal(emailRateKey("ab@example.com"), "ab@example.com");
  assert.equal(emailRateKey("first.last+tag@gmail.com"), "firstlast@gmail.com");
  assert.equal(emailRateKey("first.last+tag@GoogleMail.com"), "firstlast@gmail.com");
  assert.equal(emailRateKey("first.last@corp.com"), "first.last@corp.com");
  assert.equal(emailRateKey(""), null);
  assert.equal(emailRateKey("not-an-email"), null);
  assert.equal(emailRateKey("+tag@example.com"), null);
  assert.equal(emailRateKey(`${"a".repeat(190)}@example.com`), null);
});

test("the owner can clear a locked email before the wait ends", async () => {
  const { db, close } = await openTestDb();
  try {
    const now = 5_000_000;
    for (let n = 0; n < ATTEMPT_LIMIT.max; n += 1) {
      const hit = await consumeLimit(db, "signup:email:firstlast@gmail.com", ATTEMPT_LIMIT, now + n);
      assert.equal(hit.allowed, true);
    }
    const blocked = await consumeLimit(db, "signup:email:firstlast@gmail.com", ATTEMPT_LIMIT, now + 10);
    assert.equal(blocked.allowed, false);
    assert.deepEqual(await clearEmailLimit(db, "first.last+x@googlemail.com"), [
      "sign-in:email:firstlast@gmail.com",
      "signup:email:firstlast@gmail.com",
      "invite:email:firstlast@gmail.com",
    ]);
    const again = await consumeLimit(db, "signup:email:firstlast@gmail.com", ATTEMPT_LIMIT, now + 11);
    assert.equal(again.allowed, true);
  } finally {
    await close();
  }
});

test("Better Auth rate limits are stored in the database", () => {
  assert.equal(authRateLimit.enabled, true);
  assert.equal(authRateLimit.storage, "database");
  assert.equal(authRateLimit.window, 60);
  assert.deepEqual(authRateLimit.customRules["/sign-in/*"], { window: 60, max: 5 });
  assert.deepEqual(authRateLimit.customRules["/sign-up/*"], { window: 60, max: 5 });
});
