import { createHmac } from "node:crypto";

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
  const expiry = Math.floor(nowMs / 1000) + ttlSeconds;
  const username = `${expiry}:${userId}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential };
}
