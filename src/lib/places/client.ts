import { apiFetch } from "@/lib/api-base";

export type PlaceKind = "church" | "organization";

export type PlaceSuggestion = {
  ref: string;
  name: string;
  address: string;
  distanceKm: number | null;
};

/** What a field holds. A typed entry has ref null and is not verified. */
export type PlaceValue = { name: string; ref: string | null; address: string };

export const PLACE_MIN_QUERY = 3;
export const PLACE_DEBOUNCE_MS = 300;
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

export type PlaceSearchRequest = {
  q: string;
  kind: PlaceKind;
  /** Rounded before it leaves the browser. Never stored. */
  near?: { lat: number; lon: number } | null;
  nearText?: string;
};

export type PlaceSearchResponse =
  { ok: true; places: PlaceSuggestion[] } | { ok: false; error: string };

export type PlaceSearchFn = (
  request: PlaceSearchRequest,
  signal: AbortSignal,
) => Promise<PlaceSearchResponse>;

/** Two decimals, about one kilometre. Used only to sort nearest first. */
export function roundNear(point: { lat: number; lon: number }): { lat: number; lon: number } {
  return { lat: Math.round(point.lat * 100) / 100, lon: Math.round(point.lon * 100) / 100 };
}

export function isVerified(value: PlaceValue | null | undefined): boolean {
  return Boolean(value?.ref && /^(node|way|relation)\/\d+$/.test(value.ref));
}

/** Calls fn once, `wait` ms after the last call. cancel() drops a pending call. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
  timers: { set: typeof setTimeout; clear: typeof clearTimeout } = {
    set: setTimeout,
    clear: clearTimeout,
  },
): ((...args: A) => void) & { cancel: () => void } {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const run = (...args: A) => {
    if (handle !== undefined) timers.clear(handle);
    handle = timers.set(() => {
      handle = undefined;
      fn(...args);
    }, wait);
  };
  run.cancel = () => {
    if (handle !== undefined) timers.clear(handle);
    handle = undefined;
  };
  return run;
}

/** Same-session answers for repeat words, so backspacing does not call again. */
const memo = new Map<string, PlaceSuggestion[]>();

export function placeSearchKey(request: PlaceSearchRequest): string {
  const near = request.near ? `${request.near.lat},${request.near.lon}` : "";
  return [
    request.kind,
    request.q.trim().toLowerCase(),
    near,
    (request.nearText ?? "").trim().toLowerCase(),
  ].join("|");
}

/** Our API only. The browser never calls the map provider. */
export const searchPlaces: PlaceSearchFn = async (request, signal) => {
  const body = {
    q: request.q.trim(),
    kind: request.kind,
    ...(request.near ? { near: roundNear(request.near) } : {}),
    ...(request.nearText?.trim() ? { nearText: request.nearText.trim() } : {}),
  };
  const key = placeSearchKey({ ...request, near: body.near ?? null });
  const hit = memo.get(key);
  if (hit) return { ok: true, places: hit };
  const response = await apiFetch("/api/places/search", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = (await response.json().catch(() => null)) as {
    places?: PlaceSuggestion[];
    error?: string;
  } | null;
  if (!response.ok || !Array.isArray(json?.places)) {
    return {
      ok: false,
      error:
        response.status === 401 || response.status === 503
          ? "Place search needs a signed-in account. Choose Not listed to type it in."
          : json?.error || "Place search is not answering. Choose Not listed to type it in.",
    };
  }
  if (memo.size > 200) memo.clear();
  memo.set(key, json.places);
  return { ok: true, places: json.places };
};
