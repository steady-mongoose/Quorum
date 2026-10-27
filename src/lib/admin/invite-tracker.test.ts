import assert from "node:assert/strict";
import test from "node:test";
import { parseInvites } from "./invite-tracker.ts";

test("parseInvites keeps only known fields", () => {
  const rows = parseInvites({
    invites: [{ id: "a", note: "n", codeHash: "x", code_hash: "y", redeemed: true, createdAt: 1, lastSignIn: 5 }],
  });
  assert.equal(rows.length, 1);
  assert.equal("codeHash" in (rows[0] ?? {}), false);
  assert.equal("code_hash" in (rows[0] ?? {}), false);
  assert.equal(rows[0]?.lastSignIn, 5);
  assert.deepEqual(parseInvites(null), []);
});
