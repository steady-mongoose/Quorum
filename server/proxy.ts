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
    clientIp: trusted && forwarded ? forwarded : socketIp,
    trusted,
  };
}
