/** RSVP and attendance rows are kept this many months (Josh, Oct 29, 9:29 PM ET). */
export const RSVP_RETENTION_MONTHS = 12;

/** The same instant RSVP_RETENTION_MONTHS calendar months earlier (UTC). */
export function rsvpCutoff(now: Date): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RSVP_RETENTION_MONTHS);
  return cutoff;
}

/** SQL: a hosted write-up `p` dated on or after the cutoff (its date, or when it was filed). $day / $at are the cutoff. */
export function writeUpWithin(day: string, at: string): string {
  return `(case when p.on_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then p.on_date >= ${day} else p.created_at >= ${at} end)`;
}
