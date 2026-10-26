/** Shared picture and video limits. The server enforces these. The page uses them to fail early. */

export const IMAGE_BYTES = 8 * 1024 * 1024;
export const VIDEO_BYTES = 32 * 1024 * 1024;
export const VIDEO_MS = 60_000;
export const UPLOAD_SECONDS = 10 * 60;
export const READ_SECONDS = 120;
export const KEY_ENVELOPE_MAX = 4096;
export const PENDING_MS = 15 * 60 * 1000;

/** A profile photo is smaller than a room picture and is not a GIF. */
export const PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
/** Square file and thumbnail, in pixels. The worker crops to these edges. */
export const PROFILE_EDGE = 512;
export const PROFILE_THUMB = 128;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/webm"] as const;
export const PROFILE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type MediaKind = "image" | "video";
export type MediaScope = "room" | "dm" | "profile";
export type MediaEncryption = "server-processed" | "client-e2e";

export type UploadPlan = {
  kind: MediaKind;
  contentType: string;
  byteSize: number;
  durationMs: number | null;
  scope: MediaScope;
  roomId: string;
  postId: string;
  peerUserId: string;
  keyEnvelope: string;
  encryption: MediaEncryption;
  /** What the browser must send on the presigned PUT. Message bytes are opaque. */
  uploadContentType: string;
};

export type PlanResult =
  { ok: true; plan: UploadPlan } | { ok: false; status: 400 | 403; error: string };

export const ROOM_ID = /^[a-z0-9-]{1,32}$/;
export const OBJECT_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function mediaLimits() {
  return {
    imageBytes: IMAGE_BYTES,
    videoBytes: VIDEO_BYTES,
    videoMs: VIDEO_MS,
    uploadSeconds: UPLOAD_SECONDS,
    readSeconds: READ_SECONDS,
    imageTypes: IMAGE_TYPES,
    videoTypes: VIDEO_TYPES,
    profileImageBytes: PROFILE_IMAGE_BYTES,
    profileImageTypes: PROFILE_IMAGE_TYPES,
    profileEdges: [PROFILE_EDGE, PROFILE_THUMB] as const,
  };
}

function cleanType(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function integer(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value;
}

/**
 * Check a prepare-upload body. `videoEnabled` is the owner's switch.
 * The caller still has to refuse the call when storage credentials are unset.
 */
export function planUpload(
  body: Record<string, unknown>,
  options: { videoEnabled: boolean; userId: string },
): PlanResult {
  const kind = body.kind === "image" || body.kind === "video" ? body.kind : null;
  if (!kind) return { ok: false, status: 400, error: "Choose a picture or a video." };
  if (body.scope === "profile") return planProfile(body, kind);
  if (kind === "video" && !options.videoEnabled) {
    return { ok: false, status: 403, error: "Video is off." };
  }

  const contentType = cleanType(body.contentType);
  const allowed: readonly string[] = kind === "image" ? IMAGE_TYPES : VIDEO_TYPES;
  if (!allowed.includes(contentType)) {
    return {
      ok: false,
      status: 400,
      error:
        kind === "image"
          ? "Choose a JPEG, PNG, WebP, or GIF."
          : "That video must be an MP4 or a WebM.",
    };
  }

  const byteSize = integer(body.byteSize);
  const cap = kind === "image" ? IMAGE_BYTES : VIDEO_BYTES;
  if (byteSize === null || byteSize < 1) {
    return { ok: false, status: 400, error: "That file is empty." };
  }
  if (byteSize > cap) {
    return {
      ok: false,
      status: 400,
      error: kind === "image" ? "That picture is over 8 MB." : "That video is over 32 MB.",
    };
  }

  const durationRaw = body.durationMs;
  let durationMs: number | null = null;
  if (durationRaw !== undefined && durationRaw !== null) {
    const parsed = integer(durationRaw);
    if (parsed === null || parsed < 0) {
      return { ok: false, status: 400, error: "That length is not a number of milliseconds." };
    }
    durationMs = parsed;
  }
  if (kind === "image" && durationMs !== null && durationMs !== 0) {
    return { ok: false, status: 400, error: "A picture does not have a length." };
  }
  if (kind === "image") durationMs = null;
  if (kind === "video") {
    if (durationMs === null || durationMs < 1) {
      return { ok: false, status: 400, error: "Add the length of the video." };
    }
    if (durationMs > VIDEO_MS) {
      return { ok: false, status: 400, error: "That video is longer than 60 seconds." };
    }
  }

  const scope = body.scope === "room" || body.scope === "dm" ? body.scope : null;
  if (!scope) return { ok: false, status: 400, error: "Choose a room post or a message." };

  if (scope === "room") {
    const roomId = typeof body.roomId === "string" ? body.roomId : "";
    const postId = typeof body.postId === "string" ? body.postId : "";
    if (!ROOM_ID.test(roomId)) return { ok: false, status: 400, error: "Choose a room." };
    if (!OBJECT_ID.test(postId))
      return { ok: false, status: 400, error: "Choose the post this picture belongs to." };
    if (typeof body.keyEnvelope === "string" && body.keyEnvelope.length > 0) {
      return { ok: false, status: 400, error: "A room picture is not end-to-end encrypted." };
    }
    return {
      ok: true,
      plan: {
        kind,
        contentType,
        byteSize,
        durationMs,
        scope,
        roomId,
        postId,
        peerUserId: "",
        keyEnvelope: "",
        encryption: "server-processed",
        uploadContentType: contentType,
      },
    };
  }

  const peerUserId = typeof body.peerUserId === "string" ? body.peerUserId : "";
  const keyEnvelope = typeof body.keyEnvelope === "string" ? body.keyEnvelope : "";
  if (!OBJECT_ID.test(peerUserId))
    return { ok: false, status: 400, error: "Choose the other person." };
  if (peerUserId === options.userId) {
    return { ok: false, status: 400, error: "You cannot send a picture to yourself." };
  }
  if (!keyEnvelope)
    return { ok: false, status: 400, error: "A picture in a message needs the wrapped key." };
  if (keyEnvelope.length > KEY_ENVELOPE_MAX || keyEnvelope.includes("\u0000")) {
    return { ok: false, status: 400, error: "That wrapped key is too long." };
  }
  return {
    ok: true,
    plan: {
      kind,
      contentType,
      byteSize,
      durationMs,
      scope,
      roomId: "",
      postId: "",
      peerUserId,
      keyEnvelope,
      encryption: "client-e2e",
      uploadContentType: "application/octet-stream",
    },
  };
}

/**
 * A profile photo is a JPEG, PNG, or WebP of at most 5 MB.
 * There is no face rule. GIF and video are refused. It is not a room post
 * and it is not a message, so the room, post, peer, and wrapped key stay empty.
 * The 5 MB cap is applied here, before the 8 MB room-picture cap.
 */
function planProfile(body: Record<string, unknown>, kind: MediaKind): PlanResult {
  if (kind !== "image") {
    return { ok: false, status: 400, error: "A profile photo is a picture." };
  }
  const contentType = cleanType(body.contentType);
  if (!(PROFILE_IMAGE_TYPES as readonly string[]).includes(contentType)) {
    return { ok: false, status: 400, error: "Choose a JPEG, PNG, or WebP." };
  }
  const byteSize = integer(body.byteSize);
  if (byteSize === null || byteSize < 1) {
    return { ok: false, status: 400, error: "That file is empty." };
  }
  if (byteSize > PROFILE_IMAGE_BYTES) {
    return { ok: false, status: 400, error: "That picture is over 5 MB." };
  }
  const durationRaw = body.durationMs;
  if (durationRaw !== undefined && durationRaw !== null && durationRaw !== 0) {
    return { ok: false, status: 400, error: "A picture does not have a length." };
  }
  const roomId = typeof body.roomId === "string" ? body.roomId : "";
  const postId = typeof body.postId === "string" ? body.postId : "";
  const peerUserId = typeof body.peerUserId === "string" ? body.peerUserId : "";
  const keyEnvelope = typeof body.keyEnvelope === "string" ? body.keyEnvelope : "";
  if (roomId || postId || peerUserId || keyEnvelope) {
    return {
      ok: false,
      status: 400,
      error: "A profile photo is not a room post or a message.",
    };
  }
  return {
    ok: true,
    plan: {
      kind,
      contentType,
      byteSize,
      durationMs: null,
      scope: "profile",
      roomId: "",
      postId: "",
      peerUserId: "",
      keyEnvelope: "",
      encryption: "server-processed",
      uploadContentType: contentType,
    },
  };
}
