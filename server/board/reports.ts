import { randomUUID } from "node:crypto";
import { compareReports } from "../../src/lib/board/reports.ts";
import { isHardRule, type HardRuleValue } from "../../src/lib/board/text.ts";
import { isUniqueViolation, type Db } from "../db.ts";
import { actorRole, type BoardActor } from "./access.ts";
import { guardRoomAudience } from "./audience.ts";
import { openBan } from "./store.ts";

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
    await db.query(
      `insert into member_report
       (id, room_id, subject_kind, subject_id, reporter_user_id, reason, note, source, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, input.roomId, input.subjectKind, input.subjectId, input.userId, input.reason, note, source, input.now],
    );
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
      reporterName: row.reporter_name,
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
