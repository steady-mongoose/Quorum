import { parseIceUrl } from "../../src/lib/calls/ice.ts";
import { mintTurnCredential } from "./turn.ts";

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
  for (const url of stunUrls) {
    const parsed = parseIceUrl(url);
    if (!parsed || parsed.relay) return { enabled: false, reason: "forbidden-ice" };
  }
  for (const url of turnUrls) {
    const parsed = parseIceUrl(url);
    if (!parsed || !parsed.relay) return { enabled: false, reason: "forbidden-ice" };
  }
  return { enabled: true, stunUrls, turnUrls, turnSecret, turnTtlSeconds: 60 * 60 };
}

/** Safe to send to anyone. No addresses and no secret. */
export function publicCallsStatus(config: CallsConfig): { enabled: boolean; record: false } {
  return { enabled: config.enabled, record: false };
}

/** Addresses for one member who already joined. Empty when no relay is set. */
export function iceServersForMember(
  config: CallsConfig,
  userId: string,
  nowMs: number,
): IceServer[] {
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
