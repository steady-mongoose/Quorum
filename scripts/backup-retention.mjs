// @ts-check
/**
 * Which nightly dumps are old enough to delete.
 * Names look like `avouch-20261019T031500Z.dump.age` (or the older `.dump` and `.dump.enc`).
 * @param {Iterable<string>} names
 * @param {number} nowMs
 * @param {number} retentionDays
 * @returns {string[]}
 */
export function dumpsToDelete(names, nowMs, retentionDays) {
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    throw new Error("BACKUP_RETENTION_DAYS must be at least 1.");
  }
  const cutoff = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  const pattern = /^avouch-(\d{8})T(\d{6})Z\.dump(?:\.(?:enc|age))?$/;
  /** @type {string[]} */
  const stale = [];
  for (const name of names) {
    const match = pattern.exec(name);
    if (!match) continue;
    const day = match[1];
    const clock = match[2];
    const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${clock.slice(0, 2)}:${clock.slice(2, 4)}:${clock.slice(4, 6)}Z`;
    const stamp = Date.parse(iso);
    if (Number.isNaN(stamp)) continue;
    if (stamp < cutoff) stale.push(name);
  }
  return stale;
}
