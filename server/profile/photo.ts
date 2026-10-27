import { actorRole } from "../board/access.ts";
import { sendHoldAlert } from "../board/alert-mail.ts";
import {
  dropObjectKeys,
  sealProfilePhotoHold,
  type HoldAlert,
  type RelocatedFile,
} from "../board/csam.ts";
import { openBan, type OpenBan } from "../board/store.ts";
import type { Db } from "../db.ts";
import { OBJECT_ID } from "../../src/lib/media/limits.ts";
import type { ObjectStore } from "../media/s3.ts";
import { profileView, type ProfileBody, type ProfileFailure } from "./view.ts";

export type PhotoFailure = ProfileFailure;

type PhotoOk<T> = { ok: true; body: T };
export type PhotoResult<T> = PhotoOk<T> | PhotoFailure;

class Stop extends Error {
  status: number;
  ban?: OpenBan;
  constructor(status: number, message: string, ban?: OpenBan) {
    super(message);
    this.status = status;
    this.ban = ban;
  }
}

function fail(status: number, error: string, ban?: OpenBan): PhotoFailure {
  return ban ? { ok: false, status, error, ban } : { ok: false, status, error };
}

/** After the response is built. A hang in the mailer does not stall the removal. */
function scheduleHoldAlert(alert: HoldAlert): void {
  setImmediate(() => {
    void sendHoldAlert(alert);
  });
}

async function memberOrBan(db: Db, userId: string, now: Date): Promise<PhotoFailure | null> {
  const role = await actorRole(db, userId);
  if (!role.member) return fail(403, "Only a member can do that.");
  const ban = await openBan(db, userId, now);
  if (ban) return fail(403, "banned", ban);
  return null;
}

/**
 * The member takes their own photo down. The picture is tombstoned so the
 * media sweep deletes it. A held (csam) object is left alone.
 */
export async function clearOwnProfilePhoto(
  db: Db,
  userId: string,
  now: Date,
): Promise<PhotoResult<{ profile: ProfileBody }>> {
  await db.transaction(async (tx) => {
    const current = await tx.query<{ photo_media_id: string | null }>(
      `select photo_media_id from members where user_id = $1 for update`,
      [userId],
    );
    const previous = current[0]?.photo_media_id ?? "";
    if (!previous) return;
    await tx.query(
      `update media_object
       set deleted_at = $3
       where id = $1 and owner_user_id = $2 and scope = 'profile'
         and deleted_at is null and upload_key not like 'csam-held:%'`,
      [previous, userId, now],
    );
    await tx.query(`update members set photo_media_id = null where user_id = $1`, [userId]);
  });
  const viewed = await profileView(db, { id: userId }, { id: userId }, now);
  if (!viewed.ok) return viewed;
  return { ok: true, body: { profile: viewed.profile } };
}

/**
 * Point the profile at a ready profile-scoped picture.
 * The previous profile picture is tombstoned so the media sweep can delete it.
 * A picture that is still processing is left alone, and the current photo stays.
 */
export async function attachProfilePhoto(
  db: Db,
  userId: string,
  mediaId: unknown,
  now: Date,
): Promise<PhotoResult<{ profile: ProfileBody }>> {
  if (typeof mediaId !== "string" || !OBJECT_ID.test(mediaId)) {
    return fail(400, "Choose a picture.");
  }
  const blocked = await memberOrBan(db, userId, now);
  if (blocked) return blocked;
  try {
    await db.transaction(async (tx) => {
      const inserted = await tx.query<{ user_id: string }>(
        `insert into members (user_id, display_name)
         select id, left(coalesce(nullif(trim(name), ''), 'Member'), 80)
         from "user" where id = $1
         on conflict (user_id) do nothing
         returning user_id`,
        [userId],
      );
      if (!inserted[0]) {
        const existing = await tx.query<{ user_id: string }>(
          `select user_id from members where user_id = $1`,
          [userId],
        );
        if (!existing[0]) throw new Stop(404, "That person is not a member.");
      }
      await tx.query(`select user_id from members where user_id = $1 for update`, [userId]);
      const rows = await tx.query<{
        id: string;
        owner_user_id: string;
        scope: string;
        status: string;
        upload_key: string;
      }>(
        `select id, owner_user_id, scope, status, upload_key
         from media_object where id = $1 and deleted_at is null`,
        [mediaId],
      );
      const row = rows[0];
      if (!row || row.owner_user_id !== userId) throw new Stop(404, "That file is not here.");
      if (row.upload_key.startsWith("csam-held:")) throw new Stop(404, "That file is not here.");
      if (row.scope !== "profile") throw new Stop(400, "Choose a profile photo.");
      if (row.status !== "ready") throw new Stop(409, "That picture is not ready.");
      const current = await tx.query<{ photo_media_id: string | null }>(
        `select photo_media_id from members where user_id = $1`,
        [userId],
      );
      const previous = current[0]?.photo_media_id ?? "";
      if (previous && previous !== row.id) {
        await tx.query(
          `update media_object
           set deleted_at = $3
           where id = $1 and owner_user_id = $2 and scope = 'profile'
             and deleted_at is null and upload_key not like 'csam-held:%'`,
          [previous, userId, now],
        );
      }
      await tx.query(`update members set photo_media_id = $2 where user_id = $1`, [userId, row.id]);
    });
  } catch (error) {
    if (error instanceof Stop) return fail(error.status, error.message, error.ban);
    throw error;
  }
  const viewed = await profileView(db, { id: userId }, { id: userId }, now);
  if (!viewed.ok) return viewed;
  return { ok: true, body: { profile: viewed.profile } };
}

/**
 * An admin seals a profile photo the way a room picture is sealed.
 * A steward cannot do this. The only reason accepted here is csam.
 * The member row drops the pointer. The public bytes are deleted after commit.
 */
export async function removeProfilePhoto(
  db: Db,
  store: ObjectStore | null,
  adminId: string,
  subjectId: string,
  now: Date,
): Promise<PhotoResult<{ removed: true }>> {
  const actor = await actorRole(db, adminId);
  if (!actor.admin) return fail(403, "Only an admin can remove a profile photo.");
  const heldKeys: string[] = [];
  let publicKeys: string[] = [];
  let alert: HoldAlert | null = null;
  try {
    const relocated = await db.transaction(
      async (tx): Promise<{ files: RelocatedFile[]; alert: HoldAlert }> => {
        const locked = await tx.query<{ photo_media_id: string | null }>(
          `select photo_media_id from members where user_id = $1 for update`,
          [subjectId],
        );
        const mediaId = locked[0]?.photo_media_id ?? "";
        if (!mediaId) throw new Stop(404, "That person has no profile photo.");
        const sealed = await sealProfilePhotoHold(tx, store, mediaId, now, heldKeys);
        await tx.query(`update members set photo_media_id = null where user_id = $1`, [subjectId]);
        return sealed;
      },
    );
    heldKeys.length = 0;
    publicKeys = relocated.files.map((item) => item.from);
    alert = relocated.alert;
    await dropObjectKeys(store, publicKeys);
    scheduleHoldAlert(alert);
    return { ok: true, body: { removed: true } };
  } catch (error) {
    await dropObjectKeys(store, heldKeys);
    if (error instanceof Stop) return fail(error.status, error.message);
    if (error instanceof Error && error.message === "That picture is not here.") {
      return fail(404, error.message);
    }
    throw error;
  }
}
