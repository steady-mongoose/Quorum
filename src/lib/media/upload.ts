import { apiFetch } from "../api-base.ts";
import { getDmMediaCrypto } from "./e2e.ts";
import { planUpload, type MediaKind } from "./limits.ts";
import { stripImageMetadata } from "./strip.ts";

export type UploadRequest = {
  kind: MediaKind;
  contentType: string;
  byteSize: number;
  durationMs?: number;
  scope: "room" | "dm" | "profile";
  roomId?: string;
  postId?: string;
  peerUserId?: string;
  keyEnvelope?: string;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function errorMessage(body: unknown, fallback: string): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string" &&
    body.error
  ) {
    return body.error;
  }
  return fallback;
}

/**
 * Ask for a presigned URL, PUT the bytes straight at object storage, then tell
 * the API the upload arrived. The PUT does not send the session cookie.
 */
export async function runUpload(input: {
  request: UploadRequest;
  bytes: Uint8Array;
  /** Calls to this API. */
  fetchImpl: FetchLike;
  /** PUT to object storage. Defaults to fetch, and does not send the session cookie. */
  putImpl?: FetchLike;
  resolveUrl: (path: string) => string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const prepared = await input.fetchImpl(input.resolveUrl("/api/media/uploads"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.request),
  });
  const preparedBody = (await prepared.json().catch(() => null)) as {
    error?: unknown;
    id?: unknown;
    upload?: { url?: unknown; headers?: unknown };
  } | null;
  if (!prepared.ok)
    return { ok: false, error: errorMessage(preparedBody, "The picture was not accepted.") };
  const id = typeof preparedBody?.id === "string" ? preparedBody.id : "";
  const url = typeof preparedBody?.upload?.url === "string" ? preparedBody.upload.url : "";
  const headers =
    preparedBody?.upload?.headers && typeof preparedBody.upload.headers === "object"
      ? (preparedBody.upload.headers as Record<string, string>)
      : {};
  if (!id || !url) return { ok: false, error: "The picture was not accepted." };
  const put = await (input.putImpl ?? fetch)(url, {
    method: "PUT",
    credentials: "omit",
    headers: { ...headers, "content-length": String(input.bytes.byteLength) },
    body: input.bytes as BodyInit,
  });
  if (!put.ok) return { ok: false, error: "The picture did not upload." };
  const done = await input.fetchImpl(input.resolveUrl(`/api/media/${id}/complete`), {
    method: "POST",
    credentials: "include",
  });
  if (!done.ok) {
    const doneBody = await done.json().catch(() => null);
    return { ok: false, error: errorMessage(doneBody, "The picture did not upload.") };
  }
  return { ok: true, id };
}

export async function uploadRoomMedia(input: {
  bytes: Uint8Array;
  contentType: string;
  roomId: string;
  postId: string;
  durationMs?: number;
}): Promise<{ ok: true; id: string; kind: MediaKind } | { ok: false; error: string }> {
  const kind: MediaKind = input.contentType.startsWith("video/") ? "video" : "image";
  const posted = await apiFetch(`/api/rooms/${encodeURIComponent(input.roomId)}/posts`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: input.postId }),
  });
  if (!posted.ok) {
    const postedBody = await posted.json().catch(() => null);
    return { ok: false, error: errorMessage(postedBody, "That post is not here.") };
  }
  const result = await runUpload({
    request: {
      kind,
      contentType: input.contentType,
      byteSize: input.bytes.byteLength,
      durationMs: input.durationMs,
      scope: "room",
      roomId: input.roomId,
      postId: input.postId,
    },
    bytes: input.bytes,
    fetchImpl: (url, init) => apiFetch(url, init),
    resolveUrl: (path) => path,
  });
  if (!result.ok) return result;
  return { ok: true, id: result.id, kind };
}

/**
 * Encrypt on the device, then upload the ciphertext. Refuses when the
 * messaging change has not registered a crypto implementation.
 */
export async function uploadDmCipher(input: {
  bytes: Uint8Array;
  contentType: string;
  peerUserId: string;
  durationMs?: number;
  fetchImpl?: FetchLike;
  putImpl?: FetchLike;
  resolveUrl?: (path: string) => string;
}): Promise<{ ok: true; id: string; kind: MediaKind } | { ok: false; error: string }> {
  const crypto = getDmMediaCrypto();
  if (!crypto) {
    return {
      ok: false,
      error: "Pictures in messages stay off until messages are encrypted on this device.",
    };
  }
  const kind: MediaKind = input.contentType.startsWith("video/") ? "video" : "image";
  const plain = kind === "image" ? stripImageMetadata(input.bytes, input.contentType) : input.bytes;
  const sealed = await crypto.seal({
    bytes: plain,
    kind,
    contentType: input.contentType,
    peerUserId: input.peerUserId,
  });
  if (!sealed.keyEnvelope || sealed.ciphertext.byteLength < 1) {
    return { ok: false, error: "That picture could not be encrypted on this device." };
  }
  const result = await runUpload({
    request: {
      kind,
      contentType: input.contentType,
      byteSize: sealed.ciphertext.byteLength,
      durationMs: input.durationMs,
      scope: "dm",
      peerUserId: input.peerUserId,
      keyEnvelope: sealed.keyEnvelope,
    },
    bytes: sealed.ciphertext,
    fetchImpl: input.fetchImpl ?? ((url, init) => apiFetch(url, init)),
    putImpl: input.putImpl,
    resolveUrl: input.resolveUrl ?? ((path) => path),
  });
  if (!result.ok) return result;
  return { ok: true, id: result.id, kind };
}

/**
 * Upload a profile photo. The server re-encodes it. This does not attach it.
 * Call POST /api/profile/photo with the id once the picture is ready.
 * There is no face rule. GIF, video, and anything over 5 MB are refused here
 * and again on the server.
 */
export async function uploadProfilePhoto(input: {
  bytes: Uint8Array;
  contentType: string;
  fetchImpl?: FetchLike;
  putImpl?: FetchLike;
  resolveUrl?: (path: string) => string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const planned = planUpload(
    {
      kind: "image",
      contentType: input.contentType,
      byteSize: input.bytes.byteLength,
      scope: "profile",
    },
    { videoEnabled: false, userId: "profile" },
  );
  if (!planned.ok) return { ok: false, error: planned.error };
  return runUpload({
    request: {
      kind: "image",
      contentType: planned.plan.contentType,
      byteSize: planned.plan.byteSize,
      scope: "profile",
    },
    bytes: input.bytes,
    fetchImpl: input.fetchImpl ?? ((url, init) => apiFetch(url, init)),
    putImpl: input.putImpl,
    resolveUrl: input.resolveUrl ?? ((path) => path),
  });
}
