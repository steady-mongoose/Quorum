import { actorRole } from "../board/access.ts";
import type { Db } from "../db.ts";
import { readStats, readStatsCsv } from "./read.ts";

type SessionUser = { id: string; name: string; email: string };

export type StatsDeps = {
  db: Db;
  readSession: (headers: Headers) => Promise<SessionUser | null>;
  now: () => Date;
};

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

/** Admin stats. The role is the server role. A steward is not an admin. */
export async function handleStats(
  deps: StatsDeps,
  request: Request,
  url: URL,
): Promise<Response | null> {
  const csv = url.pathname === "/api/admin/stats.csv";
  const page = url.pathname === "/api/admin/stats";
  if (!csv && !page) return null;
  if (request.method !== "GET") return json(405, { error: "Not found." });
  const session = await deps.readSession(request.headers);
  if (!session) return json(401, { error: "Sign in first." });
  const actor = await actorRole(deps.db, session.id);
  if (!actor.admin) return json(403, { error: "This page is for an admin." });
  if (csv) {
    const body = await readStatsCsv(deps.db, deps.now());
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="stats.csv"',
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
      },
    });
  }
  return json(200, await readStats(deps.db, deps.now()));
}
