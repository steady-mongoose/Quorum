import assert from "node:assert/strict";
import test from "node:test";
import { openTestDb } from "./closed-test/test-db.ts";
import { consumeLimit } from "./rate-limit.ts";

test("a shared limit blocks the next request and resets when the window ends", async () => {
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
    const later = await consumeLimit(db, "signup:203.0.113.5", rule, 61_000);
    assert.equal(later.allowed, true);
  } finally {
    await close();
  }
});
