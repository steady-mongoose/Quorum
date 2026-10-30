/**
 * Church and local-organization lookup, backed by OpenStreetMap data.
 *
 * Every lookup goes through this module. The browser never calls the
 * provider. The provider gets the typed words, the place filter, and, when
 * the member allowed it, a rounded point used only to sort nearest first.
 * It never gets a member id, a name, an email, a cookie, or an exact point.
 * Nothing here writes to the database or to the log.
 *
 * What this process keeps in memory, and only in memory (gone on restart):
 * - Answers to searches made without a location, for 10 minutes, under a
 *   hash of the request. A search sorted by a location or by a town or ZIP
 *   is never cached, so no location is held after the answer is sent.
 * - For each member, under a hashed key, the places their own searches
 *   returned in the last hour (reference, name, address). Saving a church
 *   takes the name and address from here, never from the browser.
 * - Search times per hashed member key and per hashed IP, for rate limits.
 *
 * The default provider is Photon (photon.komoot.io), which supports search
 * as you type under fair use. The public Nominatim service forbids
 * autocomplete, so it is not a valid PLACE_LOOKUP_URL for this module.
 */
import { createHash } from "node:crypto";

export type PlaceKind = "church" | "organization";

export type PlaceSuggestion = {
  /** Stable OpenStreetMap reference, such as node/123 or way/456. */
  ref: string;
  name: string;
  /** One line: house number and street, town, state, ZIP. May be empty. */
  address: string;
  /** Kilometres from the sort point, rounded to 0.1. Null without a point. */
  distanceKm: number | null;
};

export type PlacePoint = { lat: number; lon: number };

export type PlaceLookupConfig = {
  /** Provider origin. The module appends /api/. */
  baseUrl: string;
  userAgent: string;
  /** ISO country code results must match. Empty allows every country. */
  country: string;
  cacheTtlMs: number;
  cacheMax: number;
  /** Per member. Kept in memory under a hashed key, never written down. */
  memberLimit: { windowMs: number; max: number };
  /** Per client IP, so many accounts on one address share a ceiling. Hashed key. */
  ipLimit: { windowMs: number; max: number };
  /** Gap between two provider calls from this process. */
  minIntervalMs: number;
  /** Most provider calls that may wait their turn at once. More get a 429. */
  queueMax: number;
  /** Longest a call may wait for its turn. A longer wait gets a 429 at once. */
  queueWaitMs: number;
  timeoutMs: number;
  /** How long the places a member's search returned can be saved as their church. */
  pickTtlMs: number;
};

export const DEFAULT_PLACE_LOOKUP_URL = "https://photon.komoot.io";
export const PLACE_USER_AGENT =
  "AvouchSocial-PlaceLookup/1.0 (+https://avouchsocial.com; place search proxy)";
export const MIN_QUERY = 3;
export const MAX_QUERY = 80;
export const MAX_RESULTS = 8;

/** Churches are places of worship. */
export const CHURCH_TAGS: readonly string[] = ["amenity:place_of_worship"];

/**
 * Local groups: clubs, associations, charities, community and social
 * centres, places of worship, libraries, and civic halls. Shops, roads,
 * and houses are left out.
 */
export const ORGANIZATION_TAGS: readonly string[] = [
  "amenity:place_of_worship",
  "amenity:community_centre",
  "amenity:social_centre",
  "amenity:social_facility",
  "amenity:library",
  "amenity:townhall",
  "amenity:fire_station",
  "office:association",
  "office:charity",
  "office:ngo",
  "office:foundation",
  "office:religion",
  "club",
];

export function tagsFor(kind: PlaceKind): readonly string[] {
  return kind === "church" ? CHURCH_TAGS : ORGANIZATION_TAGS;
}

/** True when an OSM key and value fall inside the filter for this kind. */
export function matchesKind(kind: PlaceKind, key: string, value: string): boolean {
  return tagsFor(kind).some((tag) => {
    const [tagKey, tagValue] = tag.split(":");
    return tagKey === key && (tagValue === undefined || tagValue === value);
  });
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Only https, or http to a local host for tests. Anything else falls back to Photon. */
export function safeProviderUrl(raw: string | undefined): string {
  const text = (raw ?? "").trim().replace(/\/+$/, "");
  if (!text) return DEFAULT_PLACE_LOOKUP_URL;
  try {
    const url = new URL(text);
    if (url.username || url.password || url.search || url.hash) return DEFAULT_PLACE_LOOKUP_URL;
    if (/nominatim\.openstreetmap\.org$/i.test(url.hostname)) return DEFAULT_PLACE_LOOKUP_URL;
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) {
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    }
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_PLACE_LOOKUP_URL;
}

export function readPlaceLookupConfig(env: Record<string, string | undefined>): PlaceLookupConfig {
  const country = (env.PLACE_LOOKUP_COUNTRY ?? "US").trim().toUpperCase();
  return {
    baseUrl: safeProviderUrl(env.PLACE_LOOKUP_URL),
    userAgent: PLACE_USER_AGENT,
    country: /^[A-Z]{2}$/.test(country) ? country : country === "" ? "" : "US",
    cacheTtlMs: 10 * 60 * 1000,
    cacheMax: 500,
    memberLimit: {
      windowMs: 60_000,
      max: clampInt(env.PLACE_LOOKUP_PER_MINUTE, 30, 1, 120),
    },
    // A parish hall on one connection can have many members, so this is wider.
    ipLimit: {
      windowMs: 60_000,
      max: clampInt(env.PLACE_LOOKUP_PER_IP_MINUTE, 90, 1, 600),
    },
    minIntervalMs: 250,
    queueMax: 12,
    queueWaitMs: 3000,
    timeoutMs: 6000,
    pickTtlMs: 60 * 60 * 1000,
  };
}

/** Two decimals, about one kilometre. The exact point never leaves the request. */
export function roundPoint(point: PlacePoint): PlacePoint {
  return { lat: Math.round(point.lat * 100) / 100, lon: Math.round(point.lon * 100) / 100 };
}

export function parsePoint(raw: unknown): PlacePoint | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { lat, lon } = raw as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return roundPoint({ lat, lon });
}

export function distanceKm(a: PlacePoint, b: PlacePoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const OSM_TYPES: Record<string, string> = { N: "node", W: "way", R: "relation" };

/** node/123, way/456, or relation/789. Null for anything else. */
export function osmRef(type: unknown, id: unknown): string | null {
  const kind = typeof type === "string" ? OSM_TYPES[type.toUpperCase()] : undefined;
  const number = typeof id === "number" ? id : typeof id === "string" ? Number(id) : NaN;
  if (!kind || !Number.isSafeInteger(number) || number <= 0) return null;
  return `${kind}/${number}`;
}

export const OSM_REF_PATTERN = /^(node|way|relation)\/[1-9][0-9]{0,14}$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function addressLine(props: Record<string, unknown>): string {
  const street = [text(props.housenumber), text(props.street)].filter(Boolean).join(" ");
  const town = text(props.city) || text(props.town) || text(props.village) || text(props.district);
  const region = [text(props.state), text(props.postcode)].filter(Boolean).join(" ");
  return [street, town, region].filter(Boolean).join(", ").slice(0, 200);
}

type Feature = { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } };

/** Provider response to suggestions: filtered, de-duplicated, nearest first. */
export function toSuggestions(
  body: unknown,
  kind: PlaceKind,
  country: string,
  near: PlacePoint | null,
): PlaceSuggestion[] {
  const features =
    body && typeof body === "object" && Array.isArray((body as { features?: unknown }).features)
      ? ((body as { features: unknown[] }).features as Feature[])
      : [];
  const seen = new Set<string>();
  const rows: PlaceSuggestion[] = [];
  for (const feature of features) {
    const props = feature?.properties;
    if (!props || typeof props !== "object") continue;
    if (!matchesKind(kind, text(props.osm_key), text(props.osm_value))) continue;
    if (country && text(props.countrycode).toUpperCase() !== country) continue;
    const ref = osmRef(props.osm_type, props.osm_id);
    const name = text(props.name).slice(0, 120);
    if (!ref || !name || seen.has(ref)) continue;
    seen.add(ref);
    const coords = feature.geometry?.coordinates;
    let distance: number | null = null;
    if (
      near &&
      Array.isArray(coords) &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number"
    ) {
      distance = Math.round(distanceKm(near, { lat: coords[1], lon: coords[0] }) * 10) / 10;
    }
    rows.push({ ref, name, address: addressLine(props), distanceKm: distance });
  }
  if (near) {
    rows.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }
  return rows.slice(0, MAX_RESULTS);
}

/** First result in the configured country for a city or ZIP. */
export function toPoint(body: unknown, country: string): PlacePoint | null {
  const features =
    body && typeof body === "object" && Array.isArray((body as { features?: unknown }).features)
      ? ((body as { features: unknown[] }).features as Feature[])
      : [];
  for (const feature of features) {
    const props = feature?.properties ?? {};
    if (country && text(props.countrycode).toUpperCase() !== country) continue;
    const coords = feature.geometry?.coordinates;
    if (Array.isArray(coords) && typeof coords[0] === "number" && typeof coords[1] === "number") {
      return roundPoint({ lat: coords[1], lon: coords[0] });
    }
  }
  return null;
}

export type SearchInput = {
  q: string;
  kind: PlaceKind;
  near: PlacePoint | null;
  /** A city or ZIP typed by a member who did not share a location. */
  nearText: string;
};

export type SearchResult =
  | { ok: true; places: PlaceSuggestion[] }
  | { ok: false; status: number; error: string; retryAfter?: number };

export function parseSearchBody(
  body: Record<string, unknown>,
): { ok: true; input: SearchInput } | { ok: false; error: string } {
  const q = text(body.q);
  if (q.length < MIN_QUERY) return { ok: false, error: `Type at least ${MIN_QUERY} letters.` };
  if (q.length > MAX_QUERY) return { ok: false, error: "That name is too long." };
  const kind =
    body.kind === "organization" ? "organization" : body.kind === "church" ? "church" : null;
  if (!kind) return { ok: false, error: "Choose a church or a local group." };
  const nearText = text(body.nearText).slice(0, 60);
  return { ok: true, input: { q, kind, near: parsePoint(body.near), nearText } };
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A place a member's own search returned, as the provider sent it. */
export type PickedPlace = { ref: string; name: string; address: string };

export type PlaceLookup = {
  /** ip is the rate-limit form of the client IP. Without it only the member limit applies. */
  search: (memberId: string, input: SearchInput, ip?: string) => Promise<SearchResult>;
  /**
   * The place with this reference, if this member's own search returned it
   * within pickTtlMs. Null otherwise. The saved church name and address come
   * from here, so a member cannot attach an address of their own to a real
   * OpenStreetMap place.
   */
  picked: (memberId: string, ref: string) => PickedPlace | null;
  /** For tests: what the cache and limiters hold. */
  inspect: () => { cacheKeys: string[]; limiterKeys: string[]; pickKeys: string[] };
};

function hashKey(scope: string, value: string): string {
  return createHash("sha256").update(`place-lookup:${scope}:${value}`).digest("hex").slice(0, 32);
}

function memberKey(memberId: string): string {
  return hashKey("member", memberId);
}

class Busy extends Error {}

const BUSY_ERROR = "Place search is busy. Try again in a moment, or choose Not listed to type it in.";

export function createPlaceLookup(options: {
  config: PlaceLookupConfig;
  fetch: Fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): PlaceLookup {
  const { config } = options;
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const cache = new Map<string, { at: number; value: unknown }>();
  const inflight = new Map<string, Promise<unknown>>();
  const hits = new Map<string, number[]>();
  const picks = new Map<string, Map<string, PickedPlace & { at: number }>>();
  // The time the last reserved provider call may start.
  let lastSlot = Number.NEGATIVE_INFINITY;
  let waiting = 0;

  function remember(key: string, value: unknown) {
    cache.delete(key);
    cache.set(key, { at: now(), value });
    while (cache.size > config.cacheMax) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  function cached(key: string): unknown {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (now() - entry.at > config.cacheTtlMs) {
      cache.delete(key);
      return undefined;
    }
    cache.delete(key);
    cache.set(key, entry);
    return entry.value;
  }

  /** Seconds to wait, or 0 when the search may go ahead. Counts only allowed searches. */
  function limited(keys: { key: string; limit: { windowMs: number; max: number } }[]): number {
    const at = now();
    let retry = 0;
    const lists = keys.map(({ key, limit }) => {
      const recent = (hits.get(key) ?? []).filter((t) => at - t < limit.windowMs);
      hits.set(key, recent);
      if (recent.length >= limit.max) {
        const first = recent[0] ?? at;
        retry = Math.max(retry, Math.max(1, Math.ceil((limit.windowMs - (at - first)) / 1000)));
      }
      return recent;
    });
    if (retry) return retry;
    for (const list of lists) list.push(at);
    if (hits.size > 10_000) {
      const longest = Math.max(config.memberLimit.windowMs, config.ipLimit.windowMs);
      for (const [k, list] of hits) {
        if (!list.some((t) => at - t < longest)) hits.delete(k);
      }
    }
    return 0;
  }

  function keepPicks(memberId: string, places: PlaceSuggestion[]) {
    if (places.length === 0) return;
    const key = memberKey(memberId);
    const at = now();
    const mine = picks.get(key) ?? new Map<string, PickedPlace & { at: number }>();
    picks.delete(key);
    for (const place of places) {
      mine.delete(place.ref);
      mine.set(place.ref, { ref: place.ref, name: place.name, address: place.address, at });
    }
    for (const [ref, entry] of mine) {
      if (mine.size <= 64 && at - entry.at <= config.pickTtlMs) break;
      mine.delete(ref);
    }
    picks.set(key, mine);
    while (picks.size > 5000) {
      const oldest = picks.keys().next().value;
      if (oldest === undefined) break;
      picks.delete(oldest);
    }
  }

  /**
   * Waits for this call's turn so calls from this process are minIntervalMs
   * apart. At most queueMax calls wait at once, and none waits longer than
   * queueWaitMs; past either, the call fails at once with Busy.
   */
  async function throttled<T>(work: (remainingMs: number) => Promise<T>): Promise<T> {
    const start = now();
    const slot = Math.max(start, lastSlot + config.minIntervalMs);
    const wait = slot - start;
    if (wait > 0 && (waiting >= config.queueMax || wait > config.queueWaitMs)) throw new Busy();
    lastSlot = slot;
    if (wait > 0) {
      waiting += 1;
      try {
        await sleep(wait);
      } finally {
        waiting -= 1;
      }
    }
    // The 6 s budget covers the wait too, so a caller never waits past it.
    return work(Math.max(1000, config.timeoutMs - (now() - start)));
  }

  /** cache false: the answer is never kept, as for a search sorted by a location. */
  async function provider(params: URLSearchParams, keep: boolean): Promise<unknown> {
    const url = `${config.baseUrl}/api/?${params.toString()}`;
    const key = createHash("sha256").update(url).digest("hex");
    if (keep) {
      const hit = cached(key);
      if (hit !== undefined) return hit;
    }
    const pending = inflight.get(key);
    if (pending) return pending;
    const run = throttled(async (remainingMs) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remainingMs);
      try {
        // No cookie, no authorization, no referer, no member detail.
        const response = await options.fetch(url, {
          method: "GET",
          headers: { "user-agent": config.userAgent, accept: "application/json" },
          redirect: "error",
          referrerPolicy: "no-referrer",
          credentials: "omit",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`provider ${response.status}`);
        const body = (await response.json()) as unknown;
        if (keep) remember(key, body);
        return body;
      } finally {
        clearTimeout(timer);
      }
    });
    inflight.set(key, run);
    try {
      return await run;
    } finally {
      inflight.delete(key);
    }
  }

  async function pointFor(nearText: string): Promise<PlacePoint | null> {
    if (!nearText) return null;
    const params = new URLSearchParams({ q: nearText, limit: "5", lang: "en" });
    // A town or ZIP is a location, so this answer is not cached.
    return toPoint(await provider(params, false), config.country);
  }

  return {
    inspect: () => ({
      cacheKeys: [...cache.keys()],
      limiterKeys: [...hits.keys()],
      pickKeys: [...picks.keys()],
    }),
    picked(memberId, ref) {
      const mine = picks.get(memberKey(memberId));
      const entry = mine?.get(ref);
      if (!entry || now() - entry.at > config.pickTtlMs) return null;
      return { ref: entry.ref, name: entry.name, address: entry.address };
    },
    async search(memberId, input, ip) {
      const keys = [{ key: memberKey(memberId), limit: config.memberLimit }];
      if (ip) keys.push({ key: hashKey("ip", ip), limit: config.ipLimit });
      const retryAfter = limited(keys);
      if (retryAfter) {
        return { ok: false, status: 429, error: "Too many searches. Wait a moment.", retryAfter };
      }
      try {
        const near = input.near ? roundPoint(input.near) : await pointFor(input.nearText);
        const params = new URLSearchParams({ q: input.q.toLowerCase(), limit: "20", lang: "en" });
        for (const tag of tagsFor(input.kind)) params.append("osm_tag", tag);
        if (near) {
          params.set("lat", near.lat.toFixed(2));
          params.set("lon", near.lon.toFixed(2));
        }
        // Only a search with no location at all is cached.
        const body = await provider(params, !near && !input.nearText);
        const places = toSuggestions(body, input.kind, config.country, near);
        keepPicks(memberId, places);
        return { ok: true, places };
      } catch (error) {
        if (error instanceof Busy) {
          return { ok: false, status: 429, error: BUSY_ERROR, retryAfter: 2 };
        }
        return {
          ok: false,
          status: 502,
          error: "Place search is not answering. Choose Not listed to type it in.",
        };
      }
    },
  };
}
