// Which source pages a claim may fetch. Names and addresses only.
// The server resolves DNS at fetch time and connects to the address it checked.

import { BlockList, isIP } from "node:net";

const PAGE_ERROR = "The page did not show the code.";

const block = new BlockList();
block.addSubnet("0.0.0.0", 8, "ipv4");
block.addSubnet("10.0.0.0", 8, "ipv4");
block.addSubnet("100.64.0.0", 10, "ipv4");
block.addSubnet("127.0.0.0", 8, "ipv4");
block.addSubnet("169.254.0.0", 16, "ipv4");
block.addSubnet("172.16.0.0", 12, "ipv4");
block.addSubnet("192.168.0.0", 16, "ipv4");
block.addSubnet("224.0.0.0", 4, "ipv4");
block.addAddress("255.255.255.255", "ipv4");
block.addAddress("::", "ipv6");
block.addAddress("::1", "ipv6");
block.addSubnet("fc00::", 7, "ipv6");
block.addSubnet("fe80::", 10, "ipv6");
block.addSubnet("ff00::", 8, "ipv6");

/** Names that resolve to an address the owner of the name picks, including loopback. */
const REBINDING = [
  "nip.io",
  "sslip.io",
  "xip.io",
  "localtest.me",
  "lvh.me",
  "vcap.me",
  "traefik.me",
];

export function normalizedHost(hostname: string): string {
  let name = hostname.trim().toLowerCase();
  if (name.startsWith("[") && name.endsWith("]")) name = name.slice(1, -1);
  return name.replace(/\.$/, "");
}

export function rebindingHost(hostname: string): boolean {
  const name = normalizedHost(hostname);
  if (!name) return true;
  if (name === "localhost" || name.endsWith(".localhost") || name.endsWith(".local")) return true;
  if (name === "internal" || name.endsWith(".internal")) return true;
  if (name === "metadata.google.internal" || name === "metadata.goog") return true;
  return REBINDING.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
}

/** Private, loopback, link-local, CGNAT, ULA, metadata, and IPv4-mapped addresses. */
export function blockedAddress(address: string): boolean {
  const raw = normalizedHost(address);
  if (!raw) return true;
  if (raw.startsWith("::ffff:")) return true;
  const family = isIP(raw);
  if (family === 4) return block.check(raw, "ipv4");
  if (family === 6) return block.check(raw, "ipv6");
  return true;
}

export function pagePort(protocol: string, port: string): number | null {
  if (protocol !== "http:" && protocol !== "https:") return null;
  if (port === "") return protocol === "https:" ? 443 : 80;
  if (!/^\d+$/.test(port)) return null;
  const number = Number(port);
  if (number === 80 || number === 443) return number;
  return null;
}

export type PageTarget = {
  protocol: "http:" | "https:";
  hostname: string;
  port: number;
  path: string;
};

export function pageTarget(
  url: string,
): { ok: true; target: PageTarget } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: PAGE_ERROR };
  }
  if (parsed.username || parsed.password) return { ok: false, error: PAGE_ERROR };
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: PAGE_ERROR };
  }
  const hostname = normalizedHost(parsed.hostname);
  if (!hostname || rebindingHost(hostname)) return { ok: false, error: PAGE_ERROR };
  if (isIP(hostname) && blockedAddress(hostname)) return { ok: false, error: PAGE_ERROR };
  const port = pagePort(parsed.protocol, parsed.port);
  if (port === null) return { ok: false, error: PAGE_ERROR };
  return {
    ok: true,
    target: {
      protocol: parsed.protocol,
      hostname,
      port,
      path: `${parsed.pathname}${parsed.search}` || "/",
    },
  };
}
