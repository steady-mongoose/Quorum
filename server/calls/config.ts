import { parseIceUrl } from "../../src/lib/calls/ice.ts";
import { mintTurnCredential } from "./turn.ts";
import { createCloudflareIceCache, type MintOwner } from "./cloudflare-turn.ts";

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type CallsConfig =
  | { enabled: false; reason: "off" | "forbidden-ice" | "partial-turn" }
  | {
      enabled: true;
      stunUrls: string[];
      turnUrls: string[];
      turnSecret: string;
      turnTtlSeconds: number;
      /** Cloudflare Realtime TURN key. When set, it is used instead of coturn. */
      cloudflare: { keyId: string; apiToken: string } | null;
    };

function field(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

function splitUrls(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Room calls stay off unless CALLS is exactly "on". TURN needs both a URL
 * list and a shared secret. A vendor ICE host, or half of the TURN pair,
 * keeps the feature off instead of starting a call pointed at someone else.
 */
export function readCallsConfig(env: NodeJS.ProcessEnv = process.env): CallsConfig {
  if (field(env, "CALLS").toLowerCase() !== "on") return { enabled: false, reason: "off" };
  const stunUrls = splitUrls(field(env, "CALLS_STUN_URLS"));
  const turnUrls = splitUrls(field(env, "CALLS_TURN_URLS"));
  const turnSecret = field(env, "CALLS_TURN_SECRET");
  const turnOn = turnUrls.length > 0;
  const secretOn = turnSecret.length > 0;
  if (turnOn !== secretOn) return { enabled: false, reason: "partial-turn" };
  if (secretOn && !/^[A-Za-z0-9]{32,128}$/.test(turnSecret)) {
    return { enabled: false, reason: "partial-turn" };
  }
  const cfKeyId = field(env, "TURN_KEY_ID");
  const cfToken = field(env, "TURN_KEY_API_TOKEN");
  if (Boolean(cfKeyId) !== Boolean(cfToken)) return { enabled: false, reason: "partial-turn" };
  if (
    cfKeyId &&
    (!/^[A-Za-z0-9]{16,64}$/.test(cfKeyId) || !/^[A-Za-z0-9._-]{16,200}$/.test(cfToken))
  ) {
    return { enabled: false, reason: "partial-turn" };
  }
  const cloudflare = cfKeyId ? { keyId: cfKeyId, apiToken: cfToken } : null;
  for (const url of stunUrls) {
    const parsed = parseIceUrl(url);
    if (!parsed || parsed.relay) return { enabled: false, reason: "forbidden-ice" };
  }
  for (const url of turnUrls) {
    const parsed = parseIceUrl(url);
    if (!parsed || !parsed.relay) return { enabled: false, reason: "forbidden-ice" };
  }
  return {
    enabled: true,
    stunUrls,
    turnUrls,
    turnSecret,
    turnTtlSeconds: 60 * 60,
    cloudflare,
  };
}

/** Safe to send to anyone. No addresses and no secret. */
export function publicCallsStatus(config: CallsConfig): { enabled: boolean; record: false } {
  return { enabled: config.enabled, record: false };
}

/** Coturn path. Addresses for one member who already joined. Empty when no relay is set. */
export function coturnIceServers(config: CallsConfig, userId: string, nowMs: number): IceServer[] {
  if (!config.enabled) return [];
  const servers: IceServer[] = [];
  if (config.stunUrls.length > 0) servers.push({ urls: config.stunUrls });
  if (config.turnUrls.length > 0 && config.turnSecret) {
    const minted = mintTurnCredential(config.turnSecret, userId, nowMs, config.turnTtlSeconds);
    servers.push({
      urls: config.turnUrls,
      username: minted.username,
      credential: minted.credential,
    });
  }
  return servers;
}

export type IceSource = {
  (config: CallsConfig, owner: MintOwner, nowMs: number): Promise<IceServer[]>;
  /** Revoke what was minted: one call (sessionPrefix) or everything for a user. */
  release(userId: string, sessionPrefix?: string): void;
};

/**
 * Cloudflare Realtime TURN when TURN_KEY_ID and TURN_KEY_API_TOKEN are set,
 * otherwise the coturn path. A Cloudflare failure falls back to coturn/STUN.
 * Expired Cloudflare credentials are never returned.
 */
export function createIceSource(
  fetchImpl: typeof fetch = fetch,
  log?: (line: Record<string, unknown>) => void,
): IceSource {
  const cache = createCloudflareIceCache(fetchImpl, log);
  const source = (async (config: CallsConfig, owner: MintOwner, nowMs: number) => {
    if (!config.enabled) return [];
    if (config.cloudflare) {
      const servers = await cache.get(config.cloudflare, owner, nowMs);
      if (servers) return servers;
    }
    return coturnIceServers(config, owner.userId, nowMs);
  }) as IceSource;
  source.release = (userId, sessionPrefix) => cache.release(userId, sessionPrefix);
  return source;
}

/** Kept for callers that only need the coturn result synchronously. */
export const iceServersForMember = coturnIceServers;
