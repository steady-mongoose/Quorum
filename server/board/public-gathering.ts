import type { Db } from "../db.ts";
import {
  acceptPublicGathering,
  isGatheringId,
  publicGatheringHtml,
  publicGatheringJson,
  type PublicGathering,
} from "../../src/lib/board/public-gathering.ts";

type SessionUser = { id: string; name: string; email: string };

export type GatheringDeps = {
  db: Db;
  readSession: (headers: Headers) => Promise<SessionUser | null>;
  now: () => Date;
};

const PUBLIC_GET = /^\/(?:api\/)?e\/([A-Za-z0-9-]{1,64})$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

function html(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

async function loadShared(db: Db, id: string): Promise<PublicGathering | null> {
  const rows = await db.query<{ title: string; gather_on: string; town: string }>(
    `select title, gather_on, town from public_gathering where id = $1 and shared = true`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return { title: row.title, date: row.gather_on, town: row.town };
}

async function setShared(
  db: Db,
  input: { userId: string; id: string; shared: boolean; gathering: PublicGathering },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!input.shared) {
    const updated = await db.query<{ id: string }>(
      `update public_gathering set shared = false, updated_at = now()
       where id = $1 and host_user_id = $2
       returning id`,
      [input.id, input.userId],
    );
    if (updated.length > 0) return { ok: true };
    const owner = await db.query<{ host_user_id: string }>(
      `select host_user_id from public_gathering where id = $1`,
      [input.id],
    );
    if (owner.length > 0 && owner[0]?.host_user_id !== input.userId) {
      return { ok: false, status: 403, error: "Only the organizer can change sharing." };
    }
    return { ok: true };
  }
  const saved = await db.query<{ id: string }>(
    `insert into public_gathering (id, title, gather_on, town, shared, host_user_id)
     values ($1, $2, $3, $4, true, $5)
     on conflict (id) do update
       set title = excluded.title,
           gather_on = excluded.gather_on,
           town = excluded.town,
           shared = true,
           updated_at = now()
       where public_gathering.host_user_id = excluded.host_user_id
     returning id`,
    [input.id, input.gathering.title, input.gathering.date, input.gathering.town, input.userId],
  );
  if (saved.length > 0) return { ok: true };
  return { ok: false, status: 403, error: "Only the organizer can change sharing." };
}

/**
 * GET /e/<id> and GET /api/e/<id> need no session. Every other method on
 * this path, and every other path, stays with the caller.
 */
export async function handlePublicGathering(
  deps: GatheringDeps,
  request: Request,
  url: URL,
): Promise<Response | null> {
  const match = PUBLIC_GET.exec(url.pathname);
  if (!match) return null;
  const id = match[1] ?? "";
  const asHtml = !url.pathname.startsWith("/api/");
  if (!isGatheringId(id)) return asHtml ? html(404, publicGatheringHtml(null).body) : json(404, { error: "Not found." });

  if (request.method === "GET") {
    const gathering = await loadShared(deps.db, id);
    if (asHtml) {
      const page = publicGatheringHtml(gathering);
      return html(page.status, page.body);
    }
    const payload = publicGatheringJson(gathering);
    return json(payload.status, payload.body);
  }

  if (request.method !== "POST" || asHtml) return json(405, { error: "Not found." });

  const session = await deps.readSession(request.headers);
  if (!session) return json(401, { error: "Sign in first." });

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
  const accepted = acceptPublicGathering({
    title: body.title,
    date: body.date,
    town: body.town,
  });
  if (body.shared === true && !accepted.ok) return json(400, { error: accepted.error });
  const gathering = accepted.ok
    ? accepted.gathering
    : { title: "Gathering", date: "", town: "" };
  const saved = await setShared(deps.db, {
    userId: session.id,
    id,
    shared: body.shared,
    gathering,
  });
  if (!saved.ok) return json(saved.status, { error: saved.error });
  return json(200, { ok: true });
}
