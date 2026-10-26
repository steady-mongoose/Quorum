import { actorRole } from "../board/access.ts";
import { writeGenderAudit } from "../board/audience.ts";
import type { Db } from "../db.ts";
import { isEnglish } from "../../src/lib/board/text.ts";
import { birthdateError, parseBirthdate } from "./age.ts";
import { profileView, type ProfileViewResult } from "./view.ts";

/**
 * An admin sets or changes someone else's birthdate after it is stored.
 * The member cannot do this, including an admin changing their own.
 * The reason is written to gender_audit and cleared when the account is deleted.
 * The date is not returned.
 */
export async function setMemberBirthdate(
  db: Db,
  actorId: string,
  subjectId: string,
  birthdate: unknown,
  reason: unknown,
  now: Date,
): Promise<ProfileViewResult> {
  if (actorId === subjectId)
    return { ok: false, status: 403, error: "You cannot change this yourself." };
  const actor = await actorRole(db, actorId);
  if (!actor.admin)
    return { ok: false, status: 403, error: "Only an admin can change a birthdate." };
  const parsed = typeof birthdate === "string" ? parseBirthdate(birthdate) : null;
  if (!parsed) return { ok: false, status: 400, error: "Enter a real birthdate." };
  const ageError = birthdateError(parsed, now);
  if (ageError) return { ok: false, status: 400, error: ageError };
  if (typeof reason !== "string")
    return { ok: false, status: 400, error: "Say why this birthdate changes." };
  const why = reason.trim();
  if (!why) return { ok: false, status: 400, error: "Say why this birthdate changes." };
  if (why.length > 200) return { ok: false, status: 400, error: "That reason is too long." };
  if (!isEnglish(why) || why.includes("\n") || why.includes("\r")) {
    return { ok: false, status: 400, error: "Write the reason in plain letters." };
  }

  const subject = await actorRole(db, subjectId);
  if (!subject.member) return { ok: false, status: 404, error: "That person is not a member." };

  try {
    await db.transaction(async (tx) => {
      const locked = await tx.query<{ birthdate: string | null }>(
        `select to_char(birthdate, 'YYYY-MM-DD') as birthdate
         from members where user_id = $1 for update`,
        [subjectId],
      );
      if (!locked[0]) throw new MissingMember();
      const current = locked[0].birthdate?.slice(0, 10) ?? "";
      if (current === parsed) return;
      await tx.query(`update members set birthdate = $2::date where user_id = $1`, [
        subjectId,
        parsed,
      ]);
      await writeGenderAudit(tx, {
        actorUserId: actorId,
        subjectUserId: subjectId,
        action: current ? "change-birthdate" : "set-birthdate",
        detail: current ? `${current} -> ${parsed}. ${why}` : `${parsed}. ${why}`,
        now,
      });
    });
  } catch (error) {
    if (error instanceof MissingMember) {
      return { ok: false, status: 404, error: "That person is not a member." };
    }
    throw error;
  }
  return profileView(db, { id: actorId }, { id: subjectId }, now);
}

class MissingMember extends Error {}
