/** "31 h 5 min left", "Due in 40 min", or "Overdue by 2 h 10 min". */
export function countdownLabel(dueAt: number, now: number): string {
  const diff = dueAt - now;
  const total = Math.floor(Math.abs(diff) / 60_000);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const span = hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
  return diff >= 0 ? `${span} left` : `Overdue by ${span}`;
}

/** Under 12 hours left, or overdue, is urgent. */
export function isUrgent(dueAt: number, now: number): boolean {
  return dueAt - now < 12 * 60 * 60 * 1000;
}
