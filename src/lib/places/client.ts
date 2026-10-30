import { apiFetch } from "@/lib/api-base";

export type PlaceKind = "church" | "organization";

export type PlaceSuggestion = {
  ref: string;
  name: string;
  address: string;
  distanceKm: number | null;
};

/** What a field holds. A typed entry has ref null and shows no map mark. */
export type PlaceValue = { name: string; ref: string | null; address: string };

export const PLACE_MIN_QUERY = 3;
export const PLACE_DEBOUNCE_MS = 300;
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
/** The search provider our API forwards the words to. Members are told in the field. */
export const PLACE_PROVIDER_HOST = "photon.komoot.io";

export const PLACE_ERROR_SIGNED_OUT =
  "Sign in again to search. You can still choose Not listed and type it in.";
export const PLACE_ERROR_OFF = "Place search is off for now. Choose Not listed to type it in.";
export const PLACE_ERROR_DOWN = "Place search is not answering. Choose Not listed to type it in.";

/** The line shown inside the list when a search fails. */
export function placeErrorFor(status: number, serverError?: string): string {
  if (status === 401) return PLACE_ERROR_SIGNED_OUT;
  // apiFetch turns a network failure or an HTML page into a 503 "api-unavailable".
  if (status === 503) return serverError === "api-unavailable" ? PLACE_ERROR_DOWN : PLACE_ERROR_OFF;
  if (status === 502 || status === 504 || status === 0) return PLACE_ERROR_DOWN;
  return serverError || PLACE_ERROR_DOWN;
}

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

/** True when the value was picked from the list, so it is "on the map". */
export function isOnMap(value: PlaceValue | null | undefined): boolean {
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
    return { ok: false, error: placeErrorFor(response.status, json?.error) };
  }
  if (memo.size > 200) memo.clear();
  memo.set(key, json.places);
  return { ok: true, places: json.places };
};

/** The church as the account holds it, from GET or PATCH /api/profile. */
export type AccountChurch = {
  name: string;
  /** Null when typed, or when the server cannot keep a picked place yet (0048 not applied). */
  place: { ref: string; address: string } | null;
};

type ProfileAnswer = {
  profile?: { church?: string; churchPlace?: { ref?: string; address?: string } };
  /** Why a sent pick was not kept: not confirmed by our search, or 0048 not applied. */
  churchPlaceNote?: "not-confirmed" | "not-ready";
  error?: string;
};

function churchOf(json: ProfileAnswer | null): AccountChurch | null {
  const profile = json?.profile;
  if (!profile) return null;
  const ref = profile.churchPlace?.ref ?? "";
  return {
    name: profile.church ?? "",
    place: ref ? { ref, address: profile.churchPlace?.address ?? "" } : null,
  };
}

/** Reads the signed-in member's church from the account. Null when there is none to read. */
export async function loadAccountChurch(): Promise<AccountChurch | null> {
  const response = await apiFetch("/api/profile", { credentials: "include", cache: "no-store" });
  if (!response.ok) return null;
  return churchOf((await response.json().catch(() => null)) as ProfileAnswer | null);
}

/**
 * Saves the church on the account with PATCH /api/profile. A typed church
 * sends churchPlace null, which clears a picked place on the server. A pick
 * sends only its reference: the server takes the name and address from its
 * own search results, and answers with what it saved.
 */
export async function saveAccountChurch(
  name: string,
  place: { ref: string; address: string } | null,
): Promise<
  | { ok: true; church: AccountChurch | null; note?: "not-confirmed" | "not-ready" }
  | { ok: false; error: string }
> {
  const response = await apiFetch("/api/profile", {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ church: name, churchPlace: name && place ? { ref: place.ref } : null }),
  });
  const json = (await response.json().catch(() => null)) as ProfileAnswer | null;
  if (!response.ok) return { ok: false, error: json?.error || "That did not save." };
  const note = json?.churchPlaceNote;
  return note === "not-confirmed" || note === "not-ready"
    ? { ok: true, church: churchOf(json), note }
    : { ok: true, church: churchOf(json) };
}
