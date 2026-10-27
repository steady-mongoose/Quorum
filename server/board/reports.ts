import { randomUUID } from "node:crypto";
import { compareReports } from "../../src/lib/board/reports.ts";
import { isHardRule, type HardRuleValue } from "../../src/lib/board/text.ts";
import { isUniqueViolation, type Db } from "../db.ts";
import { actorRole, stewardsRoom, type BoardActor } from "./access.ts";
import { guardRoomAudience } from "./audience.ts";
import { openBan } from "./store.ts";
import { flagCsam } from "./csam-flag.ts";

export type ReportSubject = "post" | "chat";

export type MemberReport = {
  id: string;
  roomId: string;
  subjectKind: ReportSubject;
  subjectId: string;
  reason: HardRuleValue;
  note: string;
  source: "member" | "steward";
  at: number;
  /** Admins only. Empty for a steward who is not an admin. */
  reporterName: string;
  /** Empty when the reason is CSAM. The post text is not sent. */
  excerpt: string;
};

type Err = { ok: false; status: number; error: string };
type Ok<T> = { ok: true; value: T };

function fail(status: number, error: string): Err {
  return { ok: false, status, error };
}

const NOTE_MAX = 500;

export async function fileReport(
  db: Db,
  input: {
    userId: string;
    name: string;
    roomId: string;
    subjectKind: string;
    subjectId: string;
    reason: string;
    note: string;
    now: Date;
    /** Member reports are the default. Steward flagging passes "steward". */
    source?: "member" | "steward";
  },
): Promise<Ok<MemberReport> | Err> {
  const actor = await actorRole(db, input.userId);
  if (!actor.member) return fail(403, "Only a member can report.");
  const ban = await openBan(db, input.userId, input.now);
  if (ban) return fail(403, "This account cannot report right now.");
  if (input.subjectKind !== "post" && input.subjectKind !== "chat") {
    return fail(400, "Choose a post or a chat line.");
  }
  if (!isHardRule(input.reason)) return fail(400, "Choose a reason.");
  const note = input.note.trim();
  if (note.length > NOTE_MAX) return fail(400, "Keep the note under 500 characters.");
  const source = input.source === "steward" ? "steward" : "member";
  if (source === "steward" && !actor.admin && !actor.stewardRooms.includes(input.roomId)) {
    return fail(403, "Only a steward of this room can flag it.");
  }
  const gate = await guardRoomAudience(db, {
    userId: input.userId,
    roomId: input.roomId,
    now: input.now,
    path: "post",
    record: false,
    actor,
  });
  if (!gate.ok) return fail(gate.status, gate.error);

  const subject = await subjectAuthor(db, input.subjectKind, input.subjectId, input.roomId);
  if (!subject) {
    return fail(404, input.subjectKind === "chat" ? "That line is not here." : "That post is not here.");
  }
  if (subject.authorId === input.userId) return fail(400, "Report someone else's post.");

  const id = randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `insert into member_report
         (id, room_id, subject_kind, subject_id, reporter_user_id, reason, note, source, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, input.roomId, input.subjectKind, input.subjectId, input.userId, input.reason, note, source, input.now],
      );
      // A CSAM report on a post also flags it for the custodian. The flag hides the
      // post's media from everyone at once, and the custodian decides what happens.
      // A chat line has no media, so it stays a report only.
      if (input.reason === "csam" && input.subjectKind === "post") {
        const flagged = await flagCsam(tx, {
          userId: input.userId,
          name: input.name,
          postId: input.subjectId,
          reason: `Member report ${id}`,
          source: "report",
          now: input.now,
        });
        if (!flagged.ok) throw new Error(`CSAM flag failed: ${flagged.error}`);
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "You already reported this.");
    throw error;
  }
  return {
    ok: true,
    value: {
      id,
      roomId: input.roomId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      reason: input.reason,
      note,
      source,
      at: input.now.getTime(),
      reporterName: input.name.trim() || "Member",
      excerpt: input.reason === "csam" ? "" : subject.excerpt,
    },
  };
}

async function subjectAuthor(
  db: Db,
  kind: ReportSubject,
  id: string,
  roomId: string,
): Promise<{ authorId: string | null; excerpt: string } | null> {
  if (kind === "post") {
    const rows = await db.query<{ author_user_id: string | null; claim: string }>(
      `select author_user_id, claim from board_post
       where id = $1 and room_id = $2 and removed = false`,
      [id, roomId],
    );
    const row = rows[0];
    if (!row) return null;
    return { authorId: row.author_user_id, excerpt: row.claim.slice(0, 160) };
  }
  const rows = await db.query<{ author_user_id: string | null; body: string }>(
    `select author_user_id, body from room_chat_message
     where id = $1 and room_id = $2 and removed = false`,
    [id, roomId],
  );
  const row = rows[0];
  if (!row) return null;
  return { authorId: row.author_user_id, excerpt: row.body.slice(0, 160) };
}

/**
 * Open reports for a room's stewards, or every room for an admin.
 * Ordered by severity, then oldest first. A CSAM row has an empty excerpt.
 */
export async function listReports(
  db: Db,
  input: { userId: string; roomId: string; now: Date },
): Promise<Ok<MemberReport[]> | Err> {
  const actor = await actorRole(db, input.userId);
  const allowed = queueRooms(actor, input.roomId);
  if (!allowed.ok) return allowed;
  const stopped = await moderatorStop(db, actor, input.userId, allowed.rooms[0] ?? "", input.now);
  if (stopped) return stopped;
  const rows = await db.query<{
    id: string;
    room_id: string;
    subject_kind: string;
    subject_id: string;
    reason: string;
    note: string;
    source: string;
    created_at: Date | string;
    reporter_name: string;
    excerpt: string | null;
  }>(
    `select r.id, r.room_id, r.subject_kind, r.subject_id, r.reason, r.note, r.source, r.created_at,
            u.name as reporter_name,
            case
              when r.reason = 'csam' then ''
              when r.subject_kind = 'post' then left(coalesce(p.claim, ''), 160)
              else left(coalesce(c.body, ''), 160)
            end as excerpt
     from member_report r
     join "user" u on u.id = r.reporter_user_id
     left join board_post p on r.subject_kind = 'post' and p.id = r.subject_id
     left join room_chat_message c on r.subject_kind = 'chat' and c.id = r.subject_id
     where r.status = 'open' and r.room_id = $1`,
    [allowed.rooms[0]],
  );
  const reports: MemberReport[] = [];
  for (const row of rows) {
    if (!isHardRule(row.reason)) continue;
    if (row.subject_kind !== "post" && row.subject_kind !== "chat") continue;
    reports.push({
      id: row.id,
      roomId: row.room_id,
      subjectKind: row.subject_kind,
      subjectId: row.subject_id,
      reason: row.reason,
      note: row.note,
      source: row.source === "steward" ? "steward" : "member",
      at: new Date(row.created_at).getTime(),
      reporterName: actor.admin ? row.reporter_name : "",
      excerpt: row.reason === "csam" ? "" : (row.excerpt ?? ""),
    });
  }
  reports.sort(compareReports);
  return { ok: true, value: reports };
}

function queueRooms(
  actor: BoardActor,
  roomId: string,
): { ok: true; rooms: string[] } | Err {
  if (actor.admin) {
    if (roomId) return { ok: true, rooms: [roomId] };
    return fail(400, "Choose a room.");
  }
  if (!actor.stewardRooms.includes(roomId)) {
    return fail(403, "Reports in this room go to its stewards.");
  }
  return { ok: true, rooms: [roomId] };
}

/**
 * A steward with no live member role, or anyone barred from the room or the
 * site, cannot read or act on the queue.
 */
async function moderatorStop(
  db: Db,
  actor: BoardActor,
  userId: string,
  roomId: string,
  now: Date,
): Promise<Err | null> {
  if (!actor.member) return fail(403, "Only a member with a live role can read reports.");
  const ban = await openBan(db, userId, now, roomId);
  if (ban) return fail(403, "This account is barred and cannot read reports.");
  return null;
}

export type ReportResolution = "resolved" | "dismissed";

/** A steward of the room or an admin closes one open report. One log row is written. */
export async function closeReport(
  db: Db,
  input: { userId: string; reportId: string; resolution: string; note: string; now: Date },
): Promise<Ok<{ id: string; resolution: ReportResolution }> | Err> {
  if (input.resolution !== "resolved" && input.resolution !== "dismissed") {
    return fail(400, "Choose resolved or dismissed.");
  }
  const resolution: ReportResolution = input.resolution;
  const note = input.note.trim();
  if (note.length > NOTE_MAX) return fail(400, "Keep the note under 500 characters.");
  const rows = await db.query<{ room_id: string; status: string }>(
    `select room_id, status from member_report where id = $1`,
    [input.reportId],
  );
  const report = rows[0];
  if (!report) return fail(404, "That report is not here.");
  const actor = await actorRole(db, input.userId);
  if (!stewardsRoom(actor, report.room_id)) {
    return fail(403, "Reports in this room go to its stewards.");
  }
  const stopped = await moderatorStop(db, actor, input.userId, report.room_id, input.now);
  if (stopped) return stopped;
  if (report.status !== "open") return fail(409, "That report is already closed.");
  const closed = await db.transaction(async (tx) => {
    const updated = await tx.query<{ id: string }>(
      `update member_report
       set status = 'closed', closed_at = $2, closed_by_user_id = $3, resolution = $4
       where id = $1 and status = 'open'
       returning id`,
      [input.reportId, input.now, input.userId, resolution],
    );
    if (!updated[0]) return false;
    await tx.query(
      `insert into member_report_log (id, report_id, actor_user_id, action, resolution, note, created_at)
       values ($1, $2, $3, 'close', $4, $5, $6)`,
      [randomUUID(), input.reportId, input.userId, resolution, note, input.now],
    );
    return true;
  });
  if (!closed) return fail(409, "That report is already closed.");
  return { ok: true, value: { id: input.reportId, resolution } };
}
