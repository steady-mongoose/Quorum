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

/** The "I went" line on a started gathering for a member who did not say going (Design #126 review 5713515017). */
export const ONLY_GOING_CAN_SAY_WENT = "Only members who said they were going can mark “I went”.";
/**
 * Josh via CoS, Oct 30 12:47 PM ET: RSVPs and marking who came work only on a
 * special event (the host's checkbox, 0050). Any other gathering takes none.
 */
export const RSVP_SPECIAL_ONLY = "RSVPs and who came are only for special events.";
/** Shown on a card when a "special event" tick could not be saved yet (before 0050). */
export const SPECIAL_NOT_READY_LINE = "Special events are not ready yet. Try again later.";
/** A steward's or host's new date was not saved (no answer from the server). */
export const DATE_NOT_SAVED = "The date was not saved. Try again.";
/** The add form's and the card's hint under "This is a special event" (Design 5716107154 L1, L2). */
export const SPECIAL_HINT =
  "Members can say they're going, and you or a steward can mark who came. Other gatherings don't take RSVPs.";

/**
 * What unticking "This is a special event" does to its RSVPs and who came.
 * Josh is deciding (Design 5716107154 H1). "delete" matches the server today
 * (saveGathering drops them); "hide" needs that drop removed on the server.
 * Switching is this one line.
 */
export const UNTICK_SPECIAL: UntickSpecial = "delete";
export type UntickSpecial = "delete" | "hide";
export const UNTICK_SPECIAL_COPY: Record<UntickSpecial, { confirm: string; done: string }> = {
  delete: {
    confirm:
      "Turn off special event? This removes who said they're going and who came for this gathering. It can't be undone.",
    done: "This is no longer a special event. Its RSVPs and who came were removed.",
  },
  hide: {
    confirm:
      "Turn off special event? This hides who said they're going and who came. Tick it again to bring them back.",
    done: "This is no longer a special event. Who said they're going and who came are hidden until you tick it again.",
  },
};
export const SPECIAL_ON_LINE = "This is now a special event. Members can say they're going.";
export const SPECIAL_OFF_LINE = "This is no longer a special event.";

/** The app shows RSVP and attendance controls only where this is true. */
export function isSpecial(card: { special?: boolean }): boolean {
  return card.special === true;
}
export const MARK_NOT_GOING = "Only members who said they're going can be marked as came.";

/**
 * The start time in minutes after midnight, read from the free-text time
 * field (QA N2, Oct 30), or null when no time can be read. "7 pm", "7pm",
 * "7:00 p.m.", "11:59 PM", "noon" and 24-hour "19:00" / "07:30" all read.
 * When the text has more than one time, the latest counts (QA N5): "Doors
 * 6:30 pm, talk at 7:15 pm" is 7:15 pm, so marking never opens early. "noon"
 * is one of the times (12:00), so "after noon service, 3 pm" is 3 pm and
 * "coffee 10:15 am, service at noon" is noon (QA N6). A bare "9:30" with no am/pm and no leading zero
 * could be morning or evening, so it reads as the later one (21:30). A bare
 * number with no colon and no am/pm ("Room 12", "talk at 7") is not a time.
 */
export function startMinutes(time: string | undefined): number | null {
  const text = (time ?? "").toLowerCase();
  const token = /(?<![\d:])(\d{1,2})(?::([0-5]\d))?\s*(a\.?\s?m\b\.?|p\.?\s?m\b\.?)?/g;
  let latest: number | null = null;
  const keep = (minutes: number) => {
    if (latest === null || minutes > latest) latest = minutes;
  };
  if (/\bnoon\b/.test(text)) keep(12 * 60);
  for (const match of text.matchAll(token)) {
    const [, h, m, meridiem] = match;
    const hour = Number(h);
    const minute = m === undefined ? 0 : Number(m);
    if (meridiem) {
      if (hour < 1 || hour > 12) continue;
      const pm = meridiem.startsWith("p");
      keep(((hour % 12) + (pm ? 12 : 0)) * 60 + minute);
      continue;
    }
    if (m === undefined || hour > 23) continue;
    // "07:30", "0:30", "13:00"…"23:59": a 24-hour time.
    if (hour === 0 || hour >= 13 || (h!.length === 2 && h!.startsWith("0"))) keep(hour * 60 + minute);
    // "12:15" is past noon at the latest; "9:30" could be either, so the later reading.
    else keep((hour === 12 ? 12 : hour + 12) * 60 + minute);
  }
  return latest;
}

/**
 * Whether marks may be made yet (QA F4, N2, Oct 30), in the board's time
 * zone (New York), the same on the client and the server:
 * - an undated gathering (no next date) is not open: there is no date it
 *   has started on, and the steward form is not offered without one;
 * - before the gathering's date, not open; after it, open;
 * - on the date, open from its start time (startMinutes); when no time can
 *   be read, only once that date has ended in New York.
 */
export function markOpen(gathering: { date: string; time?: string }, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gathering.date)) return false;
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
  const start = startMinutes(gathering.time);
  if (start === null) return false;
  return Number(get("hour")) * 60 + Number(get("minute")) >= start;
}
