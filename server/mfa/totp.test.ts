import assert from "node:assert/strict";
import test from "node:test";
import { hotp, otpauthUrl, totpAt, verifyTotp } from "./totp.ts";
import { openSecret, sealSecret } from "./secret.ts";

test("HOTP matches the RFC 4226 SHA-1 vector", () => {
  const secret = Buffer.from("12345678901234567890");
  assert.equal(hotp(secret, 0n), "755224");
  assert.equal(hotp(secret, 1n), "287082");
});

test("a code is accepted once inside the window", () => {
  const secret = Buffer.from("12345678901234567890");
  const now = 59_000;
  const code = totpAt(secret, now);
  const first = verifyTotp(secret, code, now, null);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const replay = verifyTotp(secret, code, now, first.step);
  assert.equal(replay.ok, false);
  if (replay.ok) return;
  assert.equal(replay.reason, "replay");
  const later = verifyTotp(secret, totpAt(secret, now + 30_000), now + 30_000, first.step);
  assert.equal(later.ok, true);
});

test("one step of clock skew is accepted and an older step is not", () => {
  const secret = Buffer.from("12345678901234567890");
  const now = 1_700_000_000_000;
  const skewed = verifyTotp(secret, totpAt(secret, now - 30_000), now, null);
  assert.equal(skewed.ok, true);
  const stale = verifyTotp(secret, totpAt(secret, now - 60_000), now, null);
  assert.equal(stale.ok, false);
});

test("the sealed authenticator secret round-trips and is not the plaintext", () => {
  const previous = process.env.MFA_SECRET_KEY;
  process.env.MFA_SECRET_KEY = "a".repeat(32);
  try {
    const plain = Buffer.from("totp-secret-material");
    const sealed = sealSecret(plain);
    assert.equal(sealed.ciphertext.includes(plain.toString("utf8")), false);
    assert.equal(sealed.iv.length > 0, true);
    const opened = openSecret(sealed);
    assert.equal(opened?.equals(plain), true);
    process.env.MFA_SECRET_KEY = "b".repeat(32);
    assert.equal(openSecret(sealed), null);
  } finally {
    if (previous === undefined) delete process.env.MFA_SECRET_KEY;
    else process.env.MFA_SECRET_KEY = previous;
  }
});

test("the authenticator entry is labelled Avouch Social", () => {
  const url = new URL(otpauthUrl("ada@example.com", "JBSWY3DPEHPK3PXP"));
  assert.equal(decodeURIComponent(url.pathname), "/Avouch Social:ada@example.com");
  assert.equal(url.searchParams.get("issuer"), "Avouch Social");
});
