import { randomUUID } from "node:crypto";
import { compareReasons } from "./report-order.ts";
import { isHardRule, type HardRuleValue } from "../../src/lib/board/text.ts";
import { DM_REPORT_NOTE_MAX, DM_REPORT_TEXT_MAX } from "../../src/lib/e2ee/dm-report.ts";
import { isUniqueViolation, type Db } from "../db.ts";
import { actorRole } from "../board/access.ts";
import { openBan } from "../board/store.ts";

export type DmReport = {
  id: string;
  reason: HardRuleValue;
  note: string;
  /** The text the reporter chose to share. Empty for CSAM. Not verified by the server. */
  sharedText: string;
  reporterName: string;
  reportedName: string;
  messageSentAt: number | null;
  /** False once the message itself has been deleted. */
  messageKept: boolean;
  at: number;
};

type Err = { ok: false; status: number; error: string };
type Ok<T> = { ok: true; value: T };
const fail = (status: number, error: string): Err => ({ ok: false, status, error });

/** A participant reports a message the other person sent. */
export async function fileDmReport(
  db: Db,
  input: {
    userId: string;
    messageId: string;
    reason: unknown;
    note: unknown;
    sharedText: unknown;
    now: Date;
  },
): Promise<Ok<{ id: string }> | Err> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can report.");
  if (await openBan(db, input.userId, input.now)) return fail(403, "This account cannot report right now.");
  if (!isHardRule(input.reason)) return fail(400, "Choose a reason.");
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > DM_REPORT_NOTE_MAX) return fail(400, "Keep the note under 500 characters.");
  const shared = typeof input.sharedText === "string" ? input.sharedText.trim() : "";
  if (shared.length > DM_REPORT_TEXT_MAX) return fail(400, "That text is too long to share.");
  // No text is stored for a CSAM report, even if the client sends some.
  const sharedText = input.reason === "csam" ? "" : shared;

  const rows = await db.query<{
    id: string;
    thread_id: string;
    sender_user_id: string | null;
    created_at: Date | string;
    sender_name: string;
  }>(
    `select m.id, m.thread_id, m.sender_user_id, m.created_at,
            case when t.user_a = m.sender_user_id then t.user_a_name else t.user_b_name end as sender_name
     from dm_message m join dm_thread t on t.id = m.thread_id
     where m.id = $1 and (t.user_a = $2 or t.user_b = $2)`,
    [input.messageId, input.userId],
  );
  const message = rows[0];
  if (!message) return fail(404, "That message was not found.");
  if (message.sender_user_id === input.userId) return fail(400, "Report a message someone sent you.");

  const id = randomUUID();
  try {
    await db.query(
      `insert into dm_report
       (id, message_id, thread_id, reporter_user_id, reported_user_id, reported_name,
        reason, note, shared_text, message_sent_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        message.id,
        message.thread_id,
        input.userId,
        message.sender_user_id,
        message.sender_name || "Former member",
        input.reason,
        note,
        sharedText,
        message.created_at,
        input.now,
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "You already reported this message.");
    throw error;
  }
  return { ok: true, value: { id } };
}

export const BANNED_ADMIN = "This account is banned and cannot act as an admin right now.";

/** Open DM reports, for admins only. Highest severity first, then oldest. */
export async function listDmReports(
  db: Db,
  input: { userId: string; now?: Date },
): Promise<Ok<DmReport[]> | Err> {
  const actor = await actorRole(db, input.userId);
  if (!actor.admin) return fail(403, "Only an admin reads message reports.");
  if (await openBan(db, input.userId, input.now ?? new Date())) return fail(403, BANNED_ADMIN);
  const rows = await db.query<{
    id: string;
    reason: HardRuleValue;
    note: string;
    shared_text: string;
    reporter_name: string | null;
    reported_name: string;
    message_sent_at: Date | string | null;
    message_id: string | null;
    created_at: Date | string;
  }>(
    `select r.id, r.reason, r.note, r.shared_text, u.name as reporter_name, r.reported_name,
            r.message_sent_at, r.message_id, r.created_at
     from dm_report r left join "user" u on u.id = r.reporter_user_id
     where r.status = 'open'`,
  );
  const reports = rows.map((row) => ({
    id: row.id,
    reason: row.reason,
    note: row.note,
    sharedText: row.reason === "csam" ? "" : row.shared_text,
    reporterName: row.reporter_name ?? "Former member",
    reportedName: row.reported_name,
    messageSentAt: row.message_sent_at ? new Date(row.message_sent_at).getTime() : null,
    messageKept: row.message_id !== null,
    at: new Date(row.created_at).getTime(),
  }));
  reports.sort(compareReasons);
  return { ok: true, value: reports };
}

/** An admin closes a report. The message is then swept on its normal schedule. */
export async function closeDmReport(
  db: Db,
  input: { userId: string; reportId: string; resolution: unknown; now: Date },
): Promise<Ok<null> | Err> {
  const actor = await actorRole(db, input.userId);
  if (!actor.admin) return fail(403, "Only an admin closes message reports.");
  if (await openBan(db, input.userId, input.now)) return fail(403, BANNED_ADMIN);
  if (input.resolution !== "resolved" && input.resolution !== "dismissed") {
    return fail(400, "Choose resolved or dismissed.");
  }
  const rows = await db.query<{ id: string }>(
    `update dm_report set status = 'closed', resolution = $2, closed_at = $3, closed_by_user_id = $4
     where id = $1 and status = 'open' returning id`,
    [input.reportId, input.resolution, input.now, input.userId],
  );
  if (!rows[0]) return fail(404, "That report is not open.");
  return { ok: true, value: null };
}
