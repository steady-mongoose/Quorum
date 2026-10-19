import assert from "node:assert/strict";
import test from "node:test";
import { parseAccountResult, parseSessionBody } from "./account-result.ts";

test("a session body without a user is signed out", () => {
  assert.equal(parseSessionBody(503, { error: "api-unavailable" }), null);
  assert.equal(parseSessionBody(200, null), null);
  assert.deepEqual(
    parseSessionBody(200, { user: { id: "1", name: "Maria", email: "maria@example.com" } }),
    {
      id: "1",
      name: "Maria",
      email: "maria@example.com",
    },
  );
});

test("signup and sign-in errors stay in plain English", () => {
  assert.deepEqual(
    parseAccountResult(403, {
      error: "invite-only",
      message: "Accounts are created with an invite code.",
    }),
    {
      ok: false,
      message: "Accounts are created with an invite code.",
    },
  );
  assert.deepEqual(parseAccountResult(400, { message: "An invite code is required." }), {
    ok: false,
    message: "An invite code is required.",
  });
  assert.equal(
    parseAccountResult(200, { user: { id: "1", name: "Maria", email: "maria@example.com" } }).ok,
    true,
  );
});
