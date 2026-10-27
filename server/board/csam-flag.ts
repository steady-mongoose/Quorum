import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import type { ObjectStore } from "../media/s3.ts";
import { actorRole } from "./access.ts";
import { denyHold, isCustodian, logHoldAccess } from "./csam-custody.ts";
import { chatLineIsHeld, postIsHeld, sealCsamChatHold } from "./csam.ts";
import { autoCloseReports } from "./report-close.ts";
import { memberCanSeeBoardPost, removePost, scheduleHoldAlert, writeBan } from "./store.ts";
import { evictCallMember } from "../calls/evict.ts";
import { memberOfRoom } from "../media/access.ts";
import { consumeLimit } from "../rate-limit.ts";

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
  /** A flagged chat line, by id, room and time. Never its text. */
  chatMessageId: string;
  chatRoomId: string;
  chatAt: number | null;
};

/** Per member. A flag blocks files at once, so it is limited like any other write. */
export const CSAM_FLAG_LIMIT = { max: 10, windowMs: 60 * 60 * 1000 };

/** The same answer whether or not the post exists or the member can see it. */
export const FLAG_RECEIVED = "Thank you. A custodian will look at the details. Nobody opens the files.";

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

async function memberCanSeeMedia(db: Db, userId: string, mediaId: string, now: Date): Promise<string | null> {
  const rows = await db.query<{
    scope: string;
    room_id: string;
    post_id: string;
    owner_user_id: string | null;
    peer_user_id: string | null;
    deleted_at: Date | null;
  }>(
    `select scope, room_id, post_id, owner_user_id, peer_user_id, deleted_at from media_object where id = $1`,
    [mediaId],
  );
  const row = rows[0];
  if (!row || row.deleted_at) return null;
  if (row.scope === "dm") {
    return row.owner_user_id === userId || row.peer_user_id === userId ? row.post_id ?? "" : null;
  }
  if (!(await memberOfRoom(db, userId, row.room_id, now)).ok) return null;
  if (row.post_id) {
    const board = await db.query<{ id: string }>(`select id from board_post where id = $1`, [row.post_id]);
    if (board[0] && !(await memberCanSeeBoardPost(db, userId, row.post_id, now))) return null;
  }
  return row.post_id ?? "";
}

async function memberCanSeePost(db: Db, userId: string, postId: string, now: Date): Promise<boolean> {
  if (await memberCanSeeBoardPost(db, userId, postId, now)) return true;
  const rows = await db.query<{ room_id: string }>(`select room_id from room_post where id = $1`, [postId]);
  if (!rows[0]) return false;
  return (await memberOfRoom(db, userId, rows[0].room_id, now)).ok;
}

/**
 * The member-facing flag. The member must be able to see the post or file, by the same
 * checks as viewing it, and is rate-limited. The answer is the same whether or not the
 * post exists or is visible, so the route cannot be used to probe for posts. A flag is
 * written only for something the member can see.
 */
export async function memberFlagCsam(
  db: Db,
  input: { userId: string; name: string; postId?: string; mediaId?: string; reason?: string; now: Date },
): Promise<{ ok: true; value: { message: string } } | Fail> {
  const postId = (input.postId ?? "").trim();
  const mediaId = (input.mediaId ?? "").trim();
  if ((postId && !ID.test(postId)) || (mediaId && !ID.test(mediaId)) || (!postId && !mediaId)) {
    return { ok: false, status: 400, error: "Say which post or file this is." };
  }
  const hit = await consumeLimit(db, `csam-flag:user:${input.userId}`, CSAM_FLAG_LIMIT, input.now.getTime());
  if (!hit.allowed) return { ok: false, status: 429, error: "Too many reports. Try again later." };
  let visible = false;
  let flagPost = postId;
  if (mediaId) {
    const seen = await memberCanSeeMedia(db, input.userId, mediaId, input.now);
    visible = seen !== null && (!postId || seen === postId);
    if (seen !== null && !postId) flagPost = seen;
  } else {
    visible = await memberCanSeePost(db, input.userId, postId, input.now);
  }
  if (visible) {
    await flagCsam(db, {
      userId: input.userId,
      name: input.name,
      postId: flagPost || undefined,
      mediaId: mediaId || undefined,
      reason: input.reason,
      now: input.now,
    });
  } else {
    await logHoldAccess(db, { actorUserId: input.userId, action: "denied", detail: "flag not visible", now: input.now });
  }
  return { ok: true, value: { message: FLAG_RECEIVED } };
}

/** Metadata only, and only for custodians. */
/**
 * There is no release of a flag. Every match is preserved and reported to NCMEC.
 * A hold ends only with a recorded lawyer sign-off (releaseHold in csam-custody.ts).
 */
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
    chat_message_id: string;
    chat_room_id: string | null;
    chat_created_at: Date | string | null;
  }>(
    `select f.id, f.post_id, f.media_id, f.source, f.reporter_name, f.reason, f.created_at,
            p.author_name, f.chat_message_id,
            c.room_id as chat_room_id, c.created_at as chat_created_at,
            coalesce((select array_agg(m.id order by m.id) from media_object m
                      where m.post_id = f.post_id and f.post_id <> ''), '{}') as file_ids
     from csam_flag f
     left join board_post p on p.id = f.post_id
     left join room_chat_message c on c.id = f.chat_message_id and f.chat_message_id <> ''
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
      // A chat flag shows metadata only (id, room, time), never who sent it.
      uploader: row.chat_message_id ? "" : (row.author_name ?? ""),
      fileIds: row.media_id && !files.includes(row.media_id) ? [row.media_id, ...files] : files,
      at: atMs(row.created_at),
      chatMessageId: row.chat_message_id ?? "",
      chatRoomId: row.chat_room_id ?? "",
      chatAt: row.chat_created_at ? atMs(row.chat_created_at) : null,
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
  if (!actor.admin || !(await isCustodian(db, input.userId, actor, input.now))) {
    return denyHold(db, input.userId, "", `remove flagged ${input.flagId}`.slice(0, 120), input.now);
  }
  const rows = await db.query<{ post_id: string; reporter_name: string; reason: string; chat_message_id: string }>(
    `select post_id, reporter_name, reason, chat_message_id from csam_flag where id = $1 and resolved_at is null`,
    [input.flagId],
  );
  const flag = rows[0];
  if (!flag) return { ok: false, status: 404, error: "That flag is not here." };
  if (flag.chat_message_id) return removeFlaggedChat(db, input, flag.chat_message_id, flag);
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
    `update csam_flag set resolved_at = $2, hold_id = $3, resolution = 'removed'
     where resolved_at is null and post_id = $1`,
    [flag.post_id, input.now, holdId],
  );
  await autoCloseReports(db, { subjectKind: "post", subjectIds: [flag.post_id], actorUserId: input.userId, now: input.now });
  await logHoldAccess(db, {
    holdId,
    actorUserId: input.userId,
    action: "remove_flagged",
    detail: input.flagId,
    now: input.now,
  });
  return { ok: true, value: { holdId } };
}

/**
 * Preserve and remove for a flagged chat line: hide it, seal its text into a hold
 * unread, record a CSAM removal (an admin's, so a permanent site-wide ban), and
 * close the flag and its reports. Nobody reads the line.
 */
async function removeFlaggedChat(
  db: Db,
  input: { userId: string; name: string; flagId: string; now: Date },
  messageId: string,
  flag: { reporter_name: string; reason: string },
): Promise<{ ok: true; value: { holdId: string } } | Fail> {
  const lines = await db.query<{ room_id: string; author_user_id: string | null; author_name: string }>(
    `select room_id, author_user_id, author_name from room_chat_message where id = $1`,
    [messageId],
  );
  const line = lines[0];
  if (!line) return { ok: false, status: 404, error: "That chat line is not here." };
  const by = input.name.trim().slice(0, 80) || "Custodian";
  const done = await db.transaction(async (tx) => {
    let holdId = "";
    let alert = null;
    if (!(await chatLineIsHeld(tx, messageId))) {
      const sealed = await sealCsamChatHold(tx, messageId, input.now);
      holdId = sealed.holdId;
      alert = sealed.alert;
      await tx.query(
        `insert into room_chat_removal
         (id, message_id, room_id, author_user_id, author_name, by_user_id, by_name, reason, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'csam', $8)`,
        [randomUUID(), messageId, line.room_id, line.author_user_id, line.author_name, input.userId, by, input.now],
      );
      if (line.author_user_id) {
        await writeBan(tx, {
          userId: line.author_user_id,
          name: line.author_name,
          reason: "csam",
          byUserId: input.userId,
          byName: by,
          removalId: null,
          removalAlreadyCounted: true,
          now: input.now,
          roomId: "",
        });
      }
    } else {
      const held = await tx.query<{ id: string }>(
        `select id from board_csam_hold where purged_at is null and chat_message_id = $1 order by created_at desc limit 1`,
        [messageId],
      );
      holdId = held[0]?.id ?? "";
    }
    await tx.query(
      `update board_csam_hold set reporter_name = $2, report_reason = $3 where id = $1 and reporter_name = ''`,
      [holdId, flag.reporter_name, flag.reason],
    );
    await tx.query(
      `update csam_flag set resolved_at = $2, hold_id = $3, resolution = 'removed'
       where resolved_at is null and chat_message_id = $1`,
      [messageId, input.now, holdId],
    );
    await autoCloseReports(tx, { subjectKind: "chat", subjectIds: [messageId], actorUserId: input.userId, now: input.now });
    return { holdId, alert };
  });
  if (line.author_user_id) evictCallMember(line.author_user_id);
  if (done.alert) scheduleHoldAlert(done.alert);
  await logHoldAccess(db, {
    holdId: done.holdId,
    actorUserId: input.userId,
    action: "remove_flagged",
    detail: input.flagId,
    now: input.now,
  });
  return { ok: true, value: { holdId: done.holdId } };
}
