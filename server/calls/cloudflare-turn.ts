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

/** Cloudflare credentials last 15 minutes. A poll re-mints in the last 5. */
export const CLOUDFLARE_TTL_SECONDS = 15 * 60;
const REFRESH_LEFT_MS = 5 * 60 * 1000;

export type MintOwner = { userId: string; session: string };

type Minted = {
  servers: IceServer[];
  username: string;
  keyId: string;
  expiresAt: number;
  refreshAt: number;
};

type Logger = (line: Record<string, unknown>) => void;
const defaultLog: Logger = (line) => console.log(JSON.stringify(line));

function relayUsername(servers: IceServer[]): string {
  return servers.find((server) => server.username)?.username ?? "";
}

/**
 * One credential set per member per call session (call key + join
 * generation), never shared between people. The route mints only after it
 * has checked the session, membership, and bans on that same request.
 * Leaving, re-joining, or a ban revokes the set at Cloudflare; a routine
 * refresh does not (the old set expires by TTL so a live relay keeps going).
 * Each mint is logged with the user id, session, and Cloudflare username,
 * never the credential.
 */
export function createCloudflareIceCache(fetchImpl: typeof fetch, log: Logger = defaultLog) {
  const minted = new Map<string, Minted>();
  const inflight = new Map<string, Promise<IceServer[] | null>>();
  let lastKey: { keyId: string; apiToken: string } | null = null;
  const slot = (owner: MintOwner) => `${owner.userId}\u0000${owner.session}`;

  const revokeEntry = (id: string, reason: string) => {
    const entry = minted.get(id);
    minted.delete(id);
    if (!entry || !entry.username || !lastKey || lastKey.keyId !== entry.keyId) return;
    const key = lastKey;
    const url = `${CLOUDFLARE_TURN_BASE}/${encodeURIComponent(key.keyId)}/credentials/${encodeURIComponent(entry.username)}/revoke`;
    const attempt = () =>
      fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${key.apiToken}` },
        signal: AbortSignal.timeout(5000),
      }).then(
        (response) => (response.ok ? null : `status ${response.status}`),
        (error: unknown) => (error instanceof Error ? error.name : "error"),
      );
    const base = { provider: "cloudflare", username: entry.username, reason };
    log({ event: "turn-revoke", ...base });
    // One retry; after that the set still dies at its short TTL.
    void (async () => {
      for (let tries = 1; tries <= 2; tries++) {
        const failure = await attempt();
        if (!failure) return;
        log({ event: "turn-revoke-failed", ...base, attempt: tries, failure });
      }
    })();
  };

  return {
    async get(
      key: { keyId: string; apiToken: string },
      owner: MintOwner,
      nowMs: number,
    ): Promise<IceServer[] | null> {
      lastKey = key;
      const id = slot(owner);
      const held = minted.get(id);
      if (held && held.keyId === key.keyId && nowMs < held.refreshAt && nowMs < held.expiresAt) {
        return held.servers;
      }
      // A new session for this user retires the old one.
      for (const other of [...minted.keys()]) {
        if (other !== id && other.startsWith(`${owner.userId}\u0000`))
          revokeEntry(other, "new-session");
      }
      const running = inflight.get(id);
      if (running) return running;
      const work = (async () => {
        try {
          const response = await fetchImpl(
            `${CLOUDFLARE_TURN_BASE}/${encodeURIComponent(key.keyId)}/credentials/generate-ice-servers`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${key.apiToken}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({ ttl: CLOUDFLARE_TTL_SECONDS }),
              signal: AbortSignal.timeout(5000),
            },
          );
          const servers = response.ok ? cleanCloudflareIce(await response.json()) : null;
          if (!servers) return held && nowMs < held.expiresAt ? held.servers : null;
          const expiresAt = nowMs + CLOUDFLARE_TTL_SECONDS * 1000;
          const username = relayUsername(servers);
          // A routine refresh never revokes the old set: a live relay may still
          // be on it (the client only swaps config, no ICE restart), so it is
          // left to expire at its TTL. Leave, ban, and re-join still revoke.
          minted.set(id, {
            servers,
            username,
            keyId: key.keyId,
            expiresAt,
            refreshAt: expiresAt - REFRESH_LEFT_MS,
          });
          log({
            event: "turn-mint",
            provider: "cloudflare",
            userId: owner.userId,
            session: owner.session,
            username,
            expiresAt: new Date(expiresAt).toISOString(),
          });
          return servers;
        } catch {
          // Unexpired credentials this member already holds are still fine.
          // Expired or someone else's never are; the caller falls back.
          return held && nowMs < held.expiresAt ? held.servers : null;
        } finally {
          inflight.delete(id);
        }
      })();
      inflight.set(id, work);
      return work;
    },
    /** Leave: drop and revoke this member's set for that call. */
    release(userId: string, sessionPrefix?: string): void {
      for (const id of [...minted.keys()]) {
        if (!id.startsWith(`${userId}\u0000`)) continue;
        if (sessionPrefix && !id.slice(userId.length + 1).startsWith(sessionPrefix)) continue;
        revokeEntry(id, sessionPrefix ? "left" : "removed");
      }
    },
    size(): number {
      return minted.size;
    },
  };
}
