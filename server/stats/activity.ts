import type { Db } from "../db.ts";
import { endpointGroup } from "../../src/lib/board/stats.ts";
import { utcDate } from "./dates.ts";

/**
 * One row per member per calendar day, plus a count per endpoint group.
 * The address on the request is not written. Message tables are not read.
 */
export async function noteAuthenticatedRequest(
  db: Db,
  memberId: string,
  now: Date,
  pathname: string,
): Promise<void> {
  const date = utcDate(now);
  const group = endpointGroup(pathname);
  const found = await db.query<{ id: string }>(`select id from "user" where id = $1`, [memberId]);
  if (!found[0]) return;
  await db.query(
    `insert into member_active_days (member_id, date)
     values ($1, $2::date)
     on conflict (member_id, date) do nothing`,
    [memberId, date],
  );
  if (!group) return;
  await db.query(
    `insert into stats_daily (date, metric, dimension, count)
     values ($2::date, 'feature', $1, 1)
     on conflict (date, metric, dimension)
     do update set count = stats_daily.count + 1`,
    [group, date],
  );
}
