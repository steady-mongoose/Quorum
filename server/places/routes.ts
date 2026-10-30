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

export const MAX_SEARCH_BODY = 2048;

/**
 * Reads at most `max` bytes. Stops and answers null as soon as the declared
 * length or the bytes read so far pass it, so a large body is never buffered.
 */
export async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length > max) return null;
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * POST /api/places/search with { q, kind, near?, nearText? }.
 * A POST body keeps the typed words and any point out of access logs.
 * Signed-in members only. Nothing is written to the database or the log.
 * The lookup keeps some answers in memory for a short time; see lookup.ts.
 */
export async function handlePlaces(
  deps: PlaceRouteDeps,
  request: Request,
  url: URL,
  ip?: string,
): Promise<Response | null> {
  if (url.pathname !== PLACE_SEARCH_PATH) return null;
  if (request.method !== "POST") return json(405, { error: "Not found." });
  const session = await deps.readSession(request.headers);
  if (!session) return json(401, { error: "Sign in first." });
  const ban = await openBan(deps.db, session.id, deps.now());
  if (ban) return json(403, { error: "banned", ban });
  if (!deps.places)
    return json(503, { error: "Place search is off for now. Choose Not listed to type it in." });

  const raw = await readCapped(request, MAX_SEARCH_BODY);
  if (raw === null) return json(413, { error: "That request is too large." });
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
  const result = await deps.places.search(session.id, parsed.input, ip);
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
