import { isIP } from "node:net";

/** Header the API sets itself. Clients cannot supply the address used for limits. */
export const CLIENT_IP_HEADER = "x-avouch-client-ip";

export function normalizeIp(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (trimmed.startsWith("::ffff:")) return trimmed.slice("::ffff:".length);
  return trimmed;
}

export function isTrustedProxy(
  remoteAddress: string | undefined,
  trustedProxies: readonly string[],
): boolean {
  const peer = normalizeIp(remoteAddress);
  if (!peer) return false;
  return trustedProxies.some((proxy) => normalizeIp(proxy) === peer);
}

function firstHop(value: string | undefined): string {
  return (value ?? "").split(",")[0]?.trim() ?? "";
}

function expandIpv6(ip: string): string[] | null {
  const lower = ip.toLowerCase();
  if (lower.includes(".")) return null;
  const halves = lower.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
  if (groups.length !== 8) return null;
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups;
}

/**
 * IPv4 is unchanged. IPv6 is the /64 prefix, so one network cannot mint a new
 * bucket per address. Values that are not IP addresses (local, unknown) stay.
 * A value that is already a /64 prefix is unchanged.
 */
export function rateLimitIp(value: string): string {
  const ip = normalizeIp(value).split("%")[0].trim();
  if (!ip) return "unknown";
  if (isIP(ip) !== 6) return ip;
  const groups = expandIpv6(ip);
  if (!groups) return ip;
  const prefix = groups.slice(0, 4).map((part) => part.replace(/^0+(?=[0-9a-f])/, "") || "0");
  return `${prefix.join(":")}::/64`;
}

/**
 * The request URL always comes from BETTER_AUTH_URL. Forwarded proto and host
 * are ignored. The client address used for rate limits is the socket address,
 * or the first X-Forwarded-For hop when the socket peer is Caddy. Without
 * that, every visitor would share Caddy's address and one limit would cover
 * the whole closed test.
 */
export function resolveIncoming(input: {
  remoteAddress: string | undefined;
  trustedProxies: readonly string[];
  forwardedFor: string | undefined;
  baseURL: string;
  path: string;
}): { url: string; clientIp: string; trusted: boolean } {
  const base = new URL(input.baseURL);
  const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const trusted = isTrustedProxy(input.remoteAddress, input.trustedProxies);
  const socketIp = normalizeIp(input.remoteAddress) || "unknown";
  const forwarded = normalizeIp(firstHop(input.forwardedFor));
  return {
    url: `${base.origin}${path}`,
    clientIp: rateLimitIp(trusted && forwarded ? forwarded : socketIp),
    trusted,
  };
}
