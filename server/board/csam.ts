import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Db } from "../db.ts";

/** 18 U.S.C. 2258A: preserve the reported material for 90 days. */
export const HOLD_DAYS = 90;
export const HOLD_MS = HOLD_DAYS * 24 * 60 * 60 * 1000;
export const REDACTED_CLAIM = "[removed]";

/**
 * Columns the admin queue is allowed to read. `sealed` is not one of them.
 * The queue prepares a report. It does not submit one.
 */
export const CSAM_QUEUE_SQL = `select id, post_id, room_id, author_user_id, author_name,
            media_count, byte_size, media_types, created_at, retain_until
     from board_csam_hold
     where purged_at is null
     order by created_at desc
     limit 200`;

export type HeldFile = {
  id: string;
  kind: string;
  contentType: string;
  byteSize: number;
  fileKey: string;
};

export type HeldBody = {
  claim: string;
  reason: string;
  replies: { id: string; claim: string }[];
  files: HeldFile[];
};

export type CsamReport = {
  id: string;
  postId: string;
  room: string;
  author: string;
  accountId: string;
  incidentAt: number;
  retainUntil: number;
  mediaCount: number;
  byteSize: number;
  mediaTypes: string[];
  status: "prepared";
};

export function holdKeyError(raw: string | undefined = process.env.CSAM_HOLD_KEY): string | null {
  if ((raw?.trim() ?? "").length < 16) {
    return "Set CSAM_HOLD_KEY before removing child sexual abuse material.";
  }
  return null;
}

export function holdKey(): Buffer {
  const raw = process.env.CSAM_HOLD_KEY?.trim() ?? "";
  const missing = holdKeyError(raw);
  if (missing) throw new Error(missing);
  return createHash("sha256").update(raw).digest();
}

/**
 * Tests serialize CSAM removals so one case can unset the key without
 * racing another case in this process. The server does not call this.
 * The key is read only when a removal is sealed, never at boot.
 */
let holdChain: Promise<unknown> = Promise.resolve();

export function withHoldKey<T>(raw: string | undefined, run: () => Promise<T>): Promise<T> {
  const result = holdChain.then(async () => {
    const previous = process.env.CSAM_HOLD_KEY;
    if (raw === undefined) delete process.env.CSAM_HOLD_KEY;
    else process.env.CSAM_HOLD_KEY = raw;
    try {
      return await run();
    } finally {
      if (previous === undefined) delete process.env.CSAM_HOLD_KEY;
      else process.env.CSAM_HOLD_KEY = previous;
    }
  });
  holdChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Ciphertext for the legal hold. Callers that serve the board do not open it. */
export function sealHold(body: HeldBody): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", holdKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Tests use this to prove the hold kept the bytes. Routes do not. */
export function openHold(sealed: string): HeldBody {
  const buf = Buffer.from(sealed, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", holdKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as HeldBody;
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || !value.startsWith("{")) return [];
  const inner = value.slice(1, -1);
  if (!inner) return [];
  return inner.split(",").map((item) => item.replace(/^"|"$/g, "").replace(/\\"/g, '"'));
}

export function reportFromRow(row: {
  id: string;
  post_id: string;
  room_id: string;
  author_user_id: string;
  author_name: string;
  media_count: number;
  byte_size: number;
  media_types: unknown;
  created_at: Date | string | number;
  retain_until: Date | string | number;
}): CsamReport {
  const at = (value: Date | string | number) =>
    typeof value === "number" ? value : new Date(value).getTime();
  return {
    id: row.id,
    postId: row.post_id,
    room: row.room_id,
    author: row.author_name,
    accountId: row.author_user_id,
    incidentAt: at(row.created_at),
    retainUntil: at(row.retain_until),
    mediaCount: Number(row.media_count),
    byteSize: Number(row.byte_size),
    mediaTypes: textList(row.media_types),
    status: "prepared",
  };
}

/** True while a CSAM hold still has the bytes. The file is not served. */
export async function postIsHeld(db: Db, postId: string): Promise<boolean> {
  if (!postId) return false;
  const rows = await db.query<{ id: string }>(
    `select id from board_csam_hold
     where purged_at is null and (post_id = $1 or $1 = any(post_ids))
     limit 1`,
    [postId],
  );
  return Boolean(rows[0]);
}

/**
 * After 90 days, wipe the ciphertext and tombstone the files so the media
 * sweep can delete the objects. The queue stops listing the report.
 */
export async function purgeExpiredHolds(db: Db, now: Date): Promise<number> {
  const due = await db.query<{ id: string; post_ids: unknown }>(
    `select id, post_ids from board_csam_hold where purged_at is null and retain_until <= $1`,
    [now],
  );
  for (const row of due) {
    await db.query(`update board_csam_hold set sealed = '', purged_at = $2 where id = $1`, [
      row.id,
      now,
    ]);
    for (const postId of textList(row.post_ids)) {
      await db.query(
        `update media_object set deleted_at = $2 where deleted_at is null and post_id = $1`,
        [postId, now],
      );
    }
  }
  return due.length;
}
