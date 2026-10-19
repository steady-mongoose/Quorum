import assert from "node:assert/strict";
import test from "node:test";
import { runAccountCreate, assertAccountCreateAllowed } from "./account-create.ts";
import {
  founderNameFromEnv,
  hashInviteCode,
  inviteCodeFromBytes,
  inviteBlock,
  isLiveGrant,
  isOpenSignupPath,
  normalizeInviteCode,
  readExpiry,
  readMaxUses,
} from "./rules.ts";

test("founder env accepts Josh, 1, and true, and refuses a blank or another name", () => {
  assert.equal(founderNameFromEnv("Josh"), "Josh");
  assert.equal(founderNameFromEnv("josh"), "Josh");
  assert.equal(founderNameFromEnv("1"), "Josh");
  assert.equal(founderNameFromEnv("true"), "Josh");
  assert.equal(founderNameFromEnv(""), "");
  assert.equal(founderNameFromEnv("0"), "");
  assert.equal(founderNameFromEnv("false"), "");
  assert.equal(founderNameFromEnv("Tom"), "Tom");
});

test("invite codes skip biased bytes and stay inside the alphabet", () => {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const counts = new Map<string, number>();
  let accepted = 0;
  for (let byte = 0; byte < 256; byte += 1) {
    try {
      const code = inviteCodeFromBytes(Uint8Array.of(byte), 1);
      accepted += 1;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    } catch {
      // Bytes at or above the unbiased limit cannot start a code on their own.
    }
  }
  assert.equal(accepted, Math.floor(256 / alphabet.length) * alphabet.length);
  assert.equal(counts.size, alphabet.length);
  for (const count of counts.values()) assert.equal(count, 8);
  const code = inviteCodeFromBytes(Uint8Array.of(255, 248, 0, 31, 1, 2, 3, 4, 5, 6));
  assert.equal(code.length, 8);
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
});

test("invite codes normalize and hash without keeping the original", () => {
  assert.equal(normalizeInviteCode(" ab-cd "), "ABCD");
  assert.equal(hashInviteCode("ab-cd"), hashInviteCode("ABCD"));
  assert.notEqual(hashInviteCode("ABCD"), "ABCD");
});

test("a code is blocked when it is missing, spent, or expired", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  assert.equal(inviteBlock(null, now), "That code is not valid.");
  assert.equal(
    inviteBlock({ uses: 1, maxUses: 1, expiresAt: "2026-10-20T00:00:00Z" }, now),
    "That code has been used up.",
  );
  assert.equal(
    inviteBlock({ uses: 0, maxUses: 3, expiresAt: "2026-10-19T11:00:00Z" }, now),
    "That code has expired.",
  );
  assert.equal(inviteBlock({ uses: 2, maxUses: 3, expiresAt: "2026-10-20T00:00:00Z" }, now), null);
});

test("uses and lifetime stay inside the closed-test limits", () => {
  assert.deepEqual(readMaxUses(undefined), { ok: true, maxUses: 1 });
  assert.deepEqual(readMaxUses(20), { ok: true, maxUses: 20 });
  assert.equal(readMaxUses(21).ok, false);
  assert.equal(readMaxUses(0).ok, false);
  const expiry = readExpiry(1, new Date("2026-10-19T00:00:00Z"));
  assert.equal(expiry.ok, true);
  if (expiry.ok) assert.equal(expiry.expiresAt.toISOString(), "2026-10-20T00:00:00.000Z");
  assert.equal(readExpiry(31, new Date()).ok, false);
});

test("the newest access row decides, including a revoke", () => {
  const rows = [
    { id: "a", userId: "u", role: "member" as const, action: "grant" as const, at: 1 },
    { id: "b", userId: "u", role: "member" as const, action: "revoke" as const, at: 2 },
  ];
  assert.equal(isLiveGrant(rows, "u", "member"), false);
  assert.equal(
    isLiveGrant([{ id: "a", userId: "u", role: "admin", action: "grant", at: 1 }], "u", "admin"),
    true,
  );
  assert.equal(isLiveGrant(rows, "other", "member"), false);
});

test("the public sign-up path is the one Better Auth would expose", () => {
  assert.equal(isOpenSignupPath("/api/auth/sign-up/email"), true);
  assert.equal(isOpenSignupPath("/api/auth/sign-in/email"), false);
  assert.equal(isOpenSignupPath("/api/signup"), false);
});

test("an account insert is allowed only inside invite or bootstrap", () => {
  assert.throws(() => assertAccountCreateAllowed(), /invite code/i);
  return runAccountCreate("bootstrap", async () => {
    assert.doesNotThrow(() => assertAccountCreateAllowed());
  });
});
