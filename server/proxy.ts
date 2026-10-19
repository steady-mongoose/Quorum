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

function safeHost(value: string): boolean {
  return value.length > 0 && value.length <= 253 && /^[A-Za-z0-9.:-]+$/.test(value);
}

/**
 * The public URL and client IP for one connection.
 * X-Forwarded-Proto, X-Forwarded-Host, and X-Forwarded-For count only when
 * the TCP peer is Caddy (TRUSTED_PROXIES). Every other caller is given
 * BETTER_AUTH_URL and the socket address.
 */
export function resolveIncoming(input: {
  remoteAddress: string | undefined;
  trustedProxies: readonly string[];
  forwardedProto: string | undefined;
  forwardedHost: string | undefined;
  forwardedFor: string | undefined;
  hostHeader: string | undefined;
  baseURL: string;
  path: string;
}): { url: string; clientIp: string; trusted: boolean } {
  const base = new URL(input.baseURL);
  const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const trusted = isTrustedProxy(input.remoteAddress, input.trustedProxies);
  const socketIp = normalizeIp(input.remoteAddress) || "unknown";
  if (!trusted) {
    return { url: `${base.origin}${path}`, clientIp: socketIp, trusted: false };
  }
  const proto = firstHop(input.forwardedProto).toLowerCase();
  const host = firstHop(input.forwardedHost) || firstHop(input.hostHeader);
  const safeProto = proto === "http" || proto === "https" ? proto : base.protocol.replace(":", "");
  const origin = safeHost(host) ? `${safeProto}://${host}` : base.origin;
  const forwarded = normalizeIp(firstHop(input.forwardedFor));
  return {
    url: `${origin}${path}`,
    clientIp: forwarded || socketIp,
    trusted: true,
  };
}
