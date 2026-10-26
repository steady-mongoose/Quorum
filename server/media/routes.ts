import { consumeLimit, UPLOAD_LIMIT } from "../rate-limit.ts";
import { uploadIpKey } from "./ip.ts";
import type { Db } from "../db.ts";
import { mediaLimits } from "../../src/lib/media/limits.ts";
import { publicMediaStatus, type MediaConfig } from "./config.ts";
import { completeUpload, prepareUpload, readForMember, type MediaServiceDeps } from "./service.ts";
import type { ObjectStore } from "./s3.ts";

export type MediaRuntime = {
  config: MediaConfig;
  store: ObjectStore | null;
  now: () => Date;
};

function json(status: number, body: unknown, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function denied(result: {
  status: number;
  error: string;
  code?: string;
  ban?: { until: number; strikes: number; reason: string };
}): Response {
  return json(result.status, {
    error: result.error,
    ...(result.code ? { code: result.code } : {}),
    ...(result.ban ? { ban: result.ban } : {}),
  });
}

function tooMany(retryAfter: number): Response {
  return json(
    429,
    { error: "Too many uploads. Wait and try again." },
    new Headers({ "retry-after": String(retryAfter) }),
  );
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const claimed = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(claimed) && claimed > 65_536) {
    return Promise.reject(Object.assign(new Error("That request is too large."), { status: 413 }));
  }
  const text = await request.text();
  if (text.length > 65_536) {
    return Promise.reject(Object.assign(new Error("That request is too large."), { status: 413 }));
  }
  if (!text) return {};
  const body = JSON.parse(text) as unknown;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Promise.reject(Object.assign(new Error("Send a JSON object."), { status: 400 }));
  }
  return body as Record<string, unknown>;
}

function mediaId(pathname: string, suffix: string): string | null {
  const match = new RegExp(`^/api/media/([0-9a-f-]{36})${suffix}$`).exec(pathname);
  return match?.[1] ?? null;
}

/**
 * Member-only picture and video routes. Returns null when the path is not
 * a media path, so the rest of the API can answer.
 */
export async function handleMedia(
  runtime: MediaRuntime,
  db: Db,
  request: Request,
  url: URL,
  session: { id: string } | null,
  clientIp: string,
): Promise<Response | null> {
  const { pathname } = url;
  if (pathname === "/api/media/status" && request.method === "GET") {
    return json(200, { ...publicMediaStatus(runtime.config), limits: mediaLimits() });
  }
  if (!pathname.startsWith("/api/media/")) return null;
  if (request.method !== "GET" && request.method !== "POST")
    return json(405, { error: "Not found." });

  const deps = (): MediaServiceDeps => {
    if (!runtime.config.enabled || !runtime.store) {
      throw Object.assign(new Error("Picture and video storage is not set up."), { status: 503 });
    }
    return { db, store: runtime.store, now: runtime.now, videoEnabled: runtime.config.video };
  };

  try {
    if (pathname === "/api/media/uploads" && request.method === "POST") {
      if (!session) return json(401, { error: "Sign in first." });
      if (!runtime.config.enabled || !runtime.store) {
        return json(503, { error: "Picture and video storage is not set up." });
      }
      const byUser = await consumeLimit(
        db,
        `upload:${session.id}`,
        UPLOAD_LIMIT,
        runtime.now().getTime(),
      );
      if (!byUser.allowed) return tooMany(byUser.retryAfter);
      const byIp = await consumeLimit(
        db,
        uploadIpKey(clientIp),
        UPLOAD_LIMIT,
        runtime.now().getTime(),
      );
      if (!byIp.allowed) return tooMany(byIp.retryAfter);
      const body = await readBody(request);
      const result = await prepareUpload(deps(), session.id, body);
      if (!result.ok) return denied(result);
      return json(result.status, result.body);
    }

    const completeId = request.method === "POST" ? mediaId(pathname, "/complete") : null;
    if (completeId) {
      if (!session) return json(401, { error: "Sign in first." });
      const result = await completeUpload(deps(), session.id, completeId);
      if (!result.ok) return denied(result);
      return json(result.status, result.body);
    }

    const readId = request.method === "GET" ? mediaId(pathname, "") : null;
    if (readId) {
      if (!session) return json(401, { error: "Sign in first." });
      if (!runtime.config.enabled || !runtime.store) {
        return json(503, { error: "Picture and video storage is not set up." });
      }
      const result = await readForMember(deps(), session.id, readId);
      if (!result.ok) return denied(result);
      return json(result.status, result.body);
    }

    if (pathname.startsWith("/api/media/")) return json(404, { error: "Not found." });
    return null;
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    if (status === 400 || status === 413 || status === 503) {
      const message = error instanceof Error ? error.message : "The server could not finish that.";
      return json(status, { error: message });
    }
    if (error instanceof SyntaxError) return json(400, { error: "Send JSON." });
    throw error;
  }
}
