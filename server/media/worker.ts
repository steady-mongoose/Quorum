import type { Db } from "../db.ts";
import { imageBounds, ImageBoundsError } from "../../src/lib/media/bounds.ts";
import { VIDEO_MS } from "../../src/lib/media/limits.ts";
import { stripImageMetadata } from "../../src/lib/media/strip.ts";
import {
  claimJob,
  deleteMedia,
  failJob,
  finishJob,
  listDeleted,
  listStalePending,
  markReady,
  markRejected,
  readMedia,
  requeueJob,
  stuckJobs,
} from "./db.ts";
import { MediaReject } from "./errors.ts";
import type { MediaTools } from "./ffmpeg.ts";
import type { ObjectStore } from "./s3.ts";

const MAX_ATTEMPTS = 3;
const STUCK_MS = 10 * 60 * 1000;

export type WorkerDeps = {
  db: Db;
  store: ObjectStore;
  tools: MediaTools;
  now: () => Date;
};

async function deleteKeys(store: ObjectStore, keys: string[]): Promise<void> {
  for (const key of keys) {
    if (!key) continue;
    await store.delete(key);
  }
}

async function failMedia(
  deps: WorkerDeps,
  mediaId: string,
  jobId: string,
  reason: string,
  keys: string[],
) {
  await deleteKeys(deps.store, keys);
  await markRejected(deps.db, mediaId, reason);
  await failJob(deps.db, jobId, reason);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Delete objects for tombstoned rows, then delete the rows. */
export async function sweepDeletedMedia(deps: WorkerDeps): Promise<number> {
  const rows = await listDeleted(deps.db);
  for (const row of rows) {
    await deleteKeys(deps.store, [row.upload_key, row.file_key, row.thumb_key]);
    await deleteMedia(deps.db, row.id);
  }
  return rows.length;
}

export async function expireStaleUploads(deps: WorkerDeps, pendingMs: number): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - pendingMs);
  const rows = await listStalePending(deps.db, cutoff);
  for (const row of rows) {
    await deleteKeys(deps.store, [row.upload_key, row.file_key, row.thumb_key]);
    await markRejected(deps.db, row.id, "That upload was not finished.");
  }
  return rows.length;
}

export async function recoverStuckJobs(deps: WorkerDeps): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - STUCK_MS);
  const jobs = await stuckJobs(deps.db, cutoff);
  for (const job of jobs) {
    if (job.attempts >= MAX_ATTEMPTS) {
      const row = await readMedia(deps.db, job.media_id);
      await failMedia(
        deps,
        job.media_id,
        job.id,
        "That file could not be prepared.",
        row ? [row.upload_key, row.file_key, row.thumb_key] : [],
      );
    } else {
      await requeueJob(deps.db, job.id, "The worker stopped. It will try again.", deps.now());
    }
  }
  return jobs.length;
}

/**
 * One queued room picture or video. Message ciphertext is never decoded:
 * a job for it only confirms the row and does not download the bytes.
 */
export async function runOneMediaJob(deps: WorkerDeps): Promise<"idle" | "done" | "failed"> {
  const job = await claimJob(deps.db, deps.now());
  if (!job) return "idle";
  const row = await readMedia(deps.db, job.media_id);
  if (!row) {
    await failJob(deps.db, job.id, "That file is not here.");
    return "failed";
  }
  if (row.status === "ready") {
    await finishJob(deps.db, job.id);
    return "done";
  }
  if (row.status === "rejected") {
    await failJob(deps.db, job.id, row.reject_reason || "That file was refused.");
    return "failed";
  }
  try {
    if (row.encryption === "client-e2e") {
      // The device encrypted this. Confirm the size, but do not download or transcode it.
      const sealedKey = row.file_key || row.upload_key;
      const head = await deps.store.head(sealedKey);
      if (!head || head.byteSize < 1 || head.byteSize > row.byte_size) {
        throw new MediaReject("The upload has not arrived.");
      }
      await markReady(deps.db, {
        id: row.id,
        byteSize: head.byteSize,
        contentType: row.content_type,
        durationMs: row.duration_ms,
        fileKey: sealedKey,
        thumbKey: "",
        now: deps.now(),
      });
      await finishJob(deps.db, job.id);
      return "done";
    }
    const raw = await deps.store.get(row.upload_key);
    if (!raw) throw new MediaReject("The upload has not arrived.");
    if (row.kind === "image") {
      let stripped: Uint8Array;
      try {
        imageBounds(raw, row.content_type);
        stripped = stripImageMetadata(raw, row.content_type);
      } catch (error) {
        throw new MediaReject(
          error instanceof ImageBoundsError || error instanceof Error
            ? error.message
            : "That file is not a picture we can keep.",
        );
      }
      const processed = await deps.tools.processImage(stripped, row.content_type);
      if (sameBytes(processed.file, raw)) {
        throw new MediaReject("That picture could not be prepared.");
      }
      const fileKey = `ready/${row.id}/file`;
      const thumbKey = `ready/${row.id}/thumb`;
      await deps.store.put(fileKey, processed.file, processed.fileType);
      await deps.store.put(thumbKey, processed.thumb, processed.thumbType);
      await deps.store.delete(row.upload_key);
      await markReady(deps.db, {
        id: row.id,
        byteSize: processed.file.byteLength,
        contentType: processed.fileType,
        durationMs: null,
        fileKey,
        thumbKey,
        now: deps.now(),
      });
    } else {
      const processed = await deps.tools.processVideo(raw);
      if (processed.durationMs > VIDEO_MS)
        throw new MediaReject("That video is longer than 60 seconds.");
      const fileKey = `ready/${row.id}/file`;
      const thumbKey = `ready/${row.id}/thumb`;
      await deps.store.put(fileKey, processed.file, processed.fileType);
      await deps.store.put(thumbKey, processed.thumb, processed.thumbType);
      await deps.store.delete(row.upload_key);
      await markReady(deps.db, {
        id: row.id,
        byteSize: processed.file.byteLength,
        contentType: processed.fileType,
        durationMs: processed.durationMs,
        fileKey,
        thumbKey,
        now: deps.now(),
      });
    }
    await finishJob(deps.db, job.id);
    return "done";
  } catch (error) {
    const message = error instanceof Error ? error.message : "That file could not be prepared.";
    const permanent = error instanceof MediaReject || job.attempts >= MAX_ATTEMPTS;
    if (permanent) {
      await failMedia(deps, row.id, job.id, message, [
        row.upload_key,
        row.file_key,
        row.thumb_key,
        `ready/${row.id}/file`,
        `ready/${row.id}/thumb`,
      ]);
      return "failed";
    }
    const delay = job.attempts * 15_000;
    await requeueJob(deps.db, job.id, message, new Date(deps.now().getTime() + delay));
    return "failed";
  }
}
