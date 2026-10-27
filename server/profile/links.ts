/**
 * Profile links are https addresses only. The server parses them and does not
 * fetch them, so nothing here is a preview.
 */

import { isEnglish } from "../../src/lib/board/text.ts";

export const MAX_LINKS = 5;
export const MAX_LINK_LABEL = 80;

const BANNED_SCHEMES = ["javascript:", "data:", "vbscript:", "file:"] as const;

export type ProfileLink = { url: string; label: string };

function bad(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Normalized https URL, or a refusal. Banned schemes are refused before the parse. */
export function parseHttpsUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return bad("Enter a link.");
  if (/[\u0000-\u001F\u007F\s]/.test(text)) return bad("That link is not a web address.");
  const lower = text.toLowerCase();
  for (const scheme of BANNED_SCHEMES) {
    if (lower.startsWith(scheme)) return bad("Links have to start with https.");
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return bad("That link is not a web address.");
  }
  if (parsed.username || parsed.password) return bad("That link is not a web address.");
  if (parsed.protocol !== "https:" || !parsed.hostname) {
    return bad("Links have to start with https.");
  }
  if (!publicHostname(parsed.hostname)) return bad("That link is not a public web address.");
  const href = parsed.href;
  if (!href.toLowerCase().startsWith("https://") || href.length > 500) {
    return bad(href.length > 500 ? "That link is too long." : "Links have to start with https.");
  }
  return { ok: true, url: href };
}

const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * A public DNS name: at least two labels, a letter (or punycode) top level,
 * and no IP literal, localhost, or private-network suffix.
 */
export function publicHostname(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  if (!name || name.length > 253 || name.startsWith("[")) return false;
  const labels = name.split(".");
  if (labels.length < 2 || !labels.every((label) => HOST_LABEL.test(label))) return false;
  const top = labels[labels.length - 1]!;
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(top)) return false;
  if (["localhost", "local", "internal", "lan", "home", "test", "invalid", "example"].includes(top)) {
    return false;
  }
  return true;
}

/** The host a member sees next to a link label. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const LABEL_HOST = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,63}\b/i;

export function parseLinks(
  value: unknown,
): { ok: true; links: ProfileLink[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return bad("Send a list of links.");
  if (value.length > MAX_LINKS) return bad("A profile can have 5 links.");
  const links: ProfileLink[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      return bad("That link is not a web address.");
    const body = item as { url?: unknown; label?: unknown };
    if (typeof body.url !== "string") return bad("That link is not a web address.");
    const parsed = parseHttpsUrl(body.url);
    if (!parsed.ok) return parsed;
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (label.length > MAX_LINK_LABEL) return bad("That link label is too long.");
    if (label && !isEnglish(label)) return bad("Write the label in plain letters.");
    // A label cannot pose as a different address. The host is always shown too.
    const named = label.match(LABEL_HOST)?.[0]?.toLowerCase() ?? "";
    if (named) {
      const host = linkHost(parsed.url);
      const bare = named.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
      if (!bare || (host !== bare && !host.endsWith(`.${bare}`) && host.replace(/^www\./, "") !== bare)) {
        return bad("A link label cannot name a different web address.");
      }
    }
    if (links.some((link) => link.url === parsed.url))
      return bad("That link is already on the profile.");
    links.push({ url: parsed.url, label });
  }
  return { ok: true, links };
}
