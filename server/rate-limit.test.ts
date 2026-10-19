import assert from "node:assert/strict";
import test from "node:test";
import { authRateLimit } from "./auth.ts";
import { openTestDb } from "./closed-test/test-db.ts";
import { ATTEMPT_LIMIT, consumeLimit, lockMs } from "./rate-limit.ts";

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

test("Better Auth rate limits are stored in the database", () => {
  assert.equal(authRateLimit.enabled, true);
  assert.equal(authRateLimit.storage, "database");
  assert.equal(authRateLimit.window, 60);
  assert.deepEqual(authRateLimit.customRules["/sign-in/*"], { window: 60, max: 5 });
  assert.deepEqual(authRateLimit.customRules["/sign-up/*"], { window: 60, max: 5 });
});
