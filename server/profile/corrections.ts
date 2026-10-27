import { randomUUID } from "node:crypto";
import { actorRole } from "../board/access.ts";
import { writeGenderAudit } from "../board/audience.ts";
import { openBanOrNone } from "../board/store.ts";
import type { Db } from "../db.ts";
import { parseGender } from "../gender-policy.ts";
import { isEnglish } from "../../src/lib/board/text.ts";
import { ageOn, birthdateError, parseBirthdate } from "./age.ts";

/**
 * After onboarding, gender and birthdate change only through a correction:
 * the member asks, with a reason, to fix an honest entry mistake, and a
 * different admin approves it. Nobody, admins included, edits their own.
 * Each request, approval, and refusal is a gender_audit row.
 * A requested birthdate is never returned, to the member or to an admin.
 * Responses show the age it would give instead ("age 34").
 */

export type CorrectionField = "gender" | "birthdate";

export type Correction = {
  id: string;
  userId: string;
  name: string;
  field: CorrectionField;
  requestedValue: string;
  reason: string;
  status: string;
  decidedNote: string;
  createdAt: string;
  decidedAt: string | null;
};

type Fail = { ok: false; status: number; error: string };

function no(status: number, error: string): Fail {
  return { ok: false, status, error };
}

function plain(value: unknown, max: number, empty: string): { ok: true; text: string } | Fail {
  if (typeof value !== "string") return no(400, empty);
  const text = value.trim();
  if (!text) return no(400, empty);
  if (text.length > max) return no(400, "That is too long.");
  if (!isEnglish(text) || /[\r\n]/.test(text)) return no(400, "Write it in plain letters.");
  return { ok: true, text };
}

function field(value: unknown): CorrectionField | null {
  return value === "gender" || value === "birthdate" ? value : null;
}

export async function requestCorrection(
  db: Db,
  userId: string,
  body: Record<string, unknown>,
  now: Date,
): Promise<{ ok: true; correction: Correction } | Fail> {
  const which = field(body.field);
  if (!which) return no(400, "Choose gender or birthdate.");
  const reason = plain(body.reason, 300, "Say what was entered by mistake.");
  if (!reason.ok) return reason;
  const rows = await db.query<{ gender: string | null; birthdate: string | null; onboarded_at: unknown }>(
    `select gender, to_char(birthdate, 'YYYY-MM-DD') as birthdate, onboarded_at
     from members where user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row?.onboarded_at) return no(409, "Finish your profile first. Until then you can edit it directly.");
  let value = "";
  if (which === "gender") {
    const next = parseGender(body.value);
    if (!next) return no(400, "Choose man or woman.");
    if (parseGender(row.gender) === next) return no(400, "That is already on your profile.");
    value = next;
  } else {
    const next = typeof body.value === "string" ? parseBirthdate(body.value) : null;
    if (!next) return no(400, "Enter a real birthdate.");
    const ageError = birthdateError(next, now);
    if (ageError) return no(400, ageError);
    if (row.birthdate?.slice(0, 10) === next) return no(400, "That is already on your profile.");
    value = next;
  }
  const id = randomUUID();
  const inserted = await db.query<{ id: string }>(
    `insert into profile_correction (id, user_id, field, requested_value, reason, created_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, field) where status = 'pending' do nothing
     returning id`,
    [id, userId, which, value, reason.text, now],
  );
  if (!inserted[0]) return no(409, "You already asked for this correction. An admin will look at it.");
  await writeGenderAudit(db, {
    actorUserId: userId,
    subjectUserId: userId,
    action: "correction-request",
    detail: `${which}. ${reason.text}`.slice(0, 400),
    now,
  });
  const mine = await listCorrections(db, userId, "own", now);
  const created = mine.ok ? mine.corrections.find((item) => item.id === id) : undefined;
  if (!created) return no(500, "The request was saved but could not be read back.");
  return { ok: true, correction: created };
}

async function deciderFailure(db: Db, actorId: string, now: Date): Promise<Fail | null> {
  const actor = await actorRole(db, actorId);
  if (!actor.admin) return no(403, "An admin decides corrections.");
  if (await openBanOrNone(db, actorId, now)) return no(403, "A barred account cannot decide corrections.");
  return null;
}

export async function listCorrections(
  db: Db,
  actorId: string,
  scope: "own" | "queue",
  now = new Date(),
): Promise<{ ok: true; corrections: Correction[] } | Fail> {
  if (scope === "queue") {
    const refused = await deciderFailure(db, actorId, now);
    if (refused) return refused;
  }
  const rows = await db.query<{
    id: string;
    user_id: string;
    name: string;
    field: CorrectionField;
    requested_value: string;
    reason: string;
    status: string;
    decided_note: string;
    created_at: Date | string;
    decided_at: Date | string | null;
  }>(
    scope === "own"
      ? `select c.*, coalesce(m.display_name, u.name) as name
         from profile_correction c join "user" u on u.id = c.user_id
         left join members m on m.user_id = c.user_id
         where c.user_id = $1 order by c.created_at desc limit 20`
      : `select c.*, coalesce(m.display_name, u.name) as name
         from profile_correction c join "user" u on u.id = c.user_id
         left join members m on m.user_id = c.user_id
         where c.status = 'pending' and c.user_id <> $1 order by c.created_at asc limit 100`,
    [actorId],
  );
  return {
    ok: true,
    corrections: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      field: row.field,
      requestedValue:
        row.field === "birthdate" ? `age ${ageOn(row.requested_value, now)}` : row.requested_value,
      reason: row.reason,
      status: row.status,
      decidedNote: row.decided_note,
      createdAt: new Date(row.created_at).toISOString(),
      decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    })),
  };
}

class Stop extends Error {
  readonly failure: Fail;
  constructor(failure: Fail) {
    super(failure.error);
    this.failure = failure;
  }
}

export async function decideCorrection(
  db: Db,
  actorId: string,
  correctionId: string,
  body: Record<string, unknown>,
  now: Date,
): Promise<{ ok: true; status: "approved" | "refused" } | Fail> {
  const decision = body.decision === "approve" ? "approved" : body.decision === "refuse" ? "refused" : null;
  if (!decision) return no(400, "Approve or refuse.");
  let note = "";
  if (body.note !== undefined && body.note !== "") {
    const parsed = plain(body.note, 300, "Add a note.");
    if (!parsed.ok) return parsed;
    note = parsed.text;
  }
  if (decision === "refused" && !note) return no(400, "Say why this is refused.");
  const refused = await deciderFailure(db, actorId, now);
  if (refused) return refused;
  try {
    await db.transaction(async (tx) => {
      const rows = await tx.query<{ user_id: string; field: CorrectionField; requested_value: string; status: string }>(
        `select user_id, field, requested_value, status from profile_correction where id = $1 for update`,
        [correctionId],
      );
      const item = rows[0];
      if (!item || item.status !== "pending") throw new Stop(no(404, "That request is not waiting."));
      if (item.user_id === actorId) throw new Stop(no(403, "A different admin has to decide your own request."));
      if (decision === "approved") {
        const current = await tx.query<{ gender: string | null; birthdate: string | null }>(
          `select gender, to_char(birthdate, 'YYYY-MM-DD') as birthdate
           from members where user_id = $1 for update`,
          [item.user_id],
        );
        if (!current[0]) throw new Stop(no(404, "That person is not a member."));
        if (item.field === "gender") {
          await tx.query(
            `update members set gender = $2, gender_confirmed_by = null, gender_confirmed_at = null
             where user_id = $1`,
            [item.user_id, item.requested_value],
          );
          await writeGenderAudit(tx, {
            actorUserId: actorId,
            subjectUserId: item.user_id,
            action: "change-gender",
            detail: `Correction ${correctionId}. ${current[0].gender ?? "none"} -> ${item.requested_value}. ${note}`.trim(),
            now,
          });
        } else {
          await tx.query(`update members set birthdate = $2::date where user_id = $1`, [
            item.user_id,
            item.requested_value,
          ]);
          await writeGenderAudit(tx, {
            actorUserId: actorId,
            subjectUserId: item.user_id,
            action: current[0].birthdate ? "change-birthdate" : "set-birthdate",
            detail: `Correction ${correctionId}. ${current[0].birthdate ?? "none"} -> ${item.requested_value}. ${note}`.trim(),
            now,
          });
        }
      } else {
        await writeGenderAudit(tx, {
          actorUserId: actorId,
          subjectUserId: item.user_id,
          action: "correction-refuse",
          detail: `Correction ${correctionId} (${item.field}). ${note}`,
          now,
        });
      }
      await tx.query(
        `update profile_correction
         set status = $2, decided_by = $3, decided_note = $4, decided_at = $5
         where id = $1`,
        [correctionId, decision, actorId, note, now],
      );
    });
  } catch (error) {
    if (error instanceof Stop) return error.failure;
    throw error;
  }
  return { ok: true, status: decision };
}
