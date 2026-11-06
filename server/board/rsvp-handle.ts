import { createHmac, randomBytes } from "node:crypto";

/**
 * The per-gathering handle that stands in for an account id in host and
 * steward lists (see rsvp.ts). Its own module so the board store can map a
 * write-up's roll call without importing the RSVP routes.
 *
 * The host process refuses to start without BETTER_AUTH_SECRET (config.ts),
 * so the random fallback only applies to tests and other entry points; there
 * handles change on restart.
 */
const HANDLE_KEY = process.env.BETTER_AUTH_SECRET || randomBytes(32).toString("hex");

export function rsvpHandle(gatheringId: string, userId: string): string {
  const mac = createHmac("sha256", `rsvp-handle:${HANDLE_KEY}`)
    .update(`${gatheringId.toLowerCase()}\n${userId}`)
    .digest("base64url");
  return `h_${mac.slice(0, 22)}`;
}

/** A did-not-happen close or write-up that still names someone (QA S3). */
export const DID_NOT_NAMES = "A gathering that did not happen names no one.";
