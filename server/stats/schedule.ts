import type { Db } from "../db.ts";
import { rollStats } from "./rollup.ts";
import { utcDate } from "./dates.ts";

/** Once per UTC day, and again after a failed attempt. Does not keep the process awake. */
export function startNightlyStats(
  db: Db,
  retentionDays: number,
  now: () => Date = () => new Date(),
): () => void {
  let lastDay = "";
  let running = false;
  const tick = () => {
    const day = utcDate(now());
    if (day === lastDay || running) return;
    running = true;
    void rollStats(db, now(), retentionDays)
      .then(() => {
        lastDay = day;
        console.log(JSON.stringify({ event: "stats-rollup", day }));
      })
      .catch((error: unknown) => {
        console.error(
          JSON.stringify({
            event: "stats-rollup-failed",
            message: error instanceof Error ? error.message : "unknown",
          }),
        );
      })
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}
