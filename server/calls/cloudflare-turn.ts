import { CLOUDFLARE_ICE_HOSTS, parseIceUrl } from "../../src/lib/calls/ice.ts";
import type { IceServer } from "./config.ts";

export const CLOUDFLARE_TURN_BASE = "https://rtc.live.cloudflare.com/v1/turn/keys";

/** Only Cloudflare's own relay hosts are passed on to the page. */
export function cleanCloudflareIce(body: unknown): IceServer[] | null {
  if (!body || typeof body !== "object") return null;
  const list = (body as { iceServers?: unknown }).iceServers;
  const rows = Array.isArray(list) ? list : list && typeof list === "object" ? [list] : null;
  if (!rows) return null;
  const out: IceServer[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as { urls?: unknown; username?: unknown; credential?: unknown };
    const raw = typeof r.urls === "string" ? [r.urls] : Array.isArray(r.urls) ? r.urls : [];
    const urls = raw.filter(
      (url): url is string =>
        typeof url === "string" &&
        CLOUDFLARE_ICE_HOSTS.includes(parseIceUrl(url, { allowCloudflare: true })?.host ?? ""),
    );
    if (urls.length === 0) continue;
    const server: IceServer = { urls };
    if (typeof r.username === "string" && typeof r.credential === "string") {
      server.username = r.username;
      server.credential = r.credential;
    }
    out.push(server);
  }
  return out.length > 0 ? out : null;
}

/**
 * Calls POST /v1/turn/keys/{TURN_KEY_ID}/credentials/generate-ice-servers.
 * The token stays in this process. One credential set is shared until half
 * its TTL is gone, so a poll every 2 s does not hit Cloudflare.
 */
export function createCloudflareIceCache(fetchImpl: typeof fetch) {
  let cached: { servers: IceServer[]; refreshAt: number; keyId: string } | null = null;
  let inflight: Promise<IceServer[] | null> | null = null;
  return {
    async get(
      key: { keyId: string; apiToken: string },
      ttlSeconds: number,
      nowMs: number,
    ): Promise<IceServer[] | null> {
      if (cached && cached.keyId === key.keyId && nowMs < cached.refreshAt) return cached.servers;
      if (inflight) return inflight;
      inflight = (async () => {
        try {
          const response = await fetchImpl(
            `${CLOUDFLARE_TURN_BASE}/${encodeURIComponent(key.keyId)}/credentials/generate-ice-servers`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${key.apiToken}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({ ttl: ttlSeconds }),
              signal: AbortSignal.timeout(5000),
            },
          );
          if (!response.ok) return cached?.keyId === key.keyId ? cached.servers : null;
          const servers = cleanCloudflareIce(await response.json());
          if (!servers) return null;
          cached = { servers, refreshAt: nowMs + (ttlSeconds * 1000) / 2, keyId: key.keyId };
          return servers;
        } catch {
          return null;
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    },
  };
}
