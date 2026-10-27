import type { Db } from "../db.ts";
import { postIsHeld } from "../board/csam.ts";

/**
 * True when no one may be served this file: a CSAM hold covers its post, or an open
 * report or scanner flag names it or its post. No role is exempt. The flag table
 * arrives with the CSAM custody migration; until then only holds apply.
 *
 * Same name and contract as `mediaIsBlocked` in server/board/csam-flag.ts (#72). When
 * both are merged, import that one here and drop this copy.
 */
export async function mediaIsBlocked(
  db: Db,
  file: { id: string; post_id?: string | null },
): Promise<boolean> {
  const postId = file.post_id ?? "";
  if (postId && (await postIsHeld(db, postId))) return true;
  const table = await db.query<{ ok: boolean }>(`select to_regclass('public.csam_flag') is not null as ok`);
  if (!table[0]?.ok) return false;
  const rows = await db.query<{ id: string }>(
    `select id from csam_flag
     where resolved_at is null and (media_id = $1 or ($2 <> '' and post_id = $2))
     limit 1`,
    [file.id, postId],
  );
  return rows.length > 0;
}
