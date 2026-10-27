import { consumeLimit, UPLOAD_LIMIT } from "../rate-limit.ts";
import { uploadIpKey } from "./ip.ts";
import type { Db } from "../db.ts";
import { mediaLimits } from "../../src/lib/media/limits.ts";
import { publicMediaStatus, type MediaConfig } from "./config.ts";
import {
  completeUpload,
  prepareUpload,
  readForMember,
  serveSigned,
  type MediaServiceDeps,
} from "./service.ts";
import { SIGNED_PATH, type MediaUrlSigner } from "./signed-url.ts";
import type { ObjectStore } from "./s3.ts";

export type MediaRuntime = {
  config: MediaConfig;
  store: ObjectStore | null;
  now: () => Date;
  /** Signs read links for the media host. Unset keeps presigned storage links. */
  signer?: MediaUrlSigner | null;
};

/**
 * The edge may keep a signed file for at most a minute. The signature is in the
 * path, so it is part of Cloudflare's cache key: a new link is a new cache entry.
 * When a file is held, flagged or deleted, the origin answers 404 at once, and a
 * copy already at the edge is gone within EDGE_MAX_AGE_S. No purge API call is made.
 */
export const EDGE_MAX_AGE_S = 60;

export function signedCacheControl(secondsLeft: number): string {
  const age = Math.max(0, Math.min(secondsLeft, EDGE_MAX_AGE_S));
  return `public, max-age=${age}, s-maxage=${age}`;
}

/**
 * GET /m/:id/:variant/:exp/:sig on the media host. Cacheable at the edge for at most
 * the time left on the link, so Cloudflare's CSAM scanner sees each file. Never sets
 * or reads a cookie. Held or flagged files are 404 for everyone.
 */
export async function handleSignedMedia(
  runtime: MediaRuntime,
  db: Db,
  request: Request,
  url: URL,
): Promise<Response | null> {
  const match = SIGNED_PATH.exec(url.pathname);
  if (!url.pathname.startsWith("/m/")) return null;
  const refuse = (status: number) => {
    const headers = new Headers({ "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" });
    return new Response(status === 404 ? "Not found." : "Not allowed.", { status, headers });
  };
  const signer = runtime.signer;
  if (!signer || !runtime.store) return refuse(404);
  if (request.method !== "GET" && request.method !== "HEAD") return refuse(405);
  if ((request.headers.get("host") ?? url.host).toLowerCase() !== new URL(signer.origin).host) return refuse(404);
  if (!match) return refuse(404);
  const now = runtime.now();
  const checked = signer.verify(match[1] ?? "", match[2] ?? "", match[3] ?? "", match[4] ?? "", now);
  if (!checked.ok) return refuse(403);
  const served = await serveSigned(
    { db, store: runtime.store, now: runtime.now, videoEnabled: false },
    { id: match[1] ?? "", variant: checked.variant, expiresAt: checked.expiresAt },
  );
  if (!served.ok) return refuse(served.status);
  const headers = new Headers({
    "content-type": served.contentType,
    "content-length": String(served.bytes.byteLength),
    "cache-control": signedCacheControl(served.maxAge),
    "content-disposition": `inline; filename="${served.filename}"`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-site",
    "referrer-policy": "no-referrer",
    // Sealed message files are fetched, not shown in <img>. No credentials, so "*" is
    // safe and keeps one cached copy for every origin.
    "access-control-allow-origin": "*",
  });
  return new Response(request.method === "HEAD" ? null : (served.bytes as Uint8Array<ArrayBuffer>), { status: 200, headers });
}

function json(status: number, body: unknown, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function denied(result: {
  status: number;
  error: string;
  ban?: { until: number; strikes: number; reason: string };
}): Response {
  return json(
    result.status,
    result.ban ? { error: result.error, ban: result.ban } : { error: result.error },
  );
}

function tooMany(retryAfter: number): Response {
  return json(
    429,
    { error: "Too many uploads. Wait and try again." },
    new Headers({ "retry-after": String(retryAfter) }),
  );
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const claimed = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(claimed) && claimed > 65_536) {
    return Promise.reject(Object.assign(new Error("That request is too large."), { status: 413 }));
  }
  const text = await request.text();
  if (text.length > 65_536) {
    return Promise.reject(Object.assign(new Error("That request is too large."), { status: 413 }));
  }
  if (!text) return {};
  const body = JSON.parse(text) as unknown;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Promise.reject(Object.assign(new Error("Send a JSON object."), { status: 400 }));
  }
  return body as Record<string, unknown>;
}

function mediaId(pathname: string, suffix: string): string | null {
  const match = new RegExp(`^/api/media/([0-9a-f-]{36})${suffix}$`).exec(pathname);
  return match?.[1] ?? null;
}

/**
 * Member-only picture and video routes. Returns null when the path is not
 * a media path, so the rest of the API can answer.
 */
export async function handleMedia(
  runtime: MediaRuntime,
  db: Db,
  request: Request,
  url: URL,
  session: { id: string } | null,
  clientIp: string,
): Promise<Response | null> {
  const { pathname } = url;
  if (pathname === "/api/media/status" && request.method === "GET") {
    return json(200, { ...publicMediaStatus(runtime.config), limits: mediaLimits() });
  }
  if (!pathname.startsWith("/api/media/")) return null;
  if (request.method !== "GET" && request.method !== "POST")
    return json(405, { error: "Not found." });

  const deps = (): MediaServiceDeps => {
    if (!runtime.config.enabled || !runtime.store) {
      throw Object.assign(new Error("Picture and video storage is not set up."), { status: 503 });
    }
    return {
      db,
      store: runtime.store,
      now: runtime.now,
      videoEnabled: runtime.config.video,
      signer: runtime.signer ?? null,
    };
  };

  try {
    if (pathname === "/api/media/uploads" && request.method === "POST") {
      if (!session) return json(401, { error: "Sign in first." });
      if (!runtime.config.enabled || !runtime.store) {
        return json(503, { error: "Picture and video storage is not set up." });
      }
      const byUser = await consumeLimit(
        db,
        `upload:${session.id}`,
        UPLOAD_LIMIT,
        runtime.now().getTime(),
      );
      if (!byUser.allowed) return tooMany(byUser.retryAfter);
      const byIp = await consumeLimit(
        db,
        uploadIpKey(clientIp),
        UPLOAD_LIMIT,
        runtime.now().getTime(),
      );
      if (!byIp.allowed) return tooMany(byIp.retryAfter);
      const body = await readBody(request);
      const result = await prepareUpload(deps(), session.id, body);
      if (!result.ok) return denied(result);
      return json(result.status, result.body);
    }

    const completeId = request.method === "POST" ? mediaId(pathname, "/complete") : null;
    if (completeId) {
      if (!session) return json(401, { error: "Sign in first." });
      const result = await completeUpload(deps(), session.id, completeId);
      if (!result.ok) return denied(result);
      return json(result.status, result.body);
    }

    const readId = request.method === "GET" ? mediaId(pathname, "") : null;
    if (readId) {
      if (!session) return json(401, { error: "Sign in first." });
      if (!runtime.config.enabled || !runtime.store) {
        return json(503, { error: "Picture and video storage is not set up." });
      }
      const result = await readForMember(deps(), session.id, readId);
      if (!result.ok) return denied(result);
      return json(result.status, result.body);
    }

    if (pathname.startsWith("/api/media/")) return json(404, { error: "Not found." });
    return null;
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    if (status === 400 || status === 413 || status === 503) {
      const message = error instanceof Error ? error.message : "The server could not finish that.";
      return json(status, { error: message });
    }
    if (error instanceof SyntaxError) return json(400, { error: "Send JSON." });
    throw error;
  }
}
