import type { Db } from "../db.ts";
import { actorRole } from "../board/access.ts";
import { statedGender } from "../board/audience.ts";
import { openBan, type OpenBan } from "../board/store.ts";
import { audienceDecision, parseAudience, parseGender, type Gender } from "../gender-policy.ts";
import { ageOn } from "./age.ts";
import { interestLabel } from "./interests.ts";
import type { ProfileLink } from "./links.ts";
import { profileAnonymousEnabled } from "./permissions.ts";
import { storedLocation, type StoredLocation } from "./towns.ts";

/**
 * Who can see one profile field.
 * `members` is every member. `shared` is a room or theme group you both
 * belong to (not a direct message), skipping a ban and an audience the
 * viewer does not meet. `private` is the subject only. `admins` is an admin
 * or the subject. Permissions 0025 turns on the write path for `admins`.
 */
export const PROFILE_FIELDS = [
  "photo",
  "bio",
  "gender",
  "age",
  "location",
  "church",
  "interests",
  "links",
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type VisibilityLevel = "members" | "shared" | "private" | "admins";

/**
 * Columns a stats export may copy from `members`. Birthdate is stored and is
 * not in this list. Age is computed in `profileView` and is not a column.
 */
export const PROFILE_EXPORT_COLUMNS = [
  "user_id",
  "display_name",
  "bio",
  "location_town",
  "location_county",
  "church",
  "interests",
  "onboarded_at",
] as const;

export type ProfilePhoto = { id: string; status: string };

export type ProfileBody = {
  userId: string;
  self: boolean;
  displayName: string;
  vouchedName?: string;
  bio?: string;
  gender?: Gender | null;
  age?: number | null;
  birthdateSet?: boolean;
  location?: StoredLocation | null;
  church?: string;
  /** Present when the church was picked from OpenStreetMap. */
  churchPlace?: { ref: string; address: string; verified: true };
  interests?: { id: string; label: string }[];
  links?: ProfileLink[];
  photo?: ProfilePhoto | null;
  onboarded?: boolean;
  visibility?: Record<ProfileField, VisibilityLevel>;
  missing?: string[];
};

export type ProfileFailure = {
  ok: false;
  status: number;
  error: string;
  ban?: OpenBan;
};

export type ProfileViewResult = { ok: true; profile: ProfileBody } | ProfileFailure;

type SubjectRow = {
  user_id: string;
  vouched_name: string;
  display_name: string | null;
  bio: string | null;
  gender: string | null;
  birthdate: string | null;
  location_town: string | null;
  location_county: string | null;
  church: string | null;
  church_osm_ref: string | null;
  church_address: string | null;
  interests: string[] | null;
  onboarded_at: Date | string | null;
  profile_anonymous: boolean | null;
  photo_id: string | null;
  photo_status: string | null;
  photo_deleted: Date | string | null;
};

// to_jsonb reads the 0048 columns without failing on a database that does not have them yet.
function churchPlaceOf(row: SubjectRow): { ref: string; address: string; verified: true } {
  return { ref: row.church_osm_ref ?? "", address: row.church_address ?? "", verified: true };
}

const LEVELS = new Set<VisibilityLevel>(["members", "shared", "private", "admins"]);

export function parseVisibilityLevel(value: unknown): VisibilityLevel | null {
  return typeof value === "string" && LEVELS.has(value as VisibilityLevel)
    ? (value as VisibilityLevel)
    : null;
}

export function fieldVisible(input: {
  level: VisibilityLevel;
  self: boolean;
  viewerIsAdmin: boolean;
  sharesRoom: boolean;
}): boolean {
  if (input.self) return true;
  if (input.level === "private") return false;
  if (input.level === "admins") return input.viewerIsAdmin;
  if (input.level === "shared") return input.sharesRoom;
  return true;
}

function levelOf(map: Map<string, string>, field: ProfileField): VisibilityLevel {
  return parseVisibilityLevel(map.get(field)) ?? "members";
}

/**
 * A shared room or theme group counts only when the viewer is not barred
 * from it and the audience lets the viewer in. A direct message never counts.
 * A steward override does not open a room the viewer's gender does not match.
 */
async function sharesRoom(
  db: Db,
  viewerId: string,
  subjectId: string,
  now: Date,
): Promise<boolean> {
  const gender = await statedGender(db, viewerId);
  const rooms = await db.query<{ id: string; audience: string }>(
    `select r.id, r.audience
     from room_member viewer
     join room_member subject on subject.room_id = viewer.room_id and subject.user_id = $2
     join room r on r.id = viewer.room_id
     where viewer.user_id = $1`,
    [viewerId, subjectId],
  );
  for (const room of rooms) {
    if (await openBan(db, viewerId, now, room.id)) continue;
    if (await openBan(db, subjectId, now, room.id)) continue;
    const audience = parseAudience(room.audience) ?? "all";
    const decision = audienceDecision({
      audience,
      stated: gender.stated,
      confirmed: gender.confirmed,
      canModerate: false,
    });
    if (decision.allow) return true;
  }
  const groups = await db.query<{ id: string; audience: string; source_room_id: string }>(
    `select g.id, g.audience, g.source_room_id
     from theme_group_member viewer
     join theme_group_member subject
       on subject.group_id = viewer.group_id and subject.user_id = $2
     join theme_group g on g.id = viewer.group_id
     where viewer.user_id = $1`,
    [viewerId, subjectId],
  );
  for (const group of groups) {
    const source = group.source_room_id.trim();
    if (source && (await openBan(db, viewerId, now, source))) continue;
    if (source && (await openBan(db, subjectId, now, source))) continue;
    const audience = parseAudience(group.audience) ?? "all";
    const decision = audienceDecision({
      audience,
      stated: gender.stated,
      confirmed: gender.confirmed,
      canModerate: false,
    });
    if (decision.allow) return true;
  }
  return false;
}

function interestsOf(ids: string[] | null): { id: string; label: string }[] {
  return (ids ?? []).map((id) => ({ id, label: interestLabel(id) }));
}

function photoOf(row: SubjectRow): ProfilePhoto | null {
  if (!row.photo_id || row.photo_deleted) return null;
  return { id: row.photo_id, status: row.photo_status || "pending" };
}

/**
 * The profile `viewer` is allowed to see of `subject`.
 * Display name is always included. Birthdate is never included; `age` is the
 * computed year count when that field is visible. The vouched name (the
 * account name) is included for the subject and for an admin.
 */
export async function profileView(
  db: Db,
  viewer: { id: string },
  subject: { id: string },
  now: Date,
): Promise<ProfileViewResult> {
  const viewerRole = await actorRole(db, viewer.id);
  if (!viewerRole.member) return { ok: false, status: 403, error: "Only a member can do that." };
  const self = viewer.id === subject.id;
  if (!self) {
    const ban = await openBan(db, viewer.id, now);
    if (ban) return { ok: false, status: 403, error: "banned", ban };
    const subjectRole = await actorRole(db, subject.id);
    if (!subjectRole.member)
      return { ok: false, status: 404, error: "That person is not a member." };
  }

  const rows = await db.query<SubjectRow>(
    `select u.id as user_id,
            u.name as vouched_name,
            m.display_name,
            m.bio,
            m.gender,
            to_char(m.birthdate, 'YYYY-MM-DD') as birthdate,
            m.location_town,
            m.location_county,
            m.church,
            to_jsonb(m) ->> 'church_osm_ref' as church_osm_ref,
            to_jsonb(m) ->> 'church_address' as church_address,
            m.interests,
            m.onboarded_at,
            m.profile_anonymous,
            m.photo_media_id as photo_id,
            o.status as photo_status,
            o.deleted_at as photo_deleted
     from "user" u
     left join members m on m.user_id = u.id
     left join media_object o on o.id = m.photo_media_id
     where u.id = $1`,
    [subject.id],
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 404, error: "That person is not a member." };

  const visibilityRows = await db.query<{ field: string; level: string }>(
    `select field, level from profile_visibility where user_id = $1`,
    [subject.id],
  );
  const levels = new Map(visibilityRows.map((item) => [item.field, item.level]));
  const linkRows = await db.query<{ url: string; label: string }>(
    `select url, label from member_link where user_id = $1 order by position`,
    [subject.id],
  );

  const needsShared = !self && PROFILE_FIELDS.some((field) => levelOf(levels, field) === "shared");
  const shared = needsShared ? await sharesRoom(db, viewer.id, subject.id, now) : false;
  const show = (field: ProfileField) =>
    fieldVisible({
      level: levelOf(levels, field),
      self,
      viewerIsAdmin: viewerRole.admin,
      sharesRoom: shared,
    });

  const displayName = (row.display_name ?? row.vouched_name).trim() || "Member";
  const gender = parseGender(row.gender);
  const birthdate = row.birthdate && row.birthdate.length >= 10 ? row.birthdate.slice(0, 10) : null;
  const age = birthdate ? ageOn(birthdate, now) : null;
  const location = storedLocation(row.location_county ?? "", row.location_town ?? "");
  const photo = photoOf(row);
  const readyPhoto = photo && photo.status === "ready" ? photo : null;

  // Permissions 0025. Until then the flag does not change what a viewer sees.
  const anonymous =
    Boolean(row.profile_anonymous) && profileAnonymousEnabled() && !self && !viewerRole.admin;

  const profile: ProfileBody = {
    userId: row.user_id,
    self,
    displayName: anonymous ? "Member" : displayName,
  };
  if (self || viewerRole.admin) profile.vouchedName = row.vouched_name;

  if (self) {
    profile.bio = row.bio ?? "";
    profile.gender = gender;
    profile.age = age !== null && age >= 0 ? age : null;
    profile.birthdateSet = Boolean(birthdate);
    profile.location = location;
    profile.church = row.church ?? "";
    if (row.church && row.church_osm_ref) profile.churchPlace = churchPlaceOf(row);
    profile.interests = interestsOf(row.interests);
    profile.links = linkRows;
    profile.photo = photo;
    profile.onboarded = Boolean(row.onboarded_at);
    profile.visibility = Object.fromEntries(
      PROFILE_FIELDS.map((field) => [field, levelOf(levels, field)]),
    ) as Record<ProfileField, VisibilityLevel>;
    profile.missing = [
      ...(displayName ? [] : ["displayName"]),
      ...(gender ? [] : ["gender"]),
      ...(birthdate ? [] : ["birthdate"]),
    ];
    return { ok: true, profile };
  }

  if (anonymous) return { ok: true, profile };
  if (show("bio") && row.bio) profile.bio = row.bio;
  if (show("gender") && gender) profile.gender = gender;
  if (show("age") && age !== null && age >= 0) profile.age = age;
  if (show("location") && location) profile.location = location;
  if (show("church") && row.church) {
    profile.church = row.church;
    if (row.church_osm_ref) profile.churchPlace = churchPlaceOf(row);
  }
  if (show("interests") && (row.interests?.length ?? 0) > 0)
    profile.interests = interestsOf(row.interests);
  if (show("links") && linkRows.length > 0) profile.links = linkRows;
  if (show("photo") && readyPhoto) profile.photo = readyPhoto;
  return { ok: true, profile };
}
