import type { Db } from "../db.ts";
import { BOARD_READ_LIMIT, BOARD_WRITE_LIMIT, consumeLimit } from "../rate-limit.ts";
import { CLIENT_IP_HEADER, rateLimitIp } from "../proxy.ts";
import { limitBoardWrite } from "./routes.ts";
import { loadSharedGathering, setGatheringShared } from "./gathering-record.ts";
import {
  isGatheringId,
  publicGatheringHtml,
  publicGatheringJson,
} from "../../src/lib/board/public-gathering.ts";

type SessionUser = { id: string; name: string; email: string };

export type GatheringDeps = {
  db: Db;
  readSession: (headers: Headers) => Promise<SessionUser | null>;
  now: () => Date;
};

const PUBLIC_PATH = /^\/(?:api\/)?e\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function gatheringViewLimitKey(ip: string): string {
  return `board-read:ip:${ip}`;
}

function clientIp(request: Request): string {
  const value = request.headers.get(CLIENT_IP_HEADER)?.trim();
  return rateLimitIp(value || "local");
}

function json(status: number, body: unknown, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex");
  return new Response(JSON.stringify(body), { status, headers });
}

function html(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      vary: "Save-Data",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

function tooMany(retryAfter: number): Response {
  return json(
    429,
    { error: "Too many attempts. Wait and try again." },
    new Headers({ "retry-after": String(retryAfter) }),
  );
}

/**
 * GET /e/<id> and GET /api/e/<id> need no session. POST /api/e/<id> only
 * turns sharing on or off. The title, date, time, and town come from the
 * stored gathering. Every other path stays with the caller.
 */
export async function handlePublicGathering(
  deps: GatheringDeps,
  request: Request,
  url: URL,
): Promise<Response | null> {
  const match = PUBLIC_PATH.exec(url.pathname);
  if (!match) return null;
  const id = (match[1] ?? "").toLowerCase();
  const asHtml = !url.pathname.startsWith("/api/");
  const saveData = { saveData: request.headers.get("save-data")?.trim().toLowerCase() === "on" };
  if (!isGatheringId(id)) {
    return asHtml ? html(404, publicGatheringHtml(null, id, saveData).body) : json(404, { error: "Not found." });
  }

  const ip = clientIp(request);
  if (request.method === "GET") {
    const hit = await consumeLimit(deps.db, gatheringViewLimitKey(ip), BOARD_READ_LIMIT, Date.now());
    if (!hit.allowed) return tooMany(hit.retryAfter);
    const gathering = await loadSharedGathering(deps.db, id, deps.now());
    if (asHtml) {
      const page = publicGatheringHtml(gathering, id, saveData);
      return html(page.status, page.body);
    }
    const payload = publicGatheringJson(gathering);
    return json(payload.status, payload.body);
  }

  if (request.method !== "POST" || asHtml) return json(405, { error: "Not found." });

  const session = await deps.readSession(request.headers);
  if (!session) {
    const hit = await consumeLimit(deps.db, `board-write:ip:${ip}`, BOARD_WRITE_LIMIT, Date.now());
    if (!hit.allowed) return tooMany(hit.retryAfter);
    return json(401, { error: "Sign in first." });
  }
  const limited = await limitBoardWrite(deps.db, request, session.id);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 8192) return json(413, { error: "That request is too large." });
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json(400, { error: "Send a JSON object." });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "Send JSON." });
  }

  if (body.shared !== true && body.shared !== false) {
    return json(400, { error: "Say whether sharing is on." });
  }
  const saved = await setGatheringShared(deps.db, {
    userId: session.id,
    id,
    shared: body.shared,
    now: deps.now(),
  });
  if (!saved.ok) return json(saved.status, { error: saved.error });
  return json(200, { ok: true, shared: saved.shared });
}
