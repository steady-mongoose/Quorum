import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";

/**
 * A report stays open while a CSAM flag on it (or on its subject) is open: only a
 * custodian's Preserve and remove closes it.
 */
export async function openCsamFlagFor(
  db: Db,
  report: { id: string; subjectKind: string; subjectId: string },
): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `select id from csam_flag
     where resolved_at is null
       and (reason = $1
            or ($2 = 'chat' and chat_message_id = $3)
            or ($2 = 'post' and post_id = $3))
     limit 1`,
    [`Member report ${report.id}`, report.subjectKind, report.subjectId],
  );
  return rows.length > 0;
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
       and not exists (
         select 1 from csam_flag f
         where f.resolved_at is null
           and (f.reason = 'Member report ' || member_report.id
                or ($1 = 'chat' and f.chat_message_id = member_report.subject_id)
                or ($1 = 'post' and f.post_id = member_report.subject_id))
       )
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
