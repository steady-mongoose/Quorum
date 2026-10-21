import { createHmac } from "node:crypto";

/** How long a minted password stays valid. Coturn reads the expiry in the username. */
export const TURN_TTL_SECONDS = 60 * 60;

/** The password stays the same inside this window so a poll does not rotate it. */
export const TURN_SLOT_SECONDS = 15 * 60;

/**
 * Unix expiry for a TURN password. Inside one 15 minute slot it does not
 * change. The remaining life is between 45 and 60 minutes.
 */
export function turnExpirySeconds(nowMs: number, ttlSeconds = TURN_TTL_SECONDS): number {
  const nowSec = Math.floor(nowMs / 1000);
  const slotEnd = Math.floor(nowSec / TURN_SLOT_SECONDS) * TURN_SLOT_SECONDS + TURN_SLOT_SECONDS;
  return slotEnd + ttlSeconds - TURN_SLOT_SECONDS;
}

/**
 * Coturn REST credentials. The username is `expiry:userId`. The password is
 * base64(HMAC-SHA1(secret, username)). Coturn checks the expiry and does not
 * store the call. The secret never leaves the API process.
 */
export function mintTurnCredential(
  secret: string,
  userId: string,
  nowMs: number,
  ttlSeconds: number,
): { username: string; credential: string } {
  return mintTurnCredentialAt(secret, userId, turnExpirySeconds(nowMs, ttlSeconds));
}

export function mintTurnCredentialAt(
  secret: string,
  userId: string,
  expirySeconds: number,
): { username: string; credential: string } {
  const username = `${expirySeconds}:${userId}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential };
}
