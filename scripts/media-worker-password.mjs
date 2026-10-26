import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

const PASSWORD = /^[A-Za-z0-9]{16,128}$/;
const VERIFIER = /^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/;

/**
 * SCRAM-SHA-256 secret in the form Postgres stores in pg_authid.
 * The password stays on this side of the connection. ALTER ROLE receives
 * only this verifier, so a statement log does not contain the password.
 * @param {string} password
 * @param {Buffer} [salt]
 * @param {number} [iterations]
 * @returns {string}
 */
export function scramSha256Verifier(password, salt = randomBytes(16), iterations = 4096) {
  if (!PASSWORD.test(password)) {
    throw new Error(
      "Set MEDIA_WORKER_DB_PASSWORD to 16 or more letters and digits before applying migrations/0007_media_worker_role.sql. That file needs the owner's approval.",
    );
  }
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/**
 * Password statement for every migrate run, including a re-run.
 * CREATE ROLE is recorded once and would keep the old password.
 * @param {string} password
 * @returns {string}
 */
export function mediaWorkerPasswordSql(password) {
  const verifier = scramSha256Verifier(password);
  if (!VERIFIER.test(verifier) || verifier.includes("'") || verifier.includes(password)) {
    throw new Error("The media worker password verifier is not a SCRAM-SHA-256 secret.");
  }
  return `ALTER ROLE media_worker PASSWORD '${verifier}'`;
}
