/**
 * Who reads and marks RSVPs (Josh via CoS, Oct 30, 7:01–7:04 AM ET). One
 * rule, shared by the server (server/board/rsvp.ts) and the client
 * (model.ts, rsvp-api.ts):
 *   - An admin, as an admin, gets counts only (GET /api/rsvps/summary):
 *     never a respondent's name, email, id or handle, and does not mark.
 *   - A gathering's host, and the room's stewards, see who is going and who
 *     came, and mark who came.
 *   - Anyone else sees only their own RSVP.
 */

/**
 * TODO(Josh): open question (a), Oct 30. An admin who is also this
 * gathering's host, or a steward of its room: do they get that role's normal
 * view (names, roll call, marking)? `true` = yes, role-based, no admin
 * carve-out (the current default). `false` = an admin sees counts only, even
 * in a room they host or steward. Flipping it is this one line.
 */
export const ADMIN_ROLE_SEES_NAMES = true;

/** Whether this host or steward role counts for this reader, given the flag. */
export function roleCounts(admin: boolean): boolean {
  return !admin || ADMIN_ROLE_SEES_NAMES;
}

/**
 * TODO(Josh): the smallest count the admin RSVP summary shows. A count above 0
 * and under this is hidden, and so is one count beside it (or more), so a
 * total cannot give it away. 5 is a provisional, privacy-safe default that
 * matches the rest of /admin/stats; Josh has not chosen N yet. Every line of
 * copy about it is derived from this constant (privacyNote), so changing N is
 * one line.
 */
export const RSVP_SUMMARY_MIN_COUNT = 5;

/** The panel's always-shown privacy line, from N. */
export function privacyNote(n: number = RSVP_SUMMARY_MIN_COUNT): string {
  return `To protect privacy, a count under ${n} is hidden, and so is one count beside it, so a total can't give it away.`;
}

/** What a screen reader hears for a hidden cell. */
export const HIDDEN_CELL_LABEL = "hidden to protect privacy";
