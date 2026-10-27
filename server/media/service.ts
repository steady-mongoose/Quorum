import { randomUUID } from "node:crypto";
import { actorRole } from "../board/access.ts";
import { HELD_UPLOAD_PREFIX, postIsHeld } from "../board/csam.ts";
import { openBan } from "../board/store.ts";
import type { Db } from "../db.ts";
import { onboardingBlock } from "../profile/gate.ts";
import { profileView } from "../profile/view.ts";
import {
  IMAGE_BYTES,
  PENDING_MS,
  READ_SECONDS,
  UPLOAD_SECONDS,
  VIDEO_BYTES,
  planUpload,
  type UploadPlan,
} from "../../src/lib/media/limits.ts";
import { canAttachToPost, memberOfRoom } from "./access.ts";
import {
  insertPending,
  markProcessing,
  markReady,
  markRejected,
  readMedia,
  userExists,
} from "./db.ts";
import { attachmentName, type ObjectStore } from "./s3.ts";

export type MediaResult<T> =
  | { ok: true; status: number; body: T }
  | {
      ok: false;
      status: number;
      error: string;
      /** Set when the member still has to finish onboarding. */
      code?: string;
      ban?: { until: number; strikes: number; reason: string };
    };

export type MediaServiceDeps = {
  db: Db;
  store: ObjectStore;
  now: () => Date;
  videoEnabled: boolean;
};

function uploadKey(scope: UploadPlan["scope"], id: string): string {
  return scope === "dm" ? `dm/${id}/cipher` : `incoming/${id}`;
}

function cap(kind: UploadPlan["kind"]): number {
  return kind === "image" ? IMAGE_BYTES : VIDEO_BYTES;
}

async function rejectUpload(
  deps: MediaServiceDeps,
  id: string,
  key: string,
  error: string,
): Promise<MediaResult<never>> {
  await deps.store.delete(key);
  await markRejected(deps.db, id, error);
  return { ok: false, status: 400, error };
}

export async function prepareUpload(
  deps: MediaServiceDeps,
  userId: string,
  body: Record<string, unknown>,
): Promise<
  MediaResult<{
    id: string;
    upload: { url: string; method: "PUT"; headers: Record<string, string> };
    expiresIn: number;
  }>
> {
  const planned = planUpload(body, { videoEnabled: deps.videoEnabled, userId });
  if (!planned.ok) return planned;
  const plan = planned.plan;
  if (plan.scope === "profile") {
    const role = await actorRole(deps.db, userId);
    if (!role.member) return { ok: false, status: 403, error: "Only a member can do that." };
    const ban = await openBan(deps.db, userId, deps.now());
    if (ban) return { ok: false, status: 403, error: "banned", ban };
  } else {
    const gate = await onboardingBlock(deps.db, userId);
    if (gate) return gate;
  }
  if (plan.scope === "dm" && !(await userExists(deps.db, plan.peerUserId))) {
    return { ok: false, status: 400, error: "Choose the other person." };
  }
  if (plan.scope === "room") {
    const access = await canAttachToPost(deps.db, userId, plan.roomId, plan.postId, deps.now());
    if (!access.ok) return access;
  }
  const id = randomUUID();
  const key = uploadKey(plan.scope, id);
  await insertPending(deps.db, id, userId, plan, key);
  const now = deps.now();
  const upload = deps.store.presignPut({
    key,
    contentType: plan.uploadContentType,
    contentLength: plan.byteSize,
    expiresIn: UPLOAD_SECONDS,
    now,
  });
  return {
    ok: true,
    status: 201,
    body: {
      id,
      upload: { url: upload.url, method: "PUT", headers: upload.headers },
      expiresIn: UPLOAD_SECONDS,
    },
  };
}

export async function completeUpload(
  deps: MediaServiceDeps,
  userId: string,
  id: string,
): Promise<MediaResult<{ id: string; status: "processing" | "ready" }>> {
  const row = await readMedia(deps.db, id);
  if (!row || row.owner_user_id !== userId)
    return { ok: false, status: 404, error: "That file is not here." };
  if (row.status !== "pending")
    return { ok: false, status: 409, error: "That upload is already in." };
  if (row.scope !== "profile") {
    const gate = await onboardingBlock(deps.db, userId);
    if (gate) return gate;
  }
  const created = new Date(row.created_at);
  if (deps.now().getTime() - created.getTime() > PENDING_MS) {
    return rejectUpload(deps, id, row.upload_key, "That upload was not finished.");
  }
  const head = await deps.store.head(row.upload_key);
  if (!head) return { ok: false, status: 409, error: "The upload has not arrived." };
  const expectedType =
    row.encryption === "client-e2e" ? "application/octet-stream" : row.content_type;
  if (head.contentType !== expectedType) {
    return rejectUpload(deps, id, row.upload_key, "That file is not the type you named.");
  }
  if (head.byteSize < 1 || head.byteSize > row.byte_size || head.byteSize > cap(row.kind)) {
    return rejectUpload(deps, id, row.upload_key, "That file is larger than you said.");
  }
  if (row.encryption === "client-e2e") {
    // Ciphertext is not decoded. The device stripped metadata before encryption.
    await markReady(deps.db, {
      id,
      byteSize: head.byteSize,
      contentType: row.content_type,
      durationMs: row.duration_ms,
      fileKey: row.upload_key,
      thumbKey: "",
      now: deps.now(),
    });
    return { ok: true, status: 200, body: { id, status: "ready" } };
  }
  await markProcessing(deps.db, id, head.byteSize, deps.now());
  return { ok: true, status: 200, body: { id, status: "processing" } };
}

export async function readForMember(
  deps: MediaServiceDeps,
  userId: string,
  id: string,
): Promise<
  MediaResult<{
    id: string;
    status: string;
    kind: string;
    scope: string;
    encryption: string;
    error?: string;
    url?: string;
    thumbUrl?: string;
    keyEnvelope?: string;
    expiresIn?: number;
  }>
> {
  const row = await readMedia(deps.db, id);
  if (!row || row.deleted_at) return { ok: false, status: 404, error: "That file is not here." };
  if (row.upload_key.startsWith(HELD_UPLOAD_PREFIX)) {
    return { ok: false, status: 404, error: "That file is not here." };
  }
  if (row.post_id && (await postIsHeld(deps.db, row.post_id))) {
    return { ok: false, status: 404, error: "That file is not here." };
  }
  if (row.scope === "profile" && (await postIsHeld(deps.db, row.id))) {
    return { ok: false, status: 404, error: "That file is not here." };
  }
  if (row.scope === "room") {
    const stood = await memberOfRoom(deps.db, userId, row.room_id, deps.now());
    if (!stood.ok) {
      if (stood.error === "banned") {
        return { ok: false, status: 403, error: "banned", ban: stood.ban };
      }
      return { ok: false, status: 404, error: "That file is not here." };
    }
    const posts = await deps.db.query<{ id: string }>(
      `select id from room_post where id = $1 and room_id = $2`,
      [row.post_id, row.room_id],
    );
    if (!posts[0]) return { ok: false, status: 404, error: "That file is not here." };
  } else if (row.scope === "profile") {
    const visible = await profilePhotoVisible(deps, userId, row.owner_user_id, row.id);
    if (!visible.ok) return visible;
  } else if (row.owner_user_id !== userId && row.peer_user_id !== userId) {
    return { ok: false, status: 404, error: "That file is not here." };
  }
  if (row.status === "rejected") {
    if (row.owner_user_id !== userId)
      return { ok: false, status: 404, error: "That file is not here." };
    return {
      ok: true,
      status: 200,
      body: {
        id,
        status: "rejected",
        kind: row.kind,
        scope: row.scope,
        encryption: row.encryption,
        error: row.reject_reason || "That file was refused.",
      },
    };
  }
  if (row.status !== "ready" || !row.file_key) {
    return {
      ok: true,
      status: 200,
      body: {
        id,
        status: row.status,
        kind: row.kind,
        scope: row.scope,
        encryption: row.encryption,
      },
    };
  }
  const now = deps.now();
  const servedType =
    row.encryption === "client-e2e" ? "application/octet-stream" : row.content_type;
  const url = deps.store.presignGet({
    key: row.file_key,
    expiresIn: READ_SECONDS,
    now,
    contentType: servedType,
    filename: row.scope === "profile" ? "photo.webp" : attachmentName(servedType),
  });
  const body: {
    id: string;
    status: string;
    kind: string;
    scope: string;
    encryption: string;
    url: string;
    expiresIn: number;
    thumbUrl?: string;
    keyEnvelope?: string;
  } = {
    id,
    status: "ready",
    kind: row.kind,
    scope: row.scope,
    encryption: row.encryption,
    url,
    expiresIn: READ_SECONDS,
  };
  if (row.thumb_key) {
    const profile = row.scope === "profile";
    body.thumbUrl = deps.store.presignGet({
      key: row.thumb_key,
      expiresIn: READ_SECONDS,
      now,
      contentType: profile ? "image/webp" : "image/jpeg",
      filename: profile ? "thumb.webp" : "thumb.jpg",
    });
  }
  if (row.encryption === "client-e2e") body.keyEnvelope = row.key_envelope;
  return { ok: true, status: 200, body };
}

/**
 * The owner can read their own profile picture while it is processing.
 * Anyone else can read it only when it is the current photo and profileView
 * includes it. A private photo, a banned viewer, and a photo that is not
 * attached all come back as not here.
 */
async function profilePhotoVisible(
  deps: MediaServiceDeps,
  viewerId: string,
  ownerId: string,
  mediaId: string,
): Promise<MediaResult<never> | { ok: true }> {
  if (viewerId === ownerId) return { ok: true };
  const rows = await deps.db.query<{ user_id: string }>(
    `select user_id from members where photo_media_id = $1 and user_id = $2`,
    [mediaId, ownerId],
  );
  if (!rows[0]) return { ok: false, status: 404, error: "That file is not here." };
  const viewed = await profileView(deps.db, { id: viewerId }, { id: ownerId }, deps.now());
  if (!viewed.ok) return viewed;
  if (viewed.profile.photo?.id !== mediaId) {
    return { ok: false, status: 404, error: "That file is not here." };
  }
  return { ok: true };
}
