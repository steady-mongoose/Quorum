/** Calendar age from a stored birthdate. The date itself is never sent to a client. */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MIN_PROFILE_AGE = 18;
export const MAX_PROFILE_AGE = 120;

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

/** Whole years at `now`, in UTC. A birthday later this year does not count yet. */
export function ageOn(birthdate: string, now: Date): number {
  const parsed = parseBirthdate(birthdate);
  if (!parsed) return -1;
  const [year, month, day] = parsed.split("-").map(Number);
  let age = now.getUTCFullYear() - (year ?? 0);
  const nowMonth = now.getUTCMonth() + 1;
  const nowDay = now.getUTCDate();
  if (nowMonth < (month ?? 0) || (nowMonth === month && nowDay < (day ?? 0))) age -= 1;
  return age;
}

export function birthdateError(birthdate: string, now: Date): string | null {
  const age = ageOn(birthdate, now);
  if (age < 0) return "Enter a real birthdate.";
  if (age < MIN_PROFILE_AGE) return "You must be 18.";
  if (age > MAX_PROFILE_AGE) return "Enter a real birthdate.";
  return null;
}
