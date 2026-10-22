import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import type { ObjectStore } from "../media/s3.ts";
import { actorRole } from "./access.ts";

/**
 * Pending counsel.
 * 18 U.S.C. 2258A(h), as amended by the REPORT Act (Pub. L. 118-59, 2024),
 * requires preservation for one year after a CyberTipline report. The default
 * is 365 days. `CSAM_HOLD_DAYS` may raise it and cannot lower it. Recording a
 * filing extends the hold to 365 days from that filing when that date is later.
 * Confirm the period with counsel before relying on it.
 */
export const STATUTORY_HOLD_DAYS = 365;
export const HOLD_DAYS = STATUTORY_HOLD_DAYS;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Default retention. `holdMs` reads `CSAM_HOLD_DAYS` when a removal is sealed. */
export const HOLD_MS = STATUTORY_HOLD_DAYS * DAY_MS;
/** How often the server deletes an expired hold. Not tied to opening the board. */
export const HOLD_SWEEP_MS = 60 * 60 * 1000;
export const REDACTED_CLAIM = "[removed]";
/** Object-storage prefix that the board never presigns. */
export const SEALED_PREFIX = "csam-hold/";
const HKDF_INFO = "avouch-csam-hold-v1";

/**
 * Columns the admin queue is allowed to read. `sealed` is not one of them.
 * The queue prepares a report. It does not submit one.
 */
export const CSAM_QUEUE_SQL = `select id, post_id, room_id, author_user_id, author_name,
            media_count, byte_size, media_types, created_at, retain_until,
            seal_status, filed_at, report_id, filed_by_name
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
  status: "prepared" | "pending_seal" | "filed";
  reportId: string;
  filedAt: number | null;
  filedBy: string;
};

export type AdminAlert = {
  id: string;
  kind: "csam_hold" | "csam_pending_seal";
  holdId: string;
  at: number;
};

export type RelocatedFile = { from: string; to: string };

export type HoldAlert = {
  id: string;
  kind: "csam_hold" | "csam_pending_seal";
  holdId: string;
  roomId: string;
  postId: string;
};

/** Loud boot warning. A missing key does not stop the process. */
export function warnMissingHoldKey(log: (message: string) => void = console.error): void {
  if (holdKeyError() === null) return;
  log(
    "WARNING: CSAM_HOLD_KEY is not set. CSAM text and media stay held, unencrypted, where the board cannot serve them, until a key is set. Set CSAM_HOLD_KEY to a random 32-byte key or a passphrase of at least 16 characters.",
  );
}

export function holdDays(raw: string | undefined = process.env.CSAM_HOLD_DAYS): number {
  const parsed = Number(raw?.trim());
  if (!Number.isFinite(parsed) || parsed < STATUTORY_HOLD_DAYS) return STATUTORY_HOLD_DAYS;
  return Math.floor(parsed);
}

export function holdMs(raw?: string): number {
  return holdDays(raw) * DAY_MS;
}

/** A random 32-byte key as hex, or as standard base64. A passphrase uses HKDF. */
export function rawHoldKey(value: string): Buffer | null {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  if (trimmed.length === 43 || trimmed.length === 44) {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 32) return decoded;
  }
  return null;
}

export function holdKeyError(raw: string | undefined = process.env.CSAM_HOLD_KEY): string | null {
  const value = raw?.trim() ?? "";
  if (rawHoldKey(value) || value.length >= 16) return null;
  return "Set CSAM_HOLD_KEY to a random 32-byte key, or a passphrase of at least 16 characters.";
}

export function holdKey(): Buffer {
  const raw = process.env.CSAM_HOLD_KEY?.trim() ?? "";
  const missing = holdKeyError(raw);
  if (missing) throw new Error(missing);
  const direct = rawHoldKey(raw);
  if (direct) return direct;
  return Buffer.from(hkdfSync("sha256", raw, Buffer.alloc(0), Buffer.from(HKDF_INFO), 32));
}

/**
 * Tests serialize CSAM removals so one case can unset the key without
 * racing another case in this process. The server does not call this.
 * Boot warns when the key is missing, and encrypts a pending hold when a key is present.
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
  return Buffer.from(sealBytes(Buffer.from(JSON.stringify(body), "utf8"))).toString("base64");
}

export function sealBytes(bytes: Uint8Array): Uint8Array {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", holdKey(), iv);
  const enc = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

/** Tests use this to prove the hold kept the bytes. Routes do not. */
export function openHold(sealed: string): HeldBody {
  const plain = Buffer.from(openBytes(Buffer.from(sealed, "base64"))).toString("utf8");
  return JSON.parse(plain) as HeldBody;
}

export function openBytes(sealed: Uint8Array): Uint8Array {
  const buf = Buffer.from(sealed);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", holdKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

export function sealedObjectKey(holdId: string, mediaId: string): string {
  return `${SEALED_PREFIX}${holdId}/${mediaId}`;
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || !value.startsWith("{")) return [];
  const inner = value.slice(1, -1);
  if (!inner) return [];
  return inner.split(",").map((item) => item.replace(/^"|"$/g, "").replace(/\\"/g, '"'));
}

function atMs(value: Date | string | number): number {
  return typeof value === "number" ? value : new Date(value).getTime();
}

export function reportFromRow(row: {
  id: string;
  post_id: string;
  room_id: string;
  author_user_id: string | null;
  author_name: string;
  media_count: number;
  byte_size: number;
  media_types: unknown;
  created_at: Date | string | number;
  retain_until: Date | string | number;
  seal_status?: string | null;
  filed_at?: Date | string | number | null;
  report_id?: string | null;
  filed_by_name?: string | null;
}): CsamReport {
  const filedAt = row.filed_at ? atMs(row.filed_at) : null;
  const status = filedAt ? "filed" : row.seal_status === "pending_seal" ? "pending_seal" : "prepared";
  return {
    id: row.id,
    postId: row.post_id,
    room: row.room_id,
    author: row.author_name,
    accountId: row.author_user_id ?? "",
    incidentAt: atMs(row.created_at),
    retainUntil: atMs(row.retain_until),
    mediaCount: Number(row.media_count),
    byteSize: Number(row.byte_size),
    mediaTypes: textList(row.media_types),
    status,
    reportId: row.report_id ?? "",
    filedAt,
    filedBy: row.filed_by_name ?? "",
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

type StoredFile = {
  id: string;
  kind: string;
  content_type: string;
  byte_size: number;
  file_key: string;
  upload_key: string;
  thumb_key: string;
};

async function relocateFiles(
  store: ObjectStore | null,
  holdId: string,
  files: StoredFile[],
  encrypt: boolean,
): Promise<RelocatedFile[]> {
  if (!store) return [];
  const relocated: RelocatedFile[] = [];
  const created: string[] = [];
  try {
    for (const file of files) {
      const sources = [...new Set([file.file_key, file.upload_key, file.thumb_key])].filter(
        (key) => key && !key.startsWith(SEALED_PREFIX),
      );
      let payload: Uint8Array | null = null;
      let from = "";
      for (const key of sources) {
        payload = await store.get(key);
        if (payload) {
          from = key;
          break;
        }
      }
      const dest = sealedObjectKey(holdId, file.id);
      if (payload) {
        const body = encrypt ? sealBytes(payload) : payload;
        await store.put(dest, body, "application/octet-stream");
        created.push(dest);
      }
      for (const key of sources) relocated.push({ from: key, to: payload && key === from ? dest : "" });
    }
    return relocated;
  } catch (error) {
    for (const key of created) {
      try {
        await store.delete(key);
      } catch {
        // The removal still has to hide the post. A leftover sealed object is not served.
      }
    }
    throw error;
  }
}

function pendingBody(sealed: string): HeldBody | null {
  if (!sealed.startsWith("{")) return null;
  try {
    const body = JSON.parse(sealed) as HeldBody;
    if (!body || typeof body.claim !== "string") return null;
    if (!Array.isArray(body.replies)) body.replies = [];
    if (!Array.isArray(body.files)) body.files = [];
    return body;
  } catch {
    return null;
  }
}

/** True when these bytes are already an AES-GCM hold. Plaintext fails the auth tag. */
function alreadySealed(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 28) return false;
  try {
    openBytes(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hide the post in the caller's transaction. Copy files to `csam-hold/`.
 * When the key is set, the post text and the files are encrypted. When it is
 * not, both stay held as plaintext in that unserved place so a later key can
 * encrypt them. The public post is still `[removed]`.
 * Returns the public object keys to delete after the transaction commits.
 */
export async function sealCsamHold(
  tx: Db,
  store: ObjectStore | null,
  postId: string,
  now: Date,
): Promise<{ files: RelocatedFile[]; alert: HoldAlert }> {
  const texts = await tx.query<{
    id: string;
    room_id: string;
    author_user_id: string;
    author_name: string;
    claim: string;
    reason: string;
    parent_id: string | null;
  }>(
    `select id, room_id, author_user_id, author_name, claim, reason, parent_id
     from board_post where id = $1 or parent_id = $1`,
    [postId],
  );
  const parent = texts.find((row) => row.id === postId);
  if (!parent) throw new Error("That post is not here.");
  const ids = texts.map((row) => row.id);
  const files = await tx.query<StoredFile>(
    `select id, kind, content_type, byte_size, file_key, upload_key, thumb_key
     from media_object where deleted_at is null and post_id = any($1::text[])`,
    [ids],
  );
  const holdId = randomUUID();
  const encrypt = holdKeyError() === null;
  const relocated = await relocateFiles(store, holdId, files, encrypt);
  const types: string[] = [];
  let bytes = 0;
  const heldFiles: HeldFile[] = files.map((file) => {
    bytes += Number(file.byte_size);
    if (file.content_type && !types.includes(file.content_type)) types.push(file.content_type);
    return {
      id: file.id,
      kind: file.kind,
      contentType: file.content_type,
      byteSize: Number(file.byte_size),
      fileKey: sealedObjectKey(holdId, file.id),
    };
  });
  const held: HeldBody = {
    claim: parent.claim,
    reason: parent.reason,
    replies: texts.filter((row) => row.parent_id).map((row) => ({ id: row.id, claim: row.claim })),
    files: heldFiles,
  };
  const sealed = encrypt ? sealHold(held) : JSON.stringify(held);
  const sealStatus = encrypt ? "sealed" : "pending_seal";
  const kind = encrypt ? "csam_hold" : "csam_pending_seal";
  const alertId = randomUUID();
  await tx.query(
    `insert into board_csam_hold
     (id, post_id, post_ids, room_id, author_user_id, author_name, sealed, seal_status,
      media_count, byte_size, media_types, created_at, retain_until)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      holdId,
      parent.id,
      ids,
      parent.room_id,
      parent.author_user_id,
      parent.author_name,
      sealed,
      sealStatus,
      files.length,
      bytes,
      types,
      now,
      new Date(now.getTime() + holdMs()),
    ],
  );
  await tx.query(
    `insert into board_admin_alert (id, kind, hold_id, created_at) values ($1, $2, $3, $4)`,
    [alertId, kind, holdId, now],
  );
  await tx.query(`update board_post set claim = $2, reason = '' where id = $1 or parent_id = $1`, [
    parent.id,
    REDACTED_CLAIM,
  ]);
  await tx.query(
    `update media_object
     set file_key = '', upload_key = '', thumb_key = ''
     where deleted_at is null and post_id = any($1::text[])`,
    [ids],
  );
  console.log(
    JSON.stringify({
      event: "csam-admin-alert",
      kind,
      holdId,
      roomId: parent.room_id,
      postId: parent.id,
    }),
  );
  return {
    files: relocated,
    alert: { id: alertId, kind, holdId, roomId: parent.room_id, postId: parent.id },
  };
}

/**
 * Encrypt holds that were stored as plaintext because the key was missing.
 * A second run does nothing. A missing key does nothing. Routes do not call this.
 */
export async function reencryptPendingHolds(
  db: Db,
  store: ObjectStore | null,
): Promise<number> {
  if (holdKeyError() !== null) return 0;
  const rows = await db.query<{ id: string; sealed: string }>(
    `select id, sealed from board_csam_hold
     where seal_status = 'pending_seal' and purged_at is null and sealed <> ''`,
  );
  let done = 0;
  for (const row of rows) {
    const body = pendingBody(row.sealed);
    if (!body) continue;
    if (store) {
      for (const file of body.files) {
        if (!file.fileKey) continue;
        const bytes = await store.get(file.fileKey);
        if (!bytes || alreadySealed(bytes)) continue;
        await store.put(file.fileKey, sealBytes(bytes), "application/octet-stream");
      }
    }
    const updated = await db.query<{ id: string }>(
      `update board_csam_hold
       set sealed = $2, seal_status = 'sealed'
       where id = $1 and seal_status = 'pending_seal'
       returning id`,
      [row.id, sealHold(body)],
    );
    if (updated[0]) done += 1;
  }
  return done;
}

export async function dropObjectKeys(
  store: ObjectStore | null,
  keys: string[],
): Promise<void> {
  if (!store) return;
  for (const key of keys) {
    if (!key) continue;
    try {
      await store.delete(key);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "csam-hold-delete-failed",
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
  }
}

/**
 * After the retention date, wipe the ciphertext, delete the sealed objects,
 * and drop the author id so the account can be deleted. An open hold still
 * blocks that deletion.
 */
export async function purgeExpiredHolds(
  db: Db,
  now: Date,
  store: ObjectStore | null = null,
): Promise<number> {
  const due = await db.query<{ id: string; post_ids: unknown }>(
    `select id, post_ids from board_csam_hold where purged_at is null and retain_until <= $1`,
    [now],
  );
  for (const row of due) {
    const postIds = textList(row.post_ids);
    const files =
      postIds.length === 0
        ? []
        : await db.query<{ id: string }>(
            `select id from media_object where post_id = any($1::text[])`,
            [postIds],
          );
    if (store) {
      for (const file of files) {
        try {
          await store.delete(sealedObjectKey(row.id, file.id));
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "csam-hold-delete-failed",
              message: error instanceof Error ? error.message : "unknown",
            }),
          );
        }
      }
    }
    await db.query(
      `update board_csam_hold
       set sealed = '', purged_at = $2, author_user_id = null, author_name = 'Removed member'
       where id = $1`,
      [row.id, now],
    );
    if (postIds.length > 0) {
      await db.query(
        `update media_object set deleted_at = $2 where deleted_at is null and post_id = any($1::text[])`,
        [postIds, now],
      );
    }
  }
  return due.length;
}

export function startHoldSweep(
  db: Db,
  store: ObjectStore | null,
  now: () => Date = () => new Date(),
): () => void {
  const run = () => {
    reencryptPendingHolds(db, store).catch((error) => {
      console.error(
        JSON.stringify({
          event: "csam-hold-reseal-failed",
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
    });
    purgeExpiredHolds(db, now(), store).catch((error) => {
      console.error(
        JSON.stringify({
          event: "csam-hold-purge-failed",
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
    });
  };
  const timer = setInterval(run, HOLD_SWEEP_MS);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}

const REPORT_ID = /^[A-Za-z0-9-]{1,64}$/;

type HoldRow = {
  id: string;
  post_id: string;
  room_id: string;
  author_user_id: string | null;
  author_name: string;
  media_count: number;
  byte_size: number;
  media_types: unknown;
  created_at: Date | string;
  retain_until: Date | string;
  seal_status: string;
  filed_at: Date | string | null;
  report_id: string;
  filed_by_name: string;
};

/** An admin records a hand-filed CyberTipline report. This does not submit one. */
export async function fileCsamReport(
  db: Db,
  input: { userId: string; name: string; holdId: string; reportId: string; now: Date },
): Promise<{ ok: true; value: CsamReport } | { ok: false; status: number; error: string }> {
  const actor = await actorRole(db, input.userId);
  if (!actor.admin) return { ok: false, status: 403, error: "Only an admin can record a CyberTipline filing." };
  const reportId = input.reportId.trim();
  if (!REPORT_ID.test(reportId)) {
    return { ok: false, status: 400, error: "Enter the CyberTipline report id." };
  }
  const rows = await db.query<HoldRow>(
    `select id, post_id, room_id, author_user_id, author_name, media_count, byte_size,
            media_types, created_at, retain_until, seal_status, filed_at, report_id, filed_by_name
     from board_csam_hold where id = $1 and purged_at is null`,
    [input.holdId],
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 404, error: "That hold is not here." };
  if (row.filed_at) return { ok: false, status: 400, error: "That report is already filed." };
  const until = new Date(Math.max(atMs(row.retain_until), input.now.getTime() + holdMs()));
  const name = input.name.trim() || "Admin";
  await db.query(
    `update board_csam_hold
     set filed_at = $2, report_id = $3, filed_by_user_id = $4, filed_by_name = $5, retain_until = $6
     where id = $1`,
    [row.id, input.now, reportId, input.userId, name, until],
  );
  console.log(JSON.stringify({ event: "csam-report-filed", holdId: row.id, reportId }));
  return {
    ok: true,
    value: reportFromRow({
      ...row,
      filed_at: input.now,
      report_id: reportId,
      filed_by_name: name,
      retain_until: until,
    }),
  };
}
