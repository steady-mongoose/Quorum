import { createHmac, timingSafeEqual } from "node:crypto";

/** RFC 6238 defaults used by authenticator apps. SHA-1, 6 digits, 30 seconds. */
export const TOTP_PERIOD_SEC = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** HOTP (RFC 4226) truncated to `digits`. */
export function hotp(secret: Buffer, counter: bigint, digits = TOTP_DIGITS): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  const mod = 10 ** digits;
  return String(binary % mod).padStart(digits, "0");
}

export function totpAt(secret: Buffer, nowMs: number, digits = TOTP_DIGITS): string {
  const counter = BigInt(Math.floor(nowMs / 1000 / TOTP_PERIOD_SEC));
  return hotp(secret, counter, digits);
}

function codesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  const sameLen = a.length === b.length;
  const probe = sameLen ? a : Buffer.alloc(b.length);
  return timingSafeEqual(probe, b) && sameLen;
}

export type TotpResult =
  | { ok: true; step: bigint }
  | { ok: false; reason: "format" | "invalid" | "replay" };

/**
 * Accepts the current step and one step of clock skew. Every step in the
 * window is compared. A step at or before `lastStep` is a replay.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  nowMs: number,
  lastStep: bigint | null,
  window = TOTP_WINDOW,
): TotpResult {
  const normalized = code.trim();
  const formatOk = /^\d{6}$/.test(normalized);
  const counter = BigInt(Math.floor(nowMs / 1000 / TOTP_PERIOD_SEC));
  let matched: bigint | null = null;
  for (let delta = -window; delta <= window; delta += 1) {
    const step = counter + BigInt(delta);
    const expected = hotp(secret, step);
    const same = codesEqual(formatOk ? normalized : "000000", expected);
    if (formatOk && same) matched = step;
  }
  if (!formatOk) return { ok: false, reason: "format" };
  if (matched === null) return { ok: false, reason: "invalid" };
  if (lastStep !== null && matched <= lastStep) return { ok: false, reason: "replay" };
  return { ok: true, step: matched };
}

export function otpauthUrl(account: string, secretBase32: string): string {
  const label = encodeURIComponent(`Avouch:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: "Avouch",
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
