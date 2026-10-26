/**
 * ICE address rules shared by the API and the page.
 * Calls stay on a host the operator runs. Public STUN from Google, Cloudflare,
 * or a cloud vendor is refused, even if someone pastes it into the environment.
 */

const FORBIDDEN_SUFFIXES = [
  "google.com",
  "googleapis.com",
  "gstatic.com",
  "googleusercontent.com",
  "cloudflare.com",
  "amazonaws.com",
  "amazon.com",
  "azure.com",
  "azurewebsites.net",
  "microsoft.com",
  "windows.net",
  "apple.com",
  "icloud.com",
  "livekit.cloud",
];

export function iceHostAllowed(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  if (!host || host.includes("..")) return false;
  return !FORBIDDEN_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export type ParsedIceUrl = { url: string; host: string; relay: boolean };

/**
 * `stun:host:3478` and `turn:host:3478?transport=udp`. No userinfo, no path,
 * and no double slash. The port is required so a missing value cannot fall
 * through to a vendor default.
 */
export function parseIceUrl(value: string): ParsedIceUrl | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 300 || /[\s@/]/.test(trimmed) || trimmed.includes("//")) {
    return null;
  }
  const match =
    /^(stun|stuns|turn|turns):(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):(\d{1,5})(?:\?transport=(udp|tcp))?$/.exec(
      trimmed,
    );
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  const rawHost = match[2] ?? "";
  const host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
  const port = Number(match[3]);
  const transport = match[4];
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if ((scheme === "stun" || scheme === "stuns") && transport) return null;
  if (!iceHostAllowed(host)) return null;
  return { url: trimmed, host, relay: scheme === "turn" || scheme === "turns" };
}
