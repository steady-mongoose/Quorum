export const DEFAULT_ACTIVITY_RETENTION_DAYS = 90;

/** Whole days of per-member activity kept before the nightly prune. Default 90. */
export function activityRetentionDays(raw: string | undefined): number {
  const text = raw?.trim() ?? "";
  if (!text) return DEFAULT_ACTIVITY_RETENTION_DAYS;
  if (!/^\d+$/.test(text)) {
    throw new Error("ACTIVITY_RETENTION_DAYS must be a whole number of days.");
  }
  const value = Number(text);
  if (value < 1 || value > 3650) {
    throw new Error("ACTIVITY_RETENTION_DAYS must be from 1 to 3650.");
  }
  return value;
}
