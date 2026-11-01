import { COUNTY_REQUIRED, isCountyId, type CountyId } from "../../src/lib/board/counties.ts";
import type { Db } from "../db.ts";
import { actorRole } from "./access.ts";
import { countyColumnsReady } from "./room-visibility.ts";
import { openBan, type Result } from "./store.ts";

/** The county a member chose, or null until they choose. */
export async function readHomeCounty(db: Db, userId: string): Promise<CountyId | null> {
  const rows = await db.query<{ home_county: string | null }>(
    `select home_county from members where user_id = $1`,
    [userId],
  );
  const saved = rows[0]?.home_county;
  return isCountyId(saved) ? saved : null;
}

/** Writes the county, adding the members row when this account has none yet. */
export async function writeHomeCounty(db: Db, userId: string, county: CountyId): Promise<void> {
  await db.query(
    `insert into members (user_id, display_name, home_county)
     select id, left(coalesce(nullif(trim(name), ''), 'Member'), 80), $2
     from "user" where id = $1
     on conflict (user_id) do update set home_county = excluded.home_county`,
    [userId, county],
  );
}

export async function saveHomeCounty(
  db: Db,
  input: { userId: string; county: string; now: Date },
): Promise<Result<{ county: CountyId }>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return { ok: false, status: 403, error: "Only a member can set a county." };
  const ban = await openBan(db, input.userId, input.now);
  if (ban) return { ok: false, status: 403, error: "banned", ban };
  if (!isCountyId(input.county)) return { ok: false, status: 400, error: COUNTY_REQUIRED };
  if (!(await countyColumnsReady(db))) {
    return { ok: false, status: 503, error: "Counties are not set up on this server yet." };
  }
  await writeHomeCounty(db, input.userId, input.county);
  return { ok: true, value: { county: input.county } };
}
