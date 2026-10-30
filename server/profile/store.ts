import type { Db } from "../db.ts";
import { actorRole } from "../board/access.ts";
import { statedGender, writeGenderAudit } from "../board/audience.ts";
import { openBan } from "../board/store.ts";
import { isEnglish } from "../../src/lib/board/text.ts";
import { genderWriteDecision, parseGender, type Gender } from "../gender-policy.ts";
import { birthdateError, parseBirthdate } from "./age.ts";
import { parseInterests, type InterestId } from "./interests.ts";
import { parseLinks, type ProfileLink } from "./links.ts";
import { ADMINS_ONLY_LATER, ANONYMOUS_LATER, adminsOnlyVisibilityEnabled } from "./permissions.ts";
import { parseLocation } from "./towns.ts";
import { OSM_REF_PATTERN } from "../places/lookup.ts";
import {
  PROFILE_FIELDS,
  parseVisibilityLevel,
  profileView,
  type ProfileField,
  type ProfileViewResult,
  type VisibilityLevel,
} from "./view.ts";

type Parsed = {
  displayName?: string;
  bio?: string;
  gender?: Gender;
  birthdate?: string;
  location?: { county: string; town: string };
  church?: string;
  /** Null clears a picked place, so the church reads as typed. */
  churchPlace?: { ref: string; address: string } | null;
  interests?: InterestId[];
  links?: ProfileLink[];
  visibility?: Partial<Record<ProfileField, VisibilityLevel>>;
};

type Refusal = { ok: false; status: number; error: string };

function refusal(status: number, error: string): Refusal {
  return { ok: false, status, error };
}

function shortText(
  value: unknown,
  noun: string,
  max: number,
  empty: "allow" | "refuse",
): { ok: true; text: string } | Refusal {
  if (typeof value !== "string") return refusal(400, `Enter a ${noun}.`);
  const text = value.trim();
  if (!text && empty === "refuse") return refusal(400, `Enter a ${noun}.`);
  if (text.length > max) return refusal(400, `That ${noun} is too long.`);
  if (text && !isEnglish(text)) return refusal(400, `Write the ${noun} in plain letters.`);
  if (text.includes("\n") || text.includes("\r")) {
    return refusal(400, `Write the ${noun} on one line.`);
  }
  return { ok: true, text };
}

/** True once 0048 has added members.church_osm_ref and members.church_address. */
export async function churchPlaceReady(db: Db): Promise<boolean> {
  const rows = await db.query<{ present: number }>(
    `select 1 as present from information_schema.columns
     where table_schema = current_schema() and table_name = 'members'
       and column_name in ('church_osm_ref', 'church_address')
     having count(*) = 2`,
  );
  return Boolean(rows[0]);
}

/** A picked OpenStreetMap place: { ref: "node/123", address }. Null clears it. */
export function parseChurchPlace(
  raw: unknown,
): { ok: true; value: { ref: string; address: string } | null } | Refusal {
  if (raw === null) return { ok: true, value: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return refusal(400, "Choose a place from the list, or type the church in.");
  }
  const { ref, address } = raw as Record<string, unknown>;
  if (typeof ref !== "string" || !OSM_REF_PATTERN.test(ref)) {
    return refusal(400, "Choose a place from the list, or type the church in.");
  }
  const line = typeof address === "string" ? address.replace(/\s+/g, " ").trim() : "";
  if (line.length > 200) return refusal(400, "That address is too long.");
  return { ok: true, value: { ref, address: line } };
}

export function parseProfilePatch(
  body: Record<string, unknown>,
): { ok: true; value: Parsed } | Refusal {
  if ("anonymous" in body || "profileAnonymous" in body) return refusal(400, ANONYMOUS_LATER);
  if ("photo" in body || "photoMediaId" in body) {
    return refusal(400, "Add a photo from the photo upload.");
  }
  if ("vouchedName" in body) {
    return refusal(400, "The vouched name stays on the account. Set a display name.");
  }
  if ("birthdate" in body && typeof body.birthdate !== "string") {
    return refusal(400, "Enter a real birthdate.");
  }
  const value: Parsed = {};
  if ("displayName" in body) {
    const parsed = shortText(body.displayName, "display name", 80, "refuse");
    if (!parsed.ok) return parsed;
    value.displayName = parsed.text;
  }
  if ("bio" in body) {
    if (typeof body.bio !== "string") return refusal(400, "Enter a bio.");
    const text = body.bio.trim();
    if (text.length > 600) return refusal(400, "That bio is too long.");
    if (text && !isEnglish(text)) return refusal(400, "Write a bio in plain letters.");
    value.bio = text;
  }
  if ("gender" in body) {
    const gender = parseGender(body.gender);
    if (!gender) return refusal(400, "Say whether you are a man or a woman.");
    value.gender = gender;
  }
  if (typeof body.birthdate === "string") {
    const birthdate = parseBirthdate(body.birthdate);
    if (!birthdate) return refusal(400, "Enter a real birthdate.");
    value.birthdate = birthdate;
  }
  if ("location" in body) {
    const location = parseLocation(body.location);
    if (!location.ok) return refusal(400, location.error);
    value.location = { county: location.county, town: location.town };
  }
  if ("church" in body) {
    const parsed = shortText(body.church, "church", 120, "allow");
    if (!parsed.ok) return parsed;
    value.church = parsed.text;
  }
  if ("churchPlace" in body) {
    const place = parseChurchPlace(body.churchPlace);
    if (!place.ok) return place;
    if (place.value && !value.church) return refusal(400, "Enter the church name with the place.");
    value.churchPlace = place.value;
  } else if ("church" in body) {
    // A new church name without a picked place is a typed entry.
    value.churchPlace = null;
  }
  if ("interests" in body) {
    const interests = parseInterests(body.interests);
    if (!interests.ok) return refusal(400, interests.error);
    value.interests = interests.ids;
  }
  if ("links" in body) {
    const links = parseLinks(body.links);
    if (!links.ok) return refusal(400, links.error);
    value.links = links.links;
  }
  if ("visibility" in body) {
    const raw = body.visibility;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return refusal(400, "Choose who can see each field.");
    }
    const visibility: Partial<Record<ProfileField, VisibilityLevel>> = {};
    for (const [key, level] of Object.entries(raw)) {
      if (!PROFILE_FIELDS.includes(key as ProfileField)) {
        return refusal(400, "Choose who can see each field.");
      }
      const parsed = parseVisibilityLevel(level);
      if (!parsed) return refusal(400, "Choose who can see each field.");
      if (parsed === "admins" && !adminsOnlyVisibilityEnabled())
        return refusal(400, ADMINS_ONLY_LATER);
      visibility[key as ProfileField] = parsed;
    }
    value.visibility = visibility;
  }
  return { ok: true, value };
}

async function ensureMember(db: Db, userId: string): Promise<boolean> {
  const inserted = await db.query<{ user_id: string }>(
    `insert into members (user_id, display_name)
     select id, left(coalesce(nullif(trim(name), ''), 'Member'), 80)
     from "user" where id = $1
     on conflict (user_id) do nothing
     returning user_id`,
    [userId],
  );
  if (inserted[0]) return true;
  const existing = await db.query<{ user_id: string }>(
    `select user_id from members where user_id = $1`,
    [userId],
  );
  return Boolean(existing[0]);
}

class Rollback extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The refusal for a direct edit of a stated gender. It points to the correction request. */
export const GENDER_LOCKED =
  "This is already set. To correct it, send a correction request. An admin reviews it.";

/** The refusal for a direct edit of a birthdate after onboarding. It points to the correction request. */
export const BIRTHDATE_LOCKED =
  "Your birthdate is already set. To correct it, send a correction request. An admin reviews it.";

async function applyGender(
  db: Db,
  userId: string,
  gender: Gender,
  now: Date,
): Promise<Refusal | { ok: true }> {
  const actor = await actorRole(db, userId);
  const current = await statedGender(db, userId);
  const invited = await db.query<{ invited_by_user_id: string | null }>(
    `select invited_by_user_id from invite_redemption where invited_user_id = $1`,
    [userId],
  );
  const inviterId = invited[0]?.invited_by_user_id ?? "";
  const decision = genderWriteDecision({
    current: current.stated,
    next: gender,
    actorIsSubject: true,
    actorIsInviter: false,
    actorHasNoInviter: invited.length === 0 || inviterId === "",
    actorIsSteward: actor.admin || actor.stewardRooms.length > 0,
    actorIsAdmin: actor.admin,
  });
  // A stated gender changes only through an admin-reviewed correction request.
  if (!decision.ok) return current.stated ? refusal(403, GENDER_LOCKED) : decision;
  if (decision.kind === "same") return { ok: true };
  if (decision.kind !== "set") return refusal(403, GENDER_LOCKED);
  const locked = await db.query<{ gender: string | null }>(
    `select gender from members where user_id = $1 for update`,
    [userId],
  );
  const held = parseGender(locked[0]?.gender);
  if (held) {
    if (held === gender) return { ok: true };
    return refusal(403, GENDER_LOCKED);
  }
  const updated = await db.query<{ user_id: string }>(
    `update members
     set gender = $2, gender_confirmed_by = null, gender_confirmed_at = null
     where user_id = $1 and gender is null
     returning user_id`,
    [userId, gender],
  );
  if (!updated[0]) return refusal(403, GENDER_LOCKED);
  await writeGenderAudit(db, {
    actorUserId: userId,
    subjectUserId: userId,
    action: "set-gender",
    detail: current.stated ? `${current.stated} -> ${gender}` : gender,
    now,
  });
  return { ok: true };
}

async function onboardBlock(db: Db, userId: string, now: Date): Promise<string | null> {
  const rows = await db.query<{
    display_name: string;
    gender: string | null;
    birthdate: string | null;
  }>(
    `select display_name, gender, to_char(birthdate, 'YYYY-MM-DD') as birthdate
     from members where user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row?.display_name.trim()) return "Enter a display name.";
  if (!parseGender(row.gender)) return "Say whether you are a man or a woman.";
  if (!row.birthdate) return "Enter your birthdate.";
  return birthdateError(row.birthdate.slice(0, 10), now);
}

/** Write the signed-in member's profile. Birthdate is stored and not returned. */
export async function saveProfile(
  db: Db,
  userId: string,
  body: Record<string, unknown>,
  now: Date,
  mode: "patch" | "onboard",
): Promise<ProfileViewResult> {
  const parsed = parseProfilePatch(body);
  if (!parsed.ok) return parsed;
  const actor = await actorRole(db, userId);
  if (!actor.member) return refusal(403, "Only a member can do that.");
  const ban = await openBan(db, userId, now);
  if (ban) return { ok: false, status: 403, error: "banned", ban };
  if (parsed.value.birthdate) {
    const ageError = birthdateError(parsed.value.birthdate, now);
    if (ageError) return refusal(400, ageError);
  }

  try {
    await db.transaction(async (tx) => {
      const exists = await ensureMember(tx, userId);
      if (!exists) throw new Rollback(404, "That person is not a member.");
      const next = parsed.value;
      if (next.displayName) {
        await tx.query(`update members set display_name = $2 where user_id = $1`, [
          userId,
          next.displayName,
        ]);
      }
      if (next.bio !== undefined) {
        await tx.query(`update members set bio = $2 where user_id = $1`, [userId, next.bio]);
      }
      if (next.birthdate) {
        const locked = await tx.query<{
          birthdate: string | null;
          onboarded_at: Date | string | null;
        }>(
          `select to_char(birthdate, 'YYYY-MM-DD') as birthdate, onboarded_at
           from members where user_id = $1 for update`,
          [userId],
        );
        const current = locked[0]?.birthdate?.slice(0, 10) ?? "";
        if (locked[0]?.onboarded_at && current && current !== next.birthdate) {
          throw new Rollback(403, BIRTHDATE_LOCKED);
        }
        if (!current || !locked[0]?.onboarded_at) {
          await tx.query(`update members set birthdate = $2::date where user_id = $1`, [
            userId,
            next.birthdate,
          ]);
        }
      }
      if (next.location) {
        await tx.query(
          `update members set location_county = $2, location_town = $3 where user_id = $1`,
          [userId, next.location.county, next.location.town],
        );
      }
      if (next.church !== undefined) {
        await tx.query(`update members set church = $2 where user_id = $1`, [userId, next.church]);
      }
      if (next.churchPlace !== undefined) {
        // The columns come from 0048. Until it is applied, the church name
        // still saves and the picked place is left out, so a profile save
        // never fails on a missing column. The answer then has no churchPlace,
        // and the browser keeps the pick on that device.
        if (await churchPlaceReady(tx)) {
          await tx.query(
            `update members set church_osm_ref = $2, church_address = $3 where user_id = $1`,
            [userId, next.churchPlace?.ref ?? null, next.churchPlace?.address ?? ""],
          );
        }
      }
      if (next.interests) {
        await tx.query(`update members set interests = $2::text[] where user_id = $1`, [
          userId,
          next.interests,
        ]);
      }
      if (next.links) {
        await tx.query(`delete from member_link where user_id = $1`, [userId]);
        for (let index = 0; index < next.links.length; index += 1) {
          const link = next.links[index];
          if (!link) continue;
          await tx.query(
            `insert into member_link (user_id, position, url, label) values ($1, $2, $3, $4)`,
            [userId, index + 1, link.url, link.label],
          );
        }
      }
      if (next.visibility) {
        for (const [field, level] of Object.entries(next.visibility)) {
          await tx.query(
            `insert into profile_visibility (user_id, field, level) values ($1, $2, $3)
             on conflict (user_id, field) do update set level = excluded.level`,
            [userId, field, level],
          );
        }
      }
      if (next.gender) {
        const written = await applyGender(tx, userId, next.gender, now);
        if (!written.ok) throw new Rollback(written.status, written.error);
      }
      if (mode === "onboard") {
        const block = await onboardBlock(tx, userId, now);
        if (block) throw new Rollback(400, block);
        await tx.query(
          `update members set onboarded_at = coalesce(onboarded_at, $2) where user_id = $1`,
          [userId, now],
        );
      }
    });
  } catch (error) {
    if (error instanceof Rollback) return refusal(error.status, error.message);
    throw error;
  }
  return profileView(db, { id: userId }, { id: userId }, now);
}

export async function churchSuggestions(db: Db): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    `select name from room
     where scope_kind = 'congregation' and trim(name) <> ''
     order by name`,
  );
  return rows.map((row) => row.name);
}
