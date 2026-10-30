/**
 * Church and local-organization lookup, backed by OpenStreetMap data.
 *
 * Every lookup goes through this module. The browser never calls the
 * provider. The provider gets the typed words, the place filter, and, when
 * the member allowed it, a rounded point used only to sort nearest first.
 * It never gets a member id, a name, an email, a cookie, or an exact point.
 * Nothing here writes to the database or to the log.
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
  /** Gap between two provider calls from this process. */
  minIntervalMs: number;
  timeoutMs: number;
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
    cacheTtlMs: 24 * 60 * 60 * 1000,
    cacheMax: 1000,
    memberLimit: {
      windowMs: 60_000,
      max: clampInt(env.PLACE_LOOKUP_PER_MINUTE, 30, 1, 120),
    },
    minIntervalMs: 250,
    timeoutMs: 6000,
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

export type PlaceLookup = {
  search: (memberId: string, input: SearchInput) => Promise<SearchResult>;
  /** For tests: what the cache and limiter hold. */
  inspect: () => { cacheKeys: string[]; limiterKeys: string[] };
};

function memberKey(memberId: string): string {
  return createHash("sha256").update(`place-lookup:${memberId}`).digest("hex").slice(0, 32);
}

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
  let lastCall = Number.NEGATIVE_INFINITY;
  let queue: Promise<void> = Promise.resolve();

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

  function limited(memberId: string): number {
    const key = memberKey(memberId);
    const at = now();
    const recent = (hits.get(key) ?? []).filter((t) => at - t < config.memberLimit.windowMs);
    if (recent.length >= config.memberLimit.max) {
      hits.set(key, recent);
      const first = recent[0] ?? at;
      return Math.max(1, Math.ceil((config.memberLimit.windowMs - (at - first)) / 1000));
    }
    recent.push(at);
    hits.set(key, recent);
    if (hits.size > 10_000) {
      for (const [k, list] of hits) {
        if (!list.some((t) => at - t < config.memberLimit.windowMs)) hits.delete(k);
      }
    }
    return 0;
  }

  async function throttled<T>(work: () => Promise<T>): Promise<T> {
    const turn = queue.then(async () => {
      const wait = lastCall + config.minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      lastCall = now();
    });
    queue = turn.catch(() => undefined);
    await turn;
    return work();
  }

  async function provider(params: URLSearchParams): Promise<unknown> {
    const url = `${config.baseUrl}/api/?${params.toString()}`;
    const key = url;
    const hit = cached(key);
    if (hit !== undefined) return hit;
    const pending = inflight.get(key);
    if (pending) return pending;
    const run = throttled(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
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
        remember(key, body);
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
    return toPoint(await provider(params), config.country);
  }

  return {
    inspect: () => ({ cacheKeys: [...cache.keys()], limiterKeys: [...hits.keys()] }),
    async search(memberId, input) {
      const retryAfter = limited(memberId);
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
        const body = await provider(params);
        return { ok: true, places: toSuggestions(body, input.kind, config.country, near) };
      } catch {
        return {
          ok: false,
          status: 502,
          error: "Place search is not answering. Choose Not listed to type it in.",
        };
      }
    },
  };
}
