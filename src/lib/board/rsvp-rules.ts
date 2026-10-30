/**
 * Who reads and marks RSVPs (Josh via CoS, Oct 30, 7:01–7:04 AM ET). One
 * rule, shared by the server (server/board/rsvp.ts) and the client
 * (model.ts, rsvp-api.ts):
 *   - An admin, as an admin, gets counts only (GET /api/rsvps/summary):
 *     never a respondent's name, email, id or handle, and does not mark.
 *     An admin who really hosts or stewards gets that role (ADMIN_ROLE_SEES_NAMES).
 *   - A gathering's host, and the room's stewards, see who is going and who
 *     came, and mark who came.
 *   - Anyone else sees only their own RSVP.
 */

/**
 * Josh, Oct 30 7:54/7:55 AM ET (settled): an admin sees names only on a
 * gathering they really host (gathering.host) or in a room they really
 * steward, and marks there like any host or steward. Filing a write-up never
 * grants names. An admin with neither role there gets counts only and cannot
 * mark (403). `false` is the stricter fallback: an admin never sees names in
 * any role, cannot mark, and names nobody on a write-up (ADMIN_NO_NAMES).
 */
export const ADMIN_ROLE_SEES_NAMES = true;

let adminSeesNames: boolean = ADMIN_ROLE_SEES_NAMES;

/** Tests only: run `fn` with the other setting, then restore it. */
export async function withAdminRoleSeesNames<T>(value: boolean, fn: () => T | Promise<T>): Promise<T> {
  const before = adminSeesNames;
  adminSeesNames = value;
  try {
    return await fn();
  } finally {
    adminSeesNames = before;
  }
}

/** The calm refusal for an admin who tries to mark or name who came. */
export const ADMIN_NO_NAMES = "Admins can't see or mark who came, to keep members' privacy.";

/** Whether this host or steward role counts for this reader, given the flag. */
export function roleCounts(admin: boolean): boolean {
  return !admin || adminSeesNames;
}

/**
 * The smallest count the admin RSVP summary shows (decided by Josh, Oct 30,
 * 7:53 AM ET: N = 5). A count above 0 and under this is hidden, and so is one
 * count beside it (or more), so a total cannot give it away. Every line of
 * copy about it is derived from this constant (privacyNote), so changing N is
 * one line.
 */
export const RSVP_SUMMARY_MIN_COUNT = 5;

/** The panel's always-shown privacy line, from N. */
export function privacyNote(n: number = RSVP_SUMMARY_MIN_COUNT): string {
  return `To protect privacy, a count under ${n} is hidden, and so is one count beside it, so a total can't give it away. A count that matches a room's whole membership is hidden too.`;
}

/** What a screen reader hears for a hidden cell. */
export const HIDDEN_CELL_LABEL = "hidden to protect privacy";

/** The board's civil time zone (as profile age uses). */
export const MARK_TIME_ZONE = "America/New_York";

/** Why a mark was refused: before the gathering, or someone who never said they'd go. */
export const MARK_TOO_EARLY = "You can mark who came once the gathering has started.";
export const MARK_NOT_GOING = "Only members who said they're going can be marked as came.";

/**
 * Whether marks may be made yet (QA F4, Oct 30): not before a dated
 * gathering's date, nor before its start time when the time reads as HH:MM,
 * in the board's time zone. An undated gathering (a repeating one) has no
 * date to wait for here; its next date is checked by the client.
 */
export function markOpen(gathering: { date: string; time?: string }, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gathering.date)) return true;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MARK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const today = `${get("year")}-${get("month")}-${get("day")}`;
  if (today !== gathering.date) return today > gathering.date;
  const time = /^(\d{1,2}):(\d{2})$/.exec((gathering.time ?? "").trim());
  if (!time) return true;
  const start = `${time[1]!.padStart(2, "0")}:${time[2]}`;
  return `${get("hour")}:${get("minute")}` >= start;
}
