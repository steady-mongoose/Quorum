/** Upload buckets group an IPv6 host with the rest of its /64. */

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function group(value: string): string {
  if (!/^[0-9a-f]{1,4}$/.test(value)) return "";
  return value.padStart(4, "0");
}

/** First 64 bits, or an empty string when the address is not IPv6. */
export function ipv6Prefix64(value: string): string {
  const address = value.split("%", 1)[0]?.toLowerCase() ?? "";
  if (!address.includes(":") || address.includes(".")) return "";
  const halves = address.split("::");
  if (halves.length > 2) return "";
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (halves.length === 1 && left.length !== 8) return "";
  if (missing < 0) return "";
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) return "";
  const prefix = groups.slice(0, 4).map(group);
  if (prefix.some((item) => item === "")) return "";
  return prefix.join(":");
}

/** Rate-limit key. IPv4 stays whole. IPv6 collapses to the /64. */
export function uploadIpKey(ip: string): string {
  const trimmed = ip.trim().toLowerCase();
  const mapped = trimmed.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1] && isIpv4(mapped[1])) return `upload-ip:${mapped[1]}`;
  if (trimmed.includes(":")) {
    const prefix = ipv6Prefix64(trimmed);
    if (prefix) return `upload-ip:${prefix}::/64`;
  }
  return `upload-ip:${trimmed || "local"}`;
}
