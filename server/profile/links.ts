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
  const href = parsed.href;
  if (!href.toLowerCase().startsWith("https://") || href.length > 500) {
    return bad(href.length > 500 ? "That link is too long." : "Links have to start with https.");
  }
  return { ok: true, url: href };
}

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
    if (links.some((link) => link.url === parsed.url))
      return bad("That link is already on the profile.");
    links.push({ url: parsed.url, label });
  }
  return { ok: true, links };
}
