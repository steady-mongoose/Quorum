import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";

/**
 * True while a post or a reply under it has an open report. The author can
 * neither delete nor revise it until a steward looks. The member report queue
 * may not exist yet on this database.
 */
export async function openReportOn(db: Db, postId: string): Promise<boolean> {
  const table = await db.query<{ name: string | null }>(
    `select to_regclass('public.member_report')::text as name`,
  );
  if (!table[0]?.name) return false;
  const rows = await db.query<{ id: string }>(
    `select id from member_report
     where status = 'open' and subject_kind = 'post'
       and (subject_id = $1 or subject_id in (select id from board_post where parent_id = $1))
     limit 1`,
    [postId],
  );
  return Boolean(rows[0]);
}

/**
 * Closes every open report on removed posts or chat lines, inside the
 * removal transaction, and logs one auto-close row per report.
 */
export async function autoCloseReports(
  tx: Db,
  input: { subjectKind: "post" | "chat"; subjectIds: string[]; actorUserId: string; now: Date },
): Promise<number> {
  if (input.subjectIds.length === 0) return 0;
  const closed = await tx.query<{ id: string }>(
    `update member_report
     set status = 'closed', closed_at = $3, closed_by_user_id = $4, resolution = 'removed'
     where status = 'open' and subject_kind = $1 and subject_id = any($2::text[])
     returning id`,
    [input.subjectKind, input.subjectIds, input.now, input.actorUserId],
  );
  for (const row of closed) {
    await tx.query(
      `insert into member_report_log (id, report_id, actor_user_id, action, resolution, note, created_at)
       values ($1, $2, $3, 'auto-close', 'removed', '', $4)`,
      [randomUUID(), row.id, input.actorUserId, input.now],
    );
  }
  return closed.length;
}
