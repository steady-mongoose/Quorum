import type { Db } from "../db.ts";
import type {
  MediaEncryption,
  MediaKind,
  MediaScope,
  UploadPlan,
} from "../../src/lib/media/limits.ts";

export type MediaStatus = "pending" | "processing" | "ready" | "rejected";

export type MediaRow = {
  id: string;
  owner_user_id: string;
  scope: MediaScope;
  kind: MediaKind;
  status: MediaStatus;
  content_type: string;
  byte_size: number;
  duration_ms: number | null;
  room_id: string;
  post_id: string;
  peer_user_id: string | null;
  encryption: MediaEncryption;
  key_envelope: string;
  upload_key: string;
  file_key: string;
  thumb_key: string;
  reject_reason: string;
  created_at: Date | string;
  deleted_at: Date | string | null;
};

export type JobRow = {
  id: string;
  media_id: string;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  last_error: string;
};

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRow(row: MediaRow): MediaRow {
  return { ...row, byte_size: Number(row.byte_size), duration_ms: numberOrNull(row.duration_ms) };
}

export async function insertPending(
  db: Db,
  id: string,
  userId: string,
  plan: UploadPlan,
  uploadKey: string,
): Promise<void> {
  await db.query(
    `insert into media_object (
      id, owner_user_id, scope, kind, status, content_type, byte_size, duration_ms,
      room_id, post_id, peer_user_id, encryption, key_envelope, upload_key
    ) values ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      userId,
      plan.scope,
      plan.kind,
      plan.contentType,
      plan.byteSize,
      plan.durationMs,
      plan.roomId,
      plan.postId,
      plan.peerUserId || null,
      plan.encryption,
      plan.keyEnvelope,
      uploadKey,
    ],
  );
}

export async function readMedia(db: Db, id: string): Promise<MediaRow | null> {
  const rows = await db.query<MediaRow>(`select * from media_object where id = $1`, [id]);
  return rows[0] ? asRow(rows[0]) : null;
}

export async function userExists(db: Db, id: string): Promise<boolean> {
  const rows = await db.query<{ id: string }>(`select id from "user" where id = $1`, [id]);
  return Boolean(rows[0]);
}

export async function markProcessing(
  db: Db,
  id: string,
  byteSize: number,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      `update media_object set status = 'processing', byte_size = $2 where id = $1 and status = 'pending'`,
      [id, byteSize],
    );
    await tx.query(
      `insert into media_job (id, media_id, status, run_after) values ($1, $2, 'queued', $3)`,
      [`job-${id}`, id, now.toISOString()],
    );
  });
}

export async function markReady(
  db: Db,
  input: {
    id: string;
    byteSize: number;
    contentType: string;
    durationMs: number | null;
    fileKey: string;
    thumbKey: string;
    now: Date;
    /** SHA-256 of the uploaded bytes, so identical copies can be found. Empty for sealed DM files. */
    sourceSha256?: string;
  },
): Promise<void> {
  await db.query(
    `update media_object
     set status = 'ready', byte_size = $2, content_type = $3, duration_ms = $4,
         file_key = $5, thumb_key = $6, ready_at = $7, reject_reason = '',
         source_sha256 = $8
     where id = $1`,
    [
      input.id,
      input.byteSize,
      input.contentType,
      input.durationMs,
      input.fileKey,
      input.thumbKey,
      input.now.toISOString(),
      input.sourceSha256 ?? "",
    ],
  );
}

export async function markRejected(db: Db, id: string, reason: string): Promise<void> {
  await db.query(`update media_object set status = 'rejected', reject_reason = $2 where id = $1`, [
    id,
    reason,
  ]);
}

export async function listDeleted(db: Db): Promise<MediaRow[]> {
  const rows = await db.query<MediaRow>(
    `select * from media_object where deleted_at is not null order by deleted_at, id`,
  );
  return rows.map(asRow);
}

export async function deleteMedia(db: Db, id: string): Promise<void> {
  await db.query(`delete from media_object where id = $1`, [id]);
}

export async function listStalePending(db: Db, cutoff: Date): Promise<MediaRow[]> {
  const rows = await db.query<MediaRow>(
    `select * from media_object where status = 'pending' and created_at <= $1`,
    [cutoff.toISOString()],
  );
  return rows.map(asRow);
}

export async function claimJob(db: Db, now: Date): Promise<JobRow | null> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<JobRow>(
      `select id, media_id, status, attempts, last_error
       from media_job
       where status = 'queued' and run_after <= $1
       order by run_after, id
       for update skip locked
       limit 1`,
      [now.toISOString()],
    );
    const job = rows[0];
    if (!job) return null;
    await tx.query(
      `update media_job set status = 'running', attempts = attempts + 1, claimed_at = $2 where id = $1`,
      [job.id, now.toISOString()],
    );
    return { ...job, attempts: Number(job.attempts) + 1 };
  });
}

export async function finishJob(db: Db, id: string): Promise<void> {
  await db.query(`update media_job set status = 'done', last_error = '' where id = $1`, [id]);
}

export async function requeueJob(db: Db, id: string, error: string, runAfter: Date): Promise<void> {
  await db.query(
    `update media_job set status = 'queued', last_error = $2, run_after = $3 where id = $1`,
    [id, error, runAfter.toISOString()],
  );
}

export async function failJob(db: Db, id: string, error: string): Promise<void> {
  await db.query(`update media_job set status = 'failed', last_error = $2 where id = $1`, [
    id,
    error,
  ]);
}

export async function stuckJobs(db: Db, cutoff: Date): Promise<JobRow[]> {
  const rows = await db.query<JobRow>(
    `select id, media_id, status, attempts, last_error
     from media_job
     where status = 'running' and claimed_at is not null and claimed_at <= $1`,
    [cutoff.toISOString()],
  );
  return rows.map((row) => ({ ...row, attempts: Number(row.attempts) }));
}

export async function countJobs(db: Db, mediaId: string): Promise<number> {
  const rows = await db.query<{ count: number }>(
    `select count(*)::int as count from media_job where media_id = $1`,
    [mediaId],
  );
  return Number(rows[0]?.count ?? 0);
}
