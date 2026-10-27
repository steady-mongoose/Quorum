import { randomBytes, timingSafeEqual } from "node:crypto";
import sodium from "libsodium-wrappers-sumo";

export const RECOVERY_COUNT = 10;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let ready: Promise<void> | null = null;

function sodiumReady(): Promise<void> {
  ready ??= sodium.ready;
  return ready;
}

/** Ten characters from a 32-symbol alphabet, shown as three groups. */
export function generateRecoveryCode(): string {
  const chars: string[] = [];
  while (chars.length < 10) {
    const buf = randomBytes(16);
    for (const byte of buf) {
      if (byte >= 256 - (256 % 32)) continue;
      chars.push(ALPHABET[byte % 32]!);
      if (chars.length === 10) break;
    }
  }
  const raw = chars.join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function recoveryCodeShape(code: string): boolean {
  return /^[A-Z2-9]{10}$/.test(normalizeRecoveryCode(code));
}

type HashParts = { ops: number; mem: number; salt: Uint8Array; hash: Uint8Array };

function encodeHash(parts: HashParts): string {
  return [
    "argon2id",
    String(parts.ops),
    String(parts.mem),
    sodium.to_base64(parts.salt, sodium.base64_variants.ORIGINAL),
    sodium.to_base64(parts.hash, sodium.base64_variants.ORIGINAL),
  ].join("$");
}

function decodeHash(stored: string): HashParts | null {
  const pieces = stored.split("$");
  if (pieces.length !== 5 || pieces[0] !== "argon2id") return null;
  const ops = Number(pieces[1]);
  const mem = Number(pieces[2]);
  if (!Number.isInteger(ops) || !Number.isInteger(mem) || ops < 1 || mem < 8192) return null;
  try {
    const salt = sodium.from_base64(pieces[3] ?? "", sodium.base64_variants.ORIGINAL);
    const hash = sodium.from_base64(pieces[4] ?? "", sodium.base64_variants.ORIGINAL);
    if (salt.length !== sodium.crypto_pwhash_SALTBYTES || hash.length !== 32) return null;
    return { ops, mem, salt, hash };
  } catch {
    return null;
  }
}

export async function hashRecoveryCode(code: string): Promise<string> {
  await sodiumReady();
  const normalized = normalizeRecoveryCode(code);
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const hash = sodium.crypto_pwhash(
    32,
    normalized,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  return encodeHash({
    ops: sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    mem: sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    salt,
    hash,
  });
}

function hashesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

/**
 * Checks every stored hash. A used row can match and is still rejected, so
 * the number of remaining codes does not change how long this takes.
 */
export async function matchRecoveryCode(
  code: string,
  rows: { id: string; codeHash: string; used: boolean }[],
): Promise<{ id: string } | null> {
  await sodiumReady();
  const normalized = normalizeRecoveryCode(code);
  if (!recoveryCodeShape(code)) {
    for (const row of rows) decodeHash(row.codeHash);
    return null;
  }
  let matched: { id: string; used: boolean } | null = null;
  for (const row of rows) {
    const parts = decodeHash(row.codeHash);
    if (!parts) continue;
    const hash = sodium.crypto_pwhash(
      32,
      normalized,
      parts.salt,
      parts.ops,
      parts.mem,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
    if (hashesEqual(hash, parts.hash) && !matched) matched = row;
  }
  if (!matched || matched.used) return null;
  return { id: matched.id };
}
