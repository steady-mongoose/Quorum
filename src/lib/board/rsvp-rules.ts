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
