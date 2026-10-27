import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import type { ObjectStore } from "../media/s3.ts";
import { actorRole } from "./access.ts";
import { denyHold, isCustodian, logHoldAccess } from "./csam-custody.ts";
import { postIsHeld } from "./csam.ts";
import { removePost } from "./store.ts";

/**
 * No person views CSAM in the app. A member report or a scanner flag is enough on its
 * own to stop every copy being served and to let a custodian preserve and remove the
 * post without opening it. There is no reveal, preview, thumbnail or blurred view.
 */

type Fail = { ok: false; status: number; error: string };

export type CsamFlag = {
  id: string;
  postId: string;
  mediaId: string;
  source: "report" | "scanner";
  reporter: string;
  reason: string;
  uploader: string;
  fileIds: string[];
  at: number;
};

const ID = /^[A-Za-z0-9_-]{1,80}$/;

function atMs(value: Date | string | number): number {
  return typeof value === "number" ? value : new Date(value).getTime();
}

/** True when the media route must refuse this file. Nobody is exempt. */
export async function mediaIsBlocked(
  db: Db,
  file: { id: string; post_id?: string | null },
): Promise<boolean> {
  const postId = file.post_id ?? "";
  if (postId && (await postIsHeld(db, postId))) return true;
  const rows = await db.query<{ id: string }>(
    `select id from csam_flag
     where resolved_at is null and (media_id = $1 or ($2 <> '' and post_id = $2))
     limit 1`,
    [file.id, postId],
  );
  return rows.length > 0;
}

/** Any signed-in member may flag. The flag blocks the files at once. */
export async function flagCsam(
  db: Db,
  input: {
    userId: string;
    name: string;
    postId?: string;
    mediaId?: string;
    reason?: string;
    source?: "report" | "scanner";
    now: Date;
  },
): Promise<{ ok: true; value: { id: string } } | Fail> {
  const postId = (input.postId ?? "").trim();
  const mediaId = (input.mediaId ?? "").trim();
  if ((postId && !ID.test(postId)) || (mediaId && !ID.test(mediaId)) || (!postId && !mediaId)) {
    return { ok: false, status: 400, error: "Say which post or file this is." };
  }
  let post = postId;
  if (!post && mediaId) {
    const rows = await db.query<{ post_id: string | null }>(
      `select post_id from media_object where id = $1`,
      [mediaId],
    );
    if (!rows[0]) return { ok: false, status: 404, error: "That file is not here." };
    post = rows[0].post_id ?? "";
  } else {
    const rows = await db.query<{ id: string }>(
      `select id from board_post where id = $1 union all select id from room_post where id = $1`,
      [post],
    );
    if (!rows[0]) return { ok: false, status: 404, error: "That post is not here." };
  }
  const id = randomUUID();
  await db.query(
    `insert into csam_flag (id, post_id, media_id, source, reporter_user_id, reporter_name, reason, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      post,
      mediaId,
      input.source ?? "report",
      input.userId || null,
      input.name.trim().slice(0, 120),
      (input.reason ?? "").trim().slice(0, 500),
      input.now,
    ],
  );
  await logHoldAccess(db, { actorUserId: input.userId, action: "flag", detail: id, now: input.now });
  return { ok: true, value: { id } };
}

/** Metadata only, and only for custodians. */
export async function listCsamFlags(db: Db): Promise<CsamFlag[]> {
  const rows = await db.query<{
    id: string;
    post_id: string;
    media_id: string;
    source: string;
    reporter_name: string;
    reason: string;
    created_at: Date | string;
    author_name: string | null;
    file_ids: unknown;
  }>(
    `select f.id, f.post_id, f.media_id, f.source, f.reporter_name, f.reason, f.created_at,
            p.author_name,
            coalesce((select array_agg(m.id order by m.id) from media_object m
                      where m.post_id = f.post_id and f.post_id <> ''), '{}') as file_ids
     from csam_flag f
     left join board_post p on p.id = f.post_id
     where f.resolved_at is null
     order by f.created_at desc
     limit 200`,
  );
  return rows.map((row) => {
    const files = Array.isArray(row.file_ids)
      ? (row.file_ids as string[])
      : String(row.file_ids ?? "{}").slice(1, -1).split(",").filter(Boolean);
    return {
      id: row.id,
      postId: row.post_id,
      mediaId: row.media_id,
      source: row.source === "scanner" ? "scanner" : "report",
      reporter: row.reporter_name,
      reason: row.reason,
      uploader: row.author_name ?? "",
      fileIds: row.media_id && !files.includes(row.media_id) ? [row.media_id, ...files] : files,
      at: atMs(row.created_at),
    };
  });
}

/**
 * A custodian preserves and removes the flagged post without opening it. The post is
 * sealed into a hold under the CSAM rule, and the flag is closed against that hold.
 */
export async function removeFlagged(
  db: Db,
  input: { userId: string; name: string; flagId: string; now: Date; store?: ObjectStore | null },
): Promise<{ ok: true; value: { holdId: string } } | Fail> {
  const actor = await actorRole(db, input.userId);
  if (!actor.admin || !(await isCustodian(db, input.userId, actor))) {
    return denyHold(db, input.userId, "", `remove flagged ${input.flagId}`.slice(0, 120), input.now);
  }
  const rows = await db.query<{ post_id: string; reporter_name: string; reason: string }>(
    `select post_id, reporter_name, reason from csam_flag where id = $1 and resolved_at is null`,
    [input.flagId],
  );
  const flag = rows[0];
  if (!flag) return { ok: false, status: 404, error: "That flag is not here." };
  if (!flag.post_id) return { ok: false, status: 400, error: "That file is not part of a post." };
  if (!(await postIsHeld(db, flag.post_id))) {
    const removed = await removePost(db, {
      userId: input.userId,
      name: input.name,
      postId: flag.post_id,
      reason: "csam",
      now: input.now,
      store: input.store ?? null,
    });
    if (!removed.ok) return removed;
  }
  const holds = await db.query<{ id: string }>(
    `select id from board_csam_hold where purged_at is null and (post_id = $1 or $1 = any(post_ids))
     order by created_at desc limit 1`,
    [flag.post_id],
  );
  const holdId = holds[0]?.id ?? "";
  if (holdId) {
    await db.query(
      `update board_csam_hold set reporter_name = $2, report_reason = $3
       where id = $1 and reporter_name = ''`,
      [holdId, flag.reporter_name, flag.reason],
    );
  }
  await db.query(
    `update csam_flag set resolved_at = $2, hold_id = $3
     where resolved_at is null and post_id = $1`,
    [flag.post_id, input.now, holdId],
  );
  await logHoldAccess(db, {
    holdId,
    actorUserId: input.userId,
    action: "remove_flagged",
    detail: input.flagId,
    now: input.now,
  });
  return { ok: true, value: { holdId } };
}
