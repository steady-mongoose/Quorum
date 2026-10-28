import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";

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
