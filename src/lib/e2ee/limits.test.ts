import assert from "node:assert/strict";
import test from "node:test";
import { DM_ABOUT_NOTICE, DM_DEMO_NOTICE, DM_ENCRYPTED_NOTICE, DM_SAFETY_HINT } from "./copy.ts";
import { DM_RETENTION_DAYS, DM_TEXT_MAX, dmTextError, passphraseError } from "./limits.ts";

test("message limits stay two people, plain text, and 30 days", () => {
  assert.equal(DM_RETENTION_DAYS, 30);
  assert.equal(dmTextError("  "), "Write a message first.");
  assert.equal(dmTextError("Thursday"), null);
  assert.match(dmTextError("a".repeat(DM_TEXT_MAX + 1)) ?? "", /4000/);
  assert.equal(passphraseError("short"), "Use at least 12 characters.");
  assert.equal(passphraseError("a long enough passphrase"), null);
  assert.match(passphraseError("aaaaaaaaaaaa") ?? "", /stronger passphrase/);
});

test("message copy is English and does not add a feed, likes, reshares, or scores", () => {
  for (const line of [DM_DEMO_NOTICE, DM_ENCRYPTED_NOTICE, DM_ABOUT_NOTICE, DM_SAFETY_HINT]) {
    assert.equal(line.includes("like"), false);
    assert.equal(line.toLowerCase().includes("reshare"), false);
    assert.equal(line.toLowerCase().includes("score"), false);
    assert.equal(line.toLowerCase().includes("algorithm"), false);
  }
  assert.match(DM_ENCRYPTED_NOTICE, /Two people/);
  assert.match(DM_ENCRYPTED_NOTICE, /plain text/);
  assert.match(DM_ENCRYPTED_NOTICE, /30 days/);
  assert.match(DM_ENCRYPTED_NOTICE, /ciphertext/);
  assert.match(DM_DEMO_NOTICE, /this device/);
  assert.match(DM_ABOUT_NOTICE, /same meeting/);
});
