// Local calendar placement for the week view. An ISO date is read as a local
// Y-M-D (`new Date(y, m - 1, d)`), never as a UTC instant, and days step on
// the calendar so a daylight-saving change cannot repeat or skip a date.

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const WEEKDAY_WORD = "sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?";
const ORDINALS = "first|second|third|fourth|last";
const DAY_MS = 86_400_000;

type Slot = { n: number; weekday: number };
type Rule =
  | { kind: "ordinal"; slots: Slot[] }
  | { kind: "every-other"; weekday: number }
  | { kind: "weekly"; weekday: number }
  | { kind: "dated" };

/** The calendar date named by an ISO string, ignoring any time or zone suffix. */
export function localCalendarIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
    return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function localDate(value: string): Date | null {
  const iso = localCalendarIso(value);
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatLocal(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Move a local calendar date by whole days. A 24-hour step is not a day across a DST change. */
export function shiftLocalDate(iso: string, days: number): string {
  const date = localDate(iso);
  if (!date) return iso;
  return formatLocal(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

function calendarDaysBetween(fromIso: string, toIso: string): number {
  const from = localDate(fromIso);
  const to = localDate(toIso);
  if (!from || !to) return Number.NaN;
  const ms =
    Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
    Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round(ms / DAY_MS);
}

function weekdayIndex(word: string): number {
  const name = word.toLowerCase().replace(/s$/, "");
  return WEEKDAY_LABELS.findIndex((label) => label.toLowerCase() === name);
}

function ordinalValue(word: string): number {
  switch (word.toLowerCase()) {
    case "first":
      return 1;
    case "second":
      return 2;
    case "third":
      return 3;
    case "fourth":
      return 4;
    case "last":
      return -1;
    default:
      return 0;
  }
}

function nthWeekdayIso(year: number, month: number, weekday: number, n: number): string | null {
  if (n < 0) {
    const last = new Date(year, month + 1, 0);
    const delta = (last.getDay() - weekday + 7) % 7;
    return formatLocal(new Date(year, month, last.getDate() - delta));
  }
  const first = new Date(year, month, 1);
  const delta = (weekday - first.getDay() + 7) % 7;
  const day = 1 + delta + (n - 1) * 7;
  const date = new Date(year, month, day);
  if (date.getMonth() !== month) return null;
  return formatLocal(date);
}

function ruleFor(time: string): Rule {
  const slots: Slot[] = [];
  const ordinalPattern = new RegExp(
    `\\b((?:(?:${ORDINALS})\\s+and\\s+)*(?:${ORDINALS}))\\s+(${WEEKDAY_WORD})\\b`,
    "gi",
  );
  for (const match of time.matchAll(ordinalPattern)) {
    const weekday = weekdayIndex(match[2] ?? "");
    if (weekday < 0) continue;
    for (const word of (match[1] ?? "").split(/\s+and\s+/i)) {
      const n = ordinalValue(word);
      if (n !== 0) slots.push({ n, weekday });
    }
  }
  if (slots.length > 0) return { kind: "ordinal", slots };

  const everyOther = new RegExp(`\\bevery\\s+other\\s+(${WEEKDAY_WORD})\\b`, "i").exec(time);
  if (everyOther) {
    const weekday = weekdayIndex(everyOther[1] ?? "");
    if (weekday >= 0) return { kind: "every-other", weekday };
  }

  const weekly = new RegExp(`\\b(${WEEKDAY_WORD})\\b`, "i").exec(time);
  if (weekly) {
    const weekday = weekdayIndex(weekly[1] ?? "");
    if (weekday >= 0) return { kind: "weekly", weekday };
  }
  return { kind: "dated" };
}

export type Occurrence = {
  /** The host paused the series. It is not on the calendar. */
  paused?: boolean;
  /** This meeting was cancelled. */
  cancelled?: boolean;
  /** Last day the series still meets, inclusive. */
  until?: string;
};

function held(occurrence: Occurrence = {}): boolean {
  return Boolean(occurrence.paused || occurrence.cancelled);
}

function meetsOn(time: string, next: string, iso: string, occurrence: Occurrence = {}): boolean {
  const date = localDate(iso);
  if (!date) return false;
  if (held(occurrence)) return false;
  const until = occurrence.until ? localCalendarIso(occurrence.until) : null;
  if (until && iso > until) return false;
  const rule = ruleFor(time);
  if (rule.kind === "weekly") {
    if (date.getDay() !== rule.weekday) return false;
    // A missing next means the series still meets every week. A later next
    // (the far side of term, or a date that has not arrived) is not this day.
    const anchor = localCalendarIso(next);
    if (anchor && anchor > iso) return false;
    return true;
  }
  if (rule.kind === "every-other") {
    if (date.getDay() !== rule.weekday) return false;
    const anchor = localCalendarIso(next);
    const anchorDate = anchor ? localDate(anchor) : null;
    if (!anchor || !anchorDate || anchorDate.getDay() !== rule.weekday) return true;
    return calendarDaysBetween(anchor, iso) % 14 === 0;
  }
  if (rule.kind === "ordinal") {
    return rule.slots.some(
      (slot) => nthWeekdayIso(date.getFullYear(), date.getMonth(), slot.weekday, slot.n) === iso,
    );
  }
  return localCalendarIso(next) === iso;
}

/** Local dates in the next seven days on which this meeting actually falls. */
export function meetingDates(
  time: string,
  next: string,
  today: string,
  occurrence: Occurrence = {},
): string[] {
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const iso = shiftLocalDate(today, i);
    if (meetsOn(time, next, iso, occurrence)) dates.push(iso);
  }
  return dates;
}

/** Today, tomorrow, or the local weekday. Never a UTC-shifted day. */
export function dayHeading(iso: string, today: string): string {
  if (iso === today) return "Today";
  if (iso === shiftLocalDate(today, 1)) return "Tomorrow";
  const date = localDate(iso);
  return date ? WEEKDAY_LABELS[date.getDay()] : iso;
}
