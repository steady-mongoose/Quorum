// A seeded listing is only the fields that were imported.
// No description, no meeting time, and no town row is added here.

import { isIP } from "node:net";
import { ROOM_ID } from "../media/limits.ts";
import { blockedAddress, normalizedHost, pagePort, rebindingHost } from "./public-page.ts";
import { isEnglish } from "./text.ts";

export type ListingStatus = "draft" | "unclaimed";

export type Listing = {
  name: string;
  town: string;
  county: string;
  category: string;
  sourceUrl: string;
  status: ListingStatus;
};

const FIELD_MAX = 80;
const URL_MAX = 400;

function textField(
  value: unknown,
  label: string,
): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: `${label} is missing.` };
  const text = value.trim();
  if (!text) return { ok: false, error: `${label} is missing.` };
  if (text.length > FIELD_MAX) return { ok: false, error: `${label} is too long.` };
  if (!isEnglish(text)) return { ok: false, error: `${label} has to be in English.` };
  return { ok: true, text };
}

export function blockedHost(host: string): boolean {
  const name = normalizedHost(host);
  if (!name || rebindingHost(name)) return true;
  if (isIP(name)) return blockedAddress(name);
  return false;
}

/** The address as given, or an error. The string is not rewritten. */
export function acceptSourceUrl(
  value: unknown,
): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "The source page is missing." };
  const url = value.trim();
  if (!url) return { ok: false, error: "The source page is missing." };
  if (url.length > URL_MAX) return { ok: false, error: "The source page is too long." };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "The source page is not a web address." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "The source page is not a web address." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "The source page is not a web address." };
  }
  if (blockedHost(parsed.hostname) || pagePort(parsed.protocol, parsed.port) === null) {
    return { ok: false, error: "The source page is not a public address." };
  }
  return { ok: true, url };
}

/**
 * The organization's domain is the source host, or the host without a
 * leading www. A parent such as example.com does not match a deeper name.
 */
export function emailOnOrgDomain(email: string, sourceUrl: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain || domain.length > 200 || domain.includes(" ") || !domain.includes(".")) return false;
  const accepted = acceptSourceUrl(sourceUrl);
  if (!accepted.ok) return false;
  let host = "";
  try {
    host = new URL(accepted.url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  const names = host.startsWith("www.") ? [host, host.slice(4)] : [host];
  return names.includes(domain);
}

export function listingRoomId(name: string): string | null {
  const slug = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  if (!ROOM_ID.test(slug)) return null;
  return slug;
}

function listingFrom(
  record: Record<string, unknown>,
): { ok: true; listing: Listing } | { ok: false; error: string } {
  const name = textField(record.name, "Name");
  if (!name.ok) return name;
  const town = textField(record.town, "Town");
  if (!town.ok) return town;
  const county = textField(record.county, "County");
  if (!county.ok) return county;
  const category = textField(record.category, "Category");
  if (!category.ok) return category;
  const source = acceptSourceUrl(record.source_url ?? record.sourceUrl);
  if (!source.ok) return source;
  if (!listingRoomId(name.text))
    return { ok: false, error: "Name the listing with letters or numbers." };
  const rawStatus = record.status;
  let status: ListingStatus = "unclaimed";
  if (rawStatus !== undefined && rawStatus !== "") {
    if (rawStatus !== "draft" && rawStatus !== "unclaimed") {
      return { ok: false, error: "A listing is a draft or unclaimed." };
    }
    status = rawStatus;
  }
  return {
    ok: true,
    listing: {
      name: name.text,
      town: town.text,
      county: county.text,
      category: category.text,
      sourceUrl: source.url,
      status,
    },
  };
}

function rowError(index: number, error: string): string {
  return `Row ${index + 1}: ${error}`;
}

export function parseListingRecords(
  records: unknown,
): { ok: true; listings: Listing[] } | { ok: false; error: string } {
  if (!Array.isArray(records)) return { ok: false, error: "Send a list of listings." };
  if (records.length === 0) return { ok: false, error: "The list is empty." };
  if (records.length > 200) return { ok: false, error: "Import at most 200 listings at once." };
  const listings: Listing[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const item = records[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: rowError(index, "That row is not a listing.") };
    }
    const parsed = listingFrom(item as Record<string, unknown>);
    if (!parsed.ok) return { ok: false, error: rowError(index, parsed.error) };
    listings.push(parsed.listing);
  }
  return { ok: true, listings };
}

function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index] ?? "";
    if (quoted) {
      if (ch === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (ch === "\r") continue;
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value.trim() !== ""));
}

export function parseListingsCsv(
  text: string,
): { ok: true; listings: Listing[] } | { ok: false; error: string } {
  const table = parseCsvTable(text);
  const header = table[0]?.map((cell) => cell.trim().toLowerCase());
  if (!header) return { ok: false, error: "The CSV file is empty." };
  const keys = ["name", "town", "county", "category", "source_url"] as const;
  const index = new Map<string, number>();
  for (const key of keys) {
    const at = header.indexOf(key);
    if (at < 0)
      return {
        ok: false,
        error: "The CSV file needs name, town, county, category, and source_url.",
      };
    index.set(key, at);
  }
  const statusAt = header.indexOf("status");
  const records = table.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    for (const key of keys) record[key] = cells[index.get(key) ?? 0] ?? "";
    if (statusAt >= 0) record.status = cells[statusAt] ?? "";
    return record;
  });
  return parseListingRecords(records);
}

export function parseListingsJson(
  value: unknown,
): { ok: true; listings: Listing[] } | { ok: false; error: string } {
  if (Array.isArray(value)) return parseListingRecords(value);
  if (!value || typeof value !== "object") return { ok: false, error: "Send a list of listings." };
  const body = value as Record<string, unknown>;
  if (typeof body.csv === "string") return parseListingsCsv(body.csv);
  if (Array.isArray(body.listings)) return parseListingRecords(body.listings);
  return { ok: false, error: "Send a list of listings." };
}
