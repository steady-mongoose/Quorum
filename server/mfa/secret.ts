import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

const HKDF_INFO = "avouch-mfa-totp-v1";

export class MfaKeyError extends Error {
  constructor() {
    super("MFA_SECRET_KEY is not set.");
    this.name = "MfaKeyError";
  }
}

/** A random 32-byte key as hex, or as standard base64. A passphrase uses HKDF. */
export function rawMfaKey(value: string): Buffer | null {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  if (trimmed.length === 43 || trimmed.length === 44) {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 32) return decoded;
  }
  return null;
}

export function mfaKeyError(raw: string | undefined = process.env.MFA_SECRET_KEY): string | null {
  const value = raw?.trim() ?? "";
  if (rawMfaKey(value) || value.length >= 16) return null;
  return "Set MFA_SECRET_KEY to a random 32-byte key, or a passphrase of at least 16 characters.";
}

export function mfaKey(): Buffer {
  const raw = process.env.MFA_SECRET_KEY?.trim() ?? "";
  if (mfaKeyError(raw)) throw new MfaKeyError();
  const direct = rawMfaKey(raw);
  if (direct) return direct;
  return Buffer.from(hkdfSync("sha256", raw, Buffer.alloc(0), Buffer.from(HKDF_INFO), 32));
}

/** Fingerprint of the current key. Not the key. */
export function mfaKeyId(): string {
  return createHash("sha256").update(HKDF_INFO).update(mfaKey()).digest("hex").slice(0, 16);
}

export type SealedSecret = { ciphertext: string; iv: string; keyId: string };

export function sealSecret(plain: Buffer): SealedSecret {
  const key = mfaKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    keyId: mfaKeyId(),
  };
}

export function openSecret(sealed: SealedSecret): Buffer | null {
  let key: Buffer;
  try {
    key = mfaKey();
  } catch (error) {
    if (error instanceof MfaKeyError) return null;
    throw error;
  }
  if (sealed.keyId && sealed.keyId !== mfaKeyId()) return null;
  const iv = Buffer.from(sealed.iv, "base64");
  const payload = Buffer.from(sealed.ciphertext, "base64");
  if (iv.length !== 12 || payload.length < 17) return null;
  const tag = payload.subarray(payload.length - 16);
  const data = payload.subarray(0, payload.length - 16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    return null;
  }
}

/** Boot warning. The value of the key is not included. */
export function warnMissingMfaKey(log: (message: string) => void = console.error): void {
  if (mfaKeyError() === null) return;
  log(
    "WARNING: MFA_SECRET_KEY is not set. Authenticator enrollment stays off until a random 32-byte key, or a passphrase of at least 16 characters, is set.",
  );
}
