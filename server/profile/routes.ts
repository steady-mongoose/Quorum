import { limitBoard } from "../board/routes.ts";
import type { Db } from "../db.ts";
import { MIN_PROFILE_AGE } from "./age.ts";
import { decideCorrection, listCorrections, requestCorrection } from "./corrections.ts";
import { INTERESTS } from "./interests.ts";
import { ADMINS_ONLY_LATER, ANONYMOUS_LATER } from "./permissions.ts";
import { churchSuggestions, saveProfile } from "./store.ts";
import { COUNTIES, ELSEWHERE_ID, TOWNS } from "./towns.ts";
import { profileView, type ProfileFailure } from "./view.ts";

type SessionUser = { id: string; name: string; email: string };

export type ProfileDeps = {
  db: Db;
  readSession: (headers: Headers) => Promise<SessionUser | null>;
  now: () => Date;
};

const USER_ID = /^[A-Za-z0-9_-]{1,80}$/;

function json(status: number, body: unknown, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function fromFailure(result: ProfileFailure): Response {
  return json(result.status, {
    error: result.error,
    ...(result.ban ? { ban: result.ban } : {}),
  });
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const claimed = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(claimed) && claimed > 65_536) {
    throw new HttpError(413, "That request is too large.");
  }
  const text = await request.text();
  if (text.length > 65_536) throw new HttpError(413, "That request is too large.");
  if (!text) return {};
  try {
    const body = JSON.parse(text) as unknown;
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Send a JSON object.");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Send JSON.");
  }
}

async function options(db: Db) {
  return {
    counties: COUNTIES,
    towns: TOWNS,
    elsewhere: { id: ELSEWHERE_ID, name: "Elsewhere" },
    interests: INTERESTS,
    churches: await churchSuggestions(db),
    visibility: ["members", "shared", "private"],
    minAge: MIN_PROFILE_AGE,
    adminsOnly: ADMINS_ONLY_LATER,
    anonymous: ANONYMOUS_LATER,
  };
}

/** Own profile, another member's profile, a patch, and onboarding. */
export async function handleProfile(
  deps: ProfileDeps,
  request: Request,
  url: URL,
): Promise<Response | null> {
  const onboard = url.pathname === "/api/profile/onboard";
  const own = url.pathname === "/api/profile";
  const corrections = url.pathname === "/api/profile/corrections";
  const decide = /^\/api\/profile\/corrections\/([A-Za-z0-9-]{1,80})$/.exec(url.pathname);
  const correctionId = decide?.[1] ?? "";
  const match = /^\/api\/profile\/([A-Za-z0-9_-]{1,80})$/.exec(url.pathname);
  const otherId = match?.[1] && match[1] !== "onboard" && match[1] !== "photo" && match[1] !== "corrections" ? match[1] : "";
  if (!own && !onboard && !otherId && !corrections && !correctionId) return null;
  if (otherId && !USER_ID.test(otherId)) {
    return json(404, { error: "That person is not a member." });
  }

  const method = request.method;
  const allowed =
    (own && (method === "GET" || method === "PATCH")) ||
    (onboard && method === "POST") ||
    (corrections && (method === "GET" || method === "POST")) ||
    (correctionId && method === "POST") ||
    (otherId && method === "GET");
  if (!allowed) return json(405, { error: "Not found." });

  try {
    const session = await deps.readSession(request.headers);
    if (!session) return json(401, { error: "Sign in first." });
    const kind = method === "GET" ? "read" : "write";
    const blocked = await limitBoard(deps.db, request, session.id, kind);
    if (blocked) return blocked;
    const now = deps.now();

    if (corrections && method === "GET") {
      const scope = url.searchParams.get("scope") === "queue" ? "queue" : "own";
      const listed = await listCorrections(deps.db, session.id, scope, now);
      if (!listed.ok) return fromFailure(listed);
      return json(200, { corrections: listed.corrections });
    }

    if (corrections && method === "POST") {
      const asked = await requestCorrection(deps.db, session.id, await readJson(request), now);
      if (!asked.ok) return fromFailure(asked);
      return json(201, { correction: asked.correction });
    }

    if (correctionId) {
      const decided = await decideCorrection(deps.db, session.id, correctionId, await readJson(request), now);
      if (!decided.ok) return fromFailure(decided);
      return json(200, decided);
    }

    if (otherId && method === "GET") {
      const viewed = await profileView(deps.db, { id: session.id }, { id: otherId }, now);
      if (!viewed.ok) return fromFailure(viewed);
      return json(200, { profile: viewed.profile });
    }

    if (method === "GET") {
      const viewed = await profileView(deps.db, { id: session.id }, { id: session.id }, now);
      if (!viewed.ok) return fromFailure(viewed);
      return json(200, { profile: viewed.profile, options: await options(deps.db) });
    }

    const body = await readJson(request);
    const saved = await saveProfile(deps.db, session.id, body, now, onboard ? "onboard" : "patch");
    if (!saved.ok) return fromFailure(saved);
    return json(200, { profile: saved.profile });
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message });
    throw error;
  }
}
