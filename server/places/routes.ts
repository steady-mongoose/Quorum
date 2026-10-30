import type { Db } from "../db.ts";
import { openBan } from "../board/store.ts";
import { parseSearchBody, type PlaceLookup } from "./lookup.ts";

type SessionUser = { id: string };

export type PlaceRouteDeps = {
  db: Db;
  now: () => Date;
  readSession: (headers: Headers) => Promise<SessionUser | null>;
  places?: PlaceLookup;
};

export const PLACE_SEARCH_PATH = "/api/places/search";

function json(status: number, body: unknown, extra?: Record<string, string>): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * POST /api/places/search with { q, kind, near?, nearText? }.
 * A POST body keeps the typed words and any point out of access logs.
 * Signed-in members only. Nothing is stored and nothing is logged.
 */
export async function handlePlaces(
  deps: PlaceRouteDeps,
  request: Request,
  url: URL,
): Promise<Response | null> {
  if (url.pathname !== PLACE_SEARCH_PATH) return null;
  if (request.method !== "POST") return json(405, { error: "Not found." });
  const session = await deps.readSession(request.headers);
  if (!session) return json(401, { error: "Sign in first." });
  const ban = await openBan(deps.db, session.id, deps.now());
  if (ban) return json(403, { error: "banned", ban });
  if (!deps.places)
    return json(503, { error: "Place search is off for now. Choose Not listed to type it in." });

  const raw = await request.text();
  if (raw.length > 2048) return json(413, { error: "That request is too large." });
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json(400, { error: "Send JSON." });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(400, { error: "Send a JSON object." });
  }
  const parsed = parseSearchBody(body as Record<string, unknown>);
  if (!parsed.ok) return json(400, { error: parsed.error });
  const result = await deps.places.search(session.id, parsed.input);
  if (!result.ok) {
    return json(
      result.status,
      { error: result.error },
      result.retryAfter ? { "retry-after": String(result.retryAfter) } : undefined,
    );
  }
  return json(200, {
    places: result.places,
    attribution: "© OpenStreetMap contributors",
    license: "https://www.openstreetmap.org/copyright",
  });
}
