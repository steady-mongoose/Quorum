/**
 * Calendar age from a stored birthdate. The date itself is never sent to a client.
 * "Today" is the calendar date in America/New_York, not UTC.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MIN_PROFILE_AGE = 18;
export const MAX_PROFILE_AGE = 120;
export const PROFILE_TIME_ZONE = "America/New_York";

/** Year, month, and day of `now` in `timeZone`. Month is 1–12. */
export function civilDate(
  now: Date,
  timeZone = PROFILE_TIME_ZONE,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

/** `YYYY-MM-DD`, or null when the text is not a real calendar day. */
export function parseBirthdate(value: string): string | null {
  const match = DATE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Whole years on the New York calendar date of `now`. A later birthday does not count yet. */
export function ageOn(birthdate: string, now: Date): number {
  const parsed = parseBirthdate(birthdate);
  if (!parsed) return -1;
  const [year, month, day] = parsed.split("-").map(Number);
  const today = civilDate(now);
  let age = today.year - (year ?? 0);
  if (today.month < (month ?? 0) || (today.month === month && today.day < (day ?? 0))) age -= 1;
  return age;
}

export function birthdateError(birthdate: string, now: Date): string | null {
  const age = ageOn(birthdate, now);
  if (age < 0) return "Enter a real birthdate.";
  if (age < MIN_PROFILE_AGE) return "You must be 18.";
  if (age > MAX_PROFILE_AGE) return "Enter a real birthdate.";
  return null;
}
