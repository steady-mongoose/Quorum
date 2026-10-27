/** Calendar dates in UTC. The rollup does not use a member's local clock. */

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function addUtcDays(iso: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error("Expected a calendar date.");
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** Monday of the week that contains `iso`, in UTC. */
export function weekStart(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error("Expected a calendar date.");
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const weekday = utc.getUTCDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  return addUtcDays(iso, delta);
}

export function isoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  if (!match?.[1]) throw new Error("Expected a calendar date from the database.");
  return match[1];
}

export function asCount(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.trunc(count);
}
