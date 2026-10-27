import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Member media is served from the media host (https://media.avouchsocial.com) as a
 * short-lived signed URL, not with the session cookie.
 *
 * Why not widen the cookie: the session cookie is host-only on api.avouchsocial.com.
 * Setting Domain=avouchsocial.com would send it to every subdomain, including the
 * static site and any future host, and a response that depends on a cookie cannot be
 * shared from Cloudflare's cache, which is the reason for this host. Cloudflare's CSAM
 * Scanning Tool only sees content that passes through its cache.
 *
 * So the API checks the member's access with the cookie, as before, and answers with a
 * URL that carries an HMAC over the file id, the variant and an expiry. The expiry is
 * rounded up to a shared window so every member reading the same file in that window
 * gets the same URL and the edge can cache it. The media host checks the signature,
 * the expiry, and the CSAM block on every request that reaches it.
 */

export const SIGNED_WINDOW_SECONDS = 600;
const MIN_SECRET = 32;

export type MediaVariant = "file" | "thumb";

export type MediaUrlSigner = {
  origin: string;
  url: (mediaId: string, variant: MediaVariant, now: Date, readSeconds: number) => string;
  verify: (
    mediaId: string,
    variant: string,
    exp: string,
    sig: string,
    now: Date,
  ) => { ok: true; variant: MediaVariant; expiresAt: number } | { ok: false };
};

export type MediaHostConfig =
  | { enabled: false; reason: "unset" | "short-secret" | "invalid-origin" }
  | { enabled: true; origin: string; secret: string };

/**
 * MEDIA_PUBLIC_ORIGIN is the media host, for example https://media.avouchsocial.com.
 * MEDIA_URL_SECRET is at least 32 random characters. Both unset keeps the old path:
 * a two-minute presigned storage link.
 */
export function readMediaHostConfig(env: NodeJS.ProcessEnv = process.env): MediaHostConfig {
  const origin = (env.MEDIA_PUBLIC_ORIGIN ?? "").trim().replace(/\/+$/, "");
  const secret = (env.MEDIA_URL_SECRET ?? "").trim();
  if (!origin && !secret) return { enabled: false, reason: "unset" };
  if (secret.length < MIN_SECRET) return { enabled: false, reason: "short-secret" };
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return { enabled: false, reason: "invalid-origin" };
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username) {
    return { enabled: false, reason: "invalid-origin" };
  }
  return { enabled: true, origin: url.origin, secret };
}

function mac(secret: string, mediaId: string, variant: string, exp: number): string {
  return createHmac("sha256", secret).update(`avouch-media-v1\n${mediaId}\n${variant}\n${exp}`).digest("base64url");
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;

export function createSigner(config: Extract<MediaHostConfig, { enabled: true }>): MediaUrlSigner {
  return {
    origin: config.origin,
    url(mediaId, variant, now, readSeconds) {
      const earliest = Math.floor(now.getTime() / 1000) + readSeconds;
      const exp = Math.ceil(earliest / SIGNED_WINDOW_SECONDS) * SIGNED_WINDOW_SECONDS;
      const sig = mac(config.secret, mediaId, variant, exp);
      return `${config.origin}/m/${encodeURIComponent(mediaId)}/${variant}/${exp}/${sig}`;
    },
    verify(mediaId, variant, exp, sig, now) {
      if (!ID.test(mediaId) || (variant !== "file" && variant !== "thumb")) return { ok: false };
      if (!/^\d{1,12}$/.test(exp) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return { ok: false };
      const expiresAt = Number(exp);
      if (expiresAt * 1000 <= now.getTime()) return { ok: false };
      // Refuse links minted for further ahead than one read plus one window.
      if (expiresAt * 1000 > now.getTime() + 2 * SIGNED_WINDOW_SECONDS * 1000) return { ok: false };
      const want = Buffer.from(mac(config.secret, mediaId, variant, expiresAt));
      const got = Buffer.from(sig);
      if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false };
      return { ok: true, variant, expiresAt };
    },
  };
}

export const SIGNED_PATH = /^\/m\/([A-Za-z0-9_-]{1,80})\/(file|thumb)\/(\d{1,12})\/([A-Za-z0-9_-]{43})$/;
